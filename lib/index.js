/**
 * dsh-skill-scoreboard — skill 使用记分板（代码级自动记录）
 *
 * 完全用代码记录 AI 实际用过哪些 skill，替代手动 skill-scoreboard.md 记分：
 *  - 监听 tools/result：skill 工具真正执行完后记分
 *  - 命中 exec.name === "skill" → 该 skill 使用次数 +1（按会话去重：同会话只计 1 次，跨会话累加）
 *  - 用 callId 做全局去重：已计过的调用不重复计
 *  - 持久化到 DSH_HOME/.dsh/skill-scoreboard/skill-usage.json（版本化 + 最近生效时间 + 会话去重记录）
 *  - v1.2.0+：注册只读接口 GET /api/skill-scoreboard 供设置页展示
 *  - v1.3.0：浏览器半侧改挂 设置 → 侧边栏 →「Skill 记分板」独立页面（settings.section），
 *    不再使用 设置 → 插件配置 里的卡片位（settings.plugin.item）
 *  - v1.4.0：agent/pre-step 注入（与 dsh-git-push 相同时机，每个 agent 只注入一次）：
 *    记分榜信息 + 每个 skill 的实际文件路径（经 skills 服务解析并扫描兜底，供 AI 参考定位；
 *    设置页 UI 保持不显示路径）
 *  - v1.6.0：同时记录两种记分——count=按会话去重，loads=每次成功加载；设置页可切换展示
 *  - v1.8.0：数据升级 v2——新增顶层 sessions 会话表（{ [sessionId]: { loads, distinct, skills, firstUsedAt, lastUsedAt } }），
 *    记分时同步记会话；GET /api/skill-scoreboard 返回会话榜；旧 v1 数据启动时自动迁移（loads 用 distinct 兜底并标记）。
 *    页面改为三选项卡（Skill 排行 / 会话榜 / 管理），见 lib/client.js。
 *
 * 计分语义：count 与旧 skill-scoreboard.md 一致（同会话同一 skill 只计 1）；loads 每次成功加载都 +1。
 *
 * 不读 agent.session.events：Session 没有公开 events 字段，事件在私有 log 里，
 * 公开入口是 snapshotEvents() / ownEvents()。agent/pre-step 还发生在本步 tool/call 之前，
 * 即便能扫到日志也会漏本步最后一次 skill。
 */
import z from '@deepseek-ai/schemastery';
import { readFileSync, writeFileSync, existsSync, readdirSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
// 2026-09-13：纯工具函数拆至 lib/util.js（文件行数超标 + 复用；实现与原内嵌一致）
import { isPlainObject, num0, emptyV2, errMsg, shortIdOf, fmtShortTime, createSemaphore } from './util.js';
export { fmtShortTime } from './util.js'; // 历史 export 签名保持不变（供外部/测试引用）
// 2026-09-13：web 路由拆至 lib/routes.js（文件行数超标）
import { registerWebRoutes } from './routes.js';

export const name = 'dsh-skill-scoreboard';
export const inject = ['agents'];

const __dirname = dirname(fileURLToPath(import.meta.url));
// DSH_HOME 可能已含 .dsh 后缀（如 .../.dsh-home/.dsh），也可能不含（如 ~/.dsh）
// 统一处理：去除尾部 .dsh 再拼接，确保路径稳定
const rawHome = process.env.DSH_HOME || homedir();
const normalizedHome = String(rawHome).endsWith('/.dsh') || String(rawHome).endsWith('.dsh')
  ? rawHome.replace(/\/\.dsh$/, '').replace(/\.dsh$/, '')
  : rawHome;
/** 注入榜默认条数（injectTopN 配置缺省值；提常量避免散落魔数）。 */
const DEFAULT_INJECT_TOP_N = 25;

const DEFAULT_DATA_DIR = join(normalizedHome, '.dsh', 'skill-scoreboard');
const DATA_FILE = join(DEFAULT_DATA_DIR, 'skill-usage.json');

const Config = z.object({
  enabled: z.boolean().default(true),
  /** 数据文件路径覆盖（默认 $DSH_HOME/.dsh/skill-scoreboard/skill-usage.json） */
  dataFile: z.string().default(DATA_FILE),
  /** v1.4.0：是否在 agent/pre-step 注入记分榜 + skill 路径（默认开） */
  injectEnabled: z.boolean().default(true),
  /** v1.4.0：注入 Top N 个 skill（含路径解析；其余只报总数） */
  injectTopN: z.number().default(DEFAULT_INJECT_TOP_N),
});

/** 读记分数据，缺省返回空结构；父目录不存在时先创建。 */
export async function ensureDataDir(file) {
  await fs.mkdir(dirname(file), { recursive: true });
}

async function loadData(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return migrateToV2(JSON.parse(raw));
  } catch {
    return { version: 2, skills: {}, sessions: {}, updatedAt: null };
  }
}

/**
 * v1.8.0 数据迁移：把任意旧格式统一成 v2 结构。
 * v2 = { version: 2, skills: {...}, sessions: { [sessionId]: { loads, distinct, skills, firstUsedAt, lastUsedAt } } }
 *
 * v1 只有 skills[].sessions[]（会话去重列表），无法还原每个会话的加载次数：
 * 反推时每 skill 每会话记 1 次，distinct 准确、loads 为估计值并标记 loadsEstimated。
 *
 * @param skills - v1 的 skills 表。
 * @returns 反推出的 sessions 表。
 */
export function deriveSessionsFromSkills(skills) {
  const sessions = {};
  const now = new Date().toISOString();
  for (const [skillName, record] of Object.entries(skills || {})) {
    // v1 的 sessions 是去重列表（同会话同一 skill 只 push 一次）；
    // 这里再 Set 一次，防手改文件里出现重复会话 id 时把 loads 计大。
    const sessionIds = Array.isArray(record?.sessions) ? [...new Set(record.sessions.map(String))] : [];
    for (const sessionId of sessionIds) {
      if (!sessionId) continue;
      const entry = sessions[sessionId] || (sessions[sessionId] = {
        loads: 0, distinct: 0, skills: {}, firstUsedAt: null, lastUsedAt: null, loadsEstimated: true,
      });
      entry.skills[skillName] = num0(entry.skills[skillName]) + 1;
      entry.loads += 1;
      const usedAt = record?.lastUsedAt || now;
      if (!entry.firstUsedAt || usedAt < entry.firstUsedAt) entry.firstUsedAt = usedAt;
      if (!entry.lastUsedAt || usedAt > entry.lastUsedAt) entry.lastUsedAt = usedAt;
    }
  }
  for (const entry of Object.values(sessions)) entry.distinct = Object.keys(entry.skills).length;
  return sessions;
}

/**
 * 统一入口：v2 原样返回；v1/未知格式迁移为 v2（幂等）。
 *
 * @param data - 任意版本的记分数据。
 * @returns v2 结构（version/skills/sessions/updatedAt）。
 */
export function migrateToV2(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { version: 2, skills: {}, sessions: {}, updatedAt: null };
  }
  const skills = data.skills && typeof data.skills === 'object' && !Array.isArray(data.skills) ? data.skills : {};
  if (data.version === 2) {
    const sessions = data.sessions && typeof data.sessions === 'object' && !Array.isArray(data.sessions) ? data.sessions : {};
    return { version: 2, skills, sessions, updatedAt: data.updatedAt || null };
  }
  return {
    version: 2,
    skills,
    sessions: deriveSessionsFromSkills(skills),
    updatedAt: data.updatedAt || new Date().toISOString(),
  };
}

/** 原子写（临时文件 + rename，避免写一半）；路径不存在先 mkdir。 */
async function saveData(file, data) {
  await ensureDataDir(file);
  const tmpFile = `${file}.tmp`;
  const payload = { ...data, updatedAt: data.updatedAt || new Date().toISOString() };
  await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(tmpFile, file);
}

/** 归一化单条 skill 记录（缺字段补默认，数字字段转数值）。 */
function normalizeSkillEntry(record) {
  const count = num0(record?.count);
  return {
    count,
    loads: num0(record?.loads) || count,
    lastUsedAt: record?.lastUsedAt || null,
    sessions: Array.isArray(record?.sessions) ? record.sessions.map(String) : [],
    callIds: Array.isArray(record?.callIds) ? record.callIds.map(String) : [],
  };
}

/** 归一化单条会话记录：skills 子表只保留正数次数，distinct 由子表重算。 */
function normalizeSessionEntry(record) {
  const skillCounts = {};
  let summedLoads = 0;
  if (record?.skills && typeof record.skills === 'object' && !Array.isArray(record.skills)) {
    for (const [skillName, rawCount] of Object.entries(record.skills)) {
      const skillLoads = num0(rawCount);
      if (skillLoads > 0) {
        skillCounts[skillName] = skillLoads;
        summedLoads += skillLoads;
      }
    }
  }
  const entry = {
    loads: num0(record?.loads) || summedLoads,
    distinct: Object.keys(skillCounts).length,
    skills: skillCounts,
    firstUsedAt: record?.firstUsedAt || null,
    lastUsedAt: record?.lastUsedAt || null,
  };
  if (record?.loadsEstimated) entry.loadsEstimated = true;
  return entry;
}

/** 归一化 skills 子表：按名 trim 后逐条规范化，空名跳过。 */
function normalizeSkillsTable(skillsIn) {
  const skills = {};
  for (const [name, record] of Object.entries(skillsIn)) {
    const skillName = String(name || '').trim();
    if (!skillName) continue;
    skills[skillName] = normalizeSkillEntry(record);
  }
  return skills;
}

/** 归一化 sessions 子表：按 id trim 后逐条规范化，空 id 跳过。 */
function normalizeSessionsTable(sessionsIn) {
  const sessions = {};
  for (const [rawId, record] of Object.entries(sessionsIn)) {
    const sessionId = String(rawId || '').trim();
    if (!sessionId) continue;
    sessions[sessionId] = normalizeSessionEntry(record);
  }
  return sessions;
}

/**
 * 校验并归一化导入体：{ version, skills, sessions? }。
 * v1 体（无 sessions）自动从 skills[].sessions 反推会话表。
 *
 * @param raw - JSON 文本或对象。
 * @returns v2 结构。
 */
export function normalizeScoreboardPayload(raw) {
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!isPlainObject(payload)) {
    throw new Error('记分文件必须是 JSON 对象');
  }
  const skillsIn = isPlainObject(payload.skills) ? payload.skills : null;
  if (!skillsIn) throw new Error('记分文件缺少 skills 对象');
  const skills = normalizeSkillsTable(skillsIn);
  const sessionsIn = isPlainObject(payload.sessions) ? payload.sessions : null;
  const sessions = sessionsIn ? normalizeSessionsTable(sessionsIn) : deriveSessionsFromSkills(skills);
  return {
    version: 2,
    skills,
    sessions,
    updatedAt: payload.updatedAt || new Date().toISOString(),
  };
}

/** 合并两条 skill 记录：次数累加、会话与调用 id 取并集、最近时间取较晚者。 */
function mergeSkillEntries(previous, incoming) {
  const sessions = [...new Set([...(previous.sessions || []), ...(incoming.sessions || [])])];
  const callIds = [...new Set([...(previous.callIds || []), ...(incoming.callIds || [])])];
  const previousLoads = num0(previous.loads) || num0(previous.count);
  const incomingLoads = num0(incoming.loads) || num0(incoming.count);
  const lastUsedAt = (incoming.lastUsedAt || '') > (previous.lastUsedAt || '')
    ? incoming.lastUsedAt
    : previous.lastUsedAt;
  return {
    count: num0(previous.count) + num0(incoming.count),
    loads: previousLoads + incomingLoads,
    lastUsedAt,
    sessions,
    callIds,
  };
}

/** 合并两条会话记录：loads 相加、skills 子表按名累加、distinct 重算、时间取最早/最晚。 */
function mergeSessionEntries(baseEntry, extraEntry) {
  const skillCounts = { ...(baseEntry.skills || {}) };
  for (const [skillName, rawCount] of Object.entries(extraEntry.skills || {})) {
    const count = num0(rawCount);
    if (count > 0) skillCounts[skillName] = (Number(skillCounts[skillName]) || 0) + count;
  }
  const entry = {
    loads: num0(baseEntry.loads) + num0(extraEntry.loads),
    distinct: Object.keys(skillCounts).length,
    skills: skillCounts,
    firstUsedAt: (baseEntry.firstUsedAt || extraEntry.firstUsedAt) || null,
    lastUsedAt: (extraEntry.lastUsedAt || baseEntry.lastUsedAt) || null,
  };
  if (baseEntry.loadsEstimated || extraEntry.loadsEstimated) entry.loadsEstimated = true;
  return entry;
}

/** 合并两张 skills 表：同名累加（mergeSkillEntries），新名直接并入。 */
function mergeSkillTables(baseSkills, extraSkills) {
  const skills = { ...baseSkills };
  for (const [skillName, record] of Object.entries(extraSkills)) {
    const previous = skills[skillName];
    skills[skillName] = previous ? mergeSkillEntries(previous, record) : { ...record };
  }
  return skills;
}

/** 合并两张 sessions 表：按会话 id 并集，逐条 mergeSessionEntries。 */
function mergeSessionTables(baseSessions, extraSessions) {
  const sessions = {};
  const emptySession = { loads: 0, skills: {}, firstUsedAt: null, lastUsedAt: null };
  for (const sessionId of new Set([...Object.keys(baseSessions), ...Object.keys(extraSessions)])) {
    sessions[sessionId] = mergeSessionEntries(
      baseSessions[sessionId] || emptySession,
      extraSessions[sessionId] || emptySession,
    );
  }
  return sessions;
}

/**
 * merge=true 时按 skill 名累加次数、合并会话/callId；会话题同样按会话 id 合并。
 *
 * @param current - 现有数据（可为 v1）。
 * @param incoming - 导入数据（v2）。
 * @returns 合并后的 v2 数据。
 */
export function mergeScoreboard(current, incoming) {
  const baseSkills = isPlainObject(current?.skills) ? current.skills : {};
  const extraSkills = isPlainObject(incoming?.skills) ? incoming.skills : {};
  const baseSessions = isPlainObject(current?.sessions) ? current.sessions : {};
  const extraSessions = isPlainObject(incoming?.sessions) ? incoming.sessions : {};
  return {
    version: 2,
    skills: mergeSkillTables(baseSkills, extraSkills),
    sessions: mergeSessionTables(baseSessions, extraSessions),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 记一次 skill 使用：count 按会话去重，loads 每次 +1，callId 防重复。
 *
 * @param data - 内存态记分数据（原地修改）。
 * @param skillName - skill 名。
 * @param sessionId - 会话 id（用于去重判定）。
 * @param callId - 工具调用 id，可为空。
 */
function recordSkillUse(data, skillName, sessionId, callId) {
  const previous = data.skills[skillName];
  const target = previous ?? { count: 0, loads: 0, lastUsedAt: null, sessions: [], callIds: [] };
  if (typeof target.loads !== 'number') target.loads = target.count || 0;
  target.loads += 1;
  const seenInSession = !!(previous && previous.sessions?.includes(sessionId));
  if (!seenInSession) {
    target.count += 1;
    target.sessions = target.sessions || [];
    if (!target.sessions.includes(sessionId)) target.sessions.push(sessionId);
  }
  target.lastUsedAt = new Date().toISOString();
  target.callIds = target.callIds ?? [];
  if (callId) target.callIds.push(callId);
  data.skills[skillName] = target;
}

/**
 * v1.8.0：记一次会话维度的使用（该会话加载过哪些 skill、各几次），供会话榜使用。
 * sessionId 为 'unknown'（取不到会话）时不记。
 *
 * @param data - 内存态记分数据（原地修改）。
 * @param sessionId - 会话 id。
 * @param skillName - skill 名。
 */
function recordSessionUse(data, sessionId, skillName) {
  if (!sessionId || sessionId === 'unknown') return;
  const now = new Date().toISOString();
  const entry = data.sessions[sessionId]
    || { loads: 0, distinct: 0, skills: {}, firstUsedAt: null, lastUsedAt: null };
  entry.skills[skillName] = (entry.skills[skillName] || 0) + 1;
  entry.loads += 1;
  entry.distinct = Object.keys(entry.skills).length;
  entry.firstUsedAt = entry.firstUsedAt || now;
  entry.lastUsedAt = now;
  delete entry.loadsEstimated; // 已有真实数据，不再标估计
  data.sessions[sessionId] = entry;
}

function skillNameFromArgs(args) {
  try {
    const parsed = typeof args === 'string' ? JSON.parse(args) : args;
    return parsed?.name ?? '';
  } catch {
    return '';
  }
}

/**
 * read 工具入参解析：file_path → 归一化绝对路径。
 * @returns {string} 绝对路径；解析失败返回空串。
 */
function readPathFromArgs(args) {
  try {
    const parsed = typeof args === 'string' ? JSON.parse(args) : args;
    const raw = parsed?.file_path || parsed?.filePath || '';
    if (typeof raw !== 'string' || !raw.trim()) return '';
    return resolve(raw.trim());
  } catch {
    return '';
  }
}

/**
 * v1.8.2：构造「skill 文件路径 → skill 名」索引（read 直接读文件也记分）。
 * 懒构建 + TTL 刷新：首次/超时后异步重建（resolveSkillPath 涉及 skills 服务查询），
 * 构建完成前用旧索引匹配，避免阻塞 tools/result 主链路。
 *
 * @param getNames - () => string[] 已知 skill 名列表（当前记分数据的 keys）。
 * @param skillsSvc - skills 服务（可为 null，走文件系统扫描兜底）。
 * @returns {{ find: (absPath: string) => string, build: () => Promise<void> }}
 */
export function makeSkillPathIndex(getNames, skillsSvc = null) {
  let index = new Map();
  let building = null;
  let builtAt = 0;
  const TTL_MS = 5 * 60_000;

  async function build() {
    const names = Array.isArray(getNames()) ? getNames() : [];
    const next = new Map();
    await Promise.all(names.map(async (name) => {
      try {
        const p = await resolveSkillPath(name, skillsSvc);
        if (typeof p === 'string' && p) {
          const abs = resolve(p);
          next.set(abs, name);
          const base = basename(abs);
          if (base) next.set(base, name); // basename 兜底（相对/不同前缀解析差异）
        }
      } catch { /* 单个失败不阻断 */ }
    }));
    index = next;
    builtAt = Date.now();
    building = null;
  }

  function find(absPath) {
    if (!absPath) return '';
    if (!building && (builtAt === 0 || Date.now() - builtAt > TTL_MS)) {
      building = build().catch(() => { building = null; });
    }
    return index.get(absPath) || index.get(basename(absPath)) || '';
  }

  return { find, build };
}

/**
 * read 工具记分：file_path 命中已知 skill 文件路径 → 返回 skill 名。
 * @param args - 工具参数。
 * @param pathIndex - makeSkillPathIndex 产物（缺省时按参数名猜，不建索引）。
 * @returns {string} skill 名；未命中返回空串。
 */
export function skillNameFromReadArgs(args, pathIndex = null) {
  if (!pathIndex || typeof pathIndex.find !== 'function') return '';
  const abs = readPathFromArgs(args);
  if (!abs) return '';
  return pathIndex.find(abs);
}

function guessSkillFile(base, name) {
  if (!base) return '';
  const candidates = [join(base, `${name}.md`), join(base, name, 'SKILL.md'), join(base, name, `${name}.md`)];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return existsSync(base) ? base : '';
}

function pathFromSkillDef(def, name) {
  if (!def || typeof def !== 'object') return '';
  if (typeof def.path === 'string' && def.path) return def.path;
  const rb = def.resourceBase;
  if (rb && rb.kind === 'directory' && typeof rb.path === 'string' && rb.path) {
    return guessSkillFile(rb.path, name) || rb.path;
  }
  return '';
}

function scanSkillDirs(name) {
  const dirs = [];
  const cwd = process.cwd();
  const home = homedir();
  const dshHome = process.env.DSH_HOME || home;
  dirs.push(join(cwd, '.dsh-home', '工作区', 'ai-work-archive', 'skills'));
  dirs.push(join(cwd, '.dsh-home', '.dsh', 'skills'));
  dirs.push(join(dshHome, '.dsh', 'skills'));
  dirs.push(join(home, '.dsh', 'skills'));
  const workspace = join(cwd, '.dsh-home', '工作区');
  if (existsSync(workspace)) {
    try {
      for (const ent of readdirSync(workspace, { withFileTypes: true })) {
        if (ent.isDirectory()) dirs.push(join(workspace, ent.name, 'skills'));
      }
    } catch { /* 目录/单文件扫描失败不阻断主流程 */ }
  }
  for (const dir of dirs) {
    const hit = guessSkillFile(dir, name);
    if (hit) return hit;
  }
  return '';
}

export async function resolveSkillPath(name, skillsSvc = null) {
  if (skillsSvc && typeof skillsSvc.get === 'function') {
    try {
      const def = await skillsSvc.get(name);
      const fromDef = pathFromSkillDef(def, name);
      if (fromDef) return fromDef;
    } catch { /* 目录/单文件扫描失败不阻断主流程 */ }
  }
  if (skillsSvc && typeof skillsSvc.list === 'function') {
    try {
      const list = await skillsSvc.list();
      const hit = Array.isArray(list) ? list.find((s) => s && s.name === name) : null;
      const fromList = pathFromSkillDef(hit, name);
      if (fromList) return fromList;
    } catch { /* 目录/单文件扫描失败不阻断主流程 */ }
  }
  return scanSkillDirs(name);
}

/**
 * v1.4.0：构建记分榜注入文本（纯函数，可单测）。
 * 读记分文件 → 按次数降序 → Top N 行，每行经 skills 服务 + 文件系统扫描解析实际路径。
 * @param {{ file: string, topN?: number, skillsSvc?: object }} opts
 * @returns {Promise<string>} 注入正文；无记录时返回空串
 */
export async function buildScoreboardInjection({ file, topN = 25, skillsSvc = null }) {
  let current;
  try { current = JSON.parse(await fs.readFile(file, 'utf8')); } catch { current = null; }
  const recs = (current && typeof current === 'object' ? current.skills : null) || {};
  const rows = Object.entries(recs)
    .map(([n, rec]) => ({
      name: n,
      count: rec?.count || 0,
      loads: rec?.loads || rec?.count || 0,
      lastUsedAt: rec?.lastUsedAt || null,
    }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  if (!rows.length) return '';
  const totalCount = rows.reduce((s, x) => s + x.count, 0);
  const totalLoads = rows.reduce((s, x) => s + x.loads, 0);
  const top = rows.slice(0, Math.max(0, topN || 0));
  const paths = await Promise.all(top.map((row) => resolveSkillPath(row.name, skillsSvc).catch(() => '')));
  const lines = [
    '【dsh-skill-scoreboard 注入：skill 使用记分榜】AI 会话实际加载过的 skill 统计。count=按会话去重（同会话同一 skill 只计 1），loads=每次成功加载都计。数据源 DSH_HOME/.dsh/skill-scoreboard/skill-usage.json。供参考：常用/已加载过的 skill 及其实际文件路径，避免无谓重复加载、便于定位 skill 文件：',
    '',
    `- 共 ${rows.length} 个 skill、会话去重累计 ${totalCount} 次、加载累计 ${totalLoads} 次（Top ${top.length}）：`,
  ];
  for (let i = 0; i < top.length; i++) {
    const row = top[i];
    const path = paths[i] || '';
    const pathBit = path ? ` → ${path}` : ' → （未找到文件路径）';
    lines.push(`  ${i + 1}. ${row.name} 会话去重 ×${row.count} / 加载 ×${row.loads}（最近 ${fmtShortTime(row.lastUsedAt)}）${pathBit}`);
  }
  lines.push('', '（完整榜单见 设置 → 侧边栏 → Skill 记分板；页面三个选项卡：Skill 排行 / 会话榜 / 管理；Skill 排行按会话去重降序并分页，去重与加载两种次数同时显示）');
  return lines.join('\n');
}

/**
 * 折叠会话日志事件，取最近一条 `session/title` 的标题（同 dsh-session-conductor 的 foldTitle）。
 *
 * @param events - 会话事件数组（sessionPersistence.inspect 返回）。
 * @returns 最近一次持久化标题；无则空串。
 */
export function foldTitleFromEvents(events) {
  if (!Array.isArray(events)) return '';
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev && ev.type === 'session/title' && typeof ev.data?.title === 'string' && ev.data.title.trim() !== '') {
      return ev.data.title;
    }
  }
  return '';
}

/**
 * 标题兜底：取工作目录路径最后一段（与 displayTitleOf 的 project basename 一致）。
 */
function titleFromCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd) return '';
  const parts = String(cwd).split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * 构造会话标题解析器（v1.8.2）：给 API 的每个会话行补标题。
 * 依次尝试：① 活跃会话列表快照 displayTitle（免费）；② sessionPersistence.inspect 读日志折叠
 * session/title 事件（历史会话）；③ header.cwd 目录名兜底；④ 原样返回会话 id。
 * 带 TTL 内存缓存，避免每次 API 全量解压日志。
 *
 * @param ctx - cordis 上下文（get('sessions') / get('sessionPersistence') 可能缺失，自动降级）。
 * @returns async (sessionId) => title
 */

/** ① 活跃会话列表快照取 displayTitle：byId 的 key 兼容裸 id / session- 前缀两种形态。 */
function titleFromSessionSnapshot(sessionsSvc, key) {
  if (!sessionsSvc || typeof sessionsSvc.list?.getSnapshot !== 'function') return '';
  try {
    const byId = sessionsSvc.list.getSnapshot()?.byId || {};
    const row = byId[key] || byId['session-' + key] || byId[String(key).replace(/^session-/, '')];
    if (row && typeof row.displayTitle === 'string' && row.displayTitle) return row.displayTitle;
  } catch { /* 忽略 */ }
  return '';
}

/** ② 读持久化日志折叠标题（限并发）：session/title 事件优先，meta.cwd 目录名兜底。 */
async function titleFromInspect(persistence, limit, key) {
  if (!persistence || typeof persistence.inspect !== 'function') return '';
  try {
    const loaded = await limit.run(() => persistence.inspect(key));
    const title = foldTitleFromEvents(loaded?.events);
    if (title) return title;
    if (loaded?.meta && typeof loaded.meta.cwd === 'string') return titleFromCwd(loaded.meta.cwd);
  } catch { /* 读不到就继续降级 */ }
  return '';
}

/** 标题缓存键是否已知（内存 resolved 或磁盘 disk）。 */
function cachedTitle(resolved, disk, key) {
  if (resolved.has(key)) return { title: resolved.get(key), fromMemory: true };
  if (Object.prototype.hasOwnProperty.call(disk, key)) return { title: disk[key], fromMemory: false };
  return null;
}

/**
 * 构造会话标题解析器（v1.8.2）：给 API 的每个会话行补标题。
 * 依次尝试：① 活跃会话列表快照 displayTitle（免费）；② sessionPersistence.inspect 读日志折叠
 * session/title 事件（历史会话）；③ header.cwd 目录名兜底；④ 短 id 兜底。
 *
 * 性能（学 dsh-session-conductor）：inspect 要解压整份会话日志，19 个会话并发解压实测首请求
 * 8.8s，且在 loading 期间反复操作设置面板会出问题。故：
 *  - 并发限流（同时最多 2 个 inspect）
 *  - 解析结果落盘缓存（`<数据目录>/session-titles.json`，仅存「日志里的真实标题」，兜底短 id 不落盘），重启不丢
 *  - apply 后由 warm() 后台预热全部已知会话，API 只读缓存、瞬时返回
 *
 * @param ctx        - cordis 上下文（get('sessions') / get('sessionPersistence') 可能缺失，自动降级）。
 * @param cacheFile  - 标题缓存文件路径（缺省不落盘，仅内存）。
 * @returns {{ resolve: (id: string) => Promise<string>, warm: () => Promise<void> }}
 */
export function makeTitleResolver(ctx, cacheFile = null) {
  const limit = createSemaphore(2);
  const resolved = new Map(); // key -> 真实标题（仅日志解析出的；活跃快照命中不缓存，防 stale）
  let sessionsSvc = null;
  let persistence = null;
  try { sessionsSvc = ctx?.get?.('sessions') ?? null; } catch { sessionsSvc = null; }
  try { persistence = ctx?.get?.('sessionPersistence') ?? null; } catch { persistence = null; }

  // 落盘缓存（只存真实标题；结构 { [id]: title }）
  function loadCacheFile() {
    if (!cacheFile) return {};
    try {
      const raw = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    } catch { /* 无缓存/损坏则空 */ }
    return {};
  }
  const disk = loadCacheFile();
  let saveQueued = false;
  function persist() {
    if (!cacheFile || saveQueued) return;
    saveQueued = true;
    Promise.resolve().then(() => {
      saveQueued = false;
      try {
        const cacheMap = {};
        for (const [k, v] of resolved) if (typeof v === 'string' && v) cacheMap[k] = v;
        writeFileSync(cacheFile, JSON.stringify(cacheMap, null, 2), 'utf8');
      } catch (e) {
        console.log(`[skill-scoreboard] ⚠️ 标题缓存写盘失败: ${errMsg(e)}`);
      }
    });
  }

  async function resolveOne(key) {
    // ① 活跃会话列表快照 displayTitle（免费）；② 历史日志折叠标题（限并发，含 cwd 兜底）
    return titleFromSessionSnapshot(sessionsSvc, key) || await titleFromInspect(persistence, limit, key);
  }

  /** 解析单个会话标题：磁盘/内存缓存命中直接返回；否则现场解析（限并发）并落盘。 */
  async function resolve(id) {
    const key = String(id ?? '');
    if (!key) return '';
    const hit = cachedTitle(resolved, disk, key);
    if (hit) {
      if (!hit.fromMemory) resolved.set(key, hit.title);
      return hit.title;
    }
    try {
      const title = await resolveOne(key);
      if (title) {
        resolved.set(key, title);
        persist();
        return title;
      }
    } catch { /* 单个失败不阻断 */ }
    return shortIdOf(key); // 兜底：显示会话短 id（前 8 位裸 uuid）
  }

  /** 后台预热：解析全部已知会话（限并发逐批），完成后落盘。不等待、不抛错。 */
  async function warm(knownIds = []) {
    const tasks = [];
    for (const id of knownIds) {
      const key = String(id ?? '');
      if (!key || cachedTitle(resolved, disk, key)) continue;
      tasks.push(resolve(key));
    }
    if (!tasks.length) return;
    try { await Promise.all(tasks); } catch { /* 预热失败不影响主链路 */ }
  }

  return { resolve, warm };
}

/**
 * 读磁盘记分数据并统一成 v2：磁盘文件可能还是 v1（迁移只在内存做、下次写盘才落 v2），
 * 这里再过一次，保证「启动后还没发生新记分」时 API 也能给出会话榜。
 *
 * @param file - 数据文件路径。
 * @returns v2 结构。
 */
function readCurrentData(file) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch { parsed = emptyV2(); }
  return migrateToV2(parsed);
}

/**
 * skill 榜行：按会话去重次数降序（并列按名称）。
 *
 * @param current - v2 数据。
 * @returns 行数组（含 name/count/loads/lastUsedAt）。
 */
function skillRankRows(current) {
  return Object.entries(current.skills || {})
    .map(([name, record]) => ({
      name,
      count: record?.count || 0,
      loads: record?.loads || record?.count || 0,
      lastUsedAt: record?.lastUsedAt || null,
    }))
    .sort((left, right) => right.count - left.count || String(left.name).localeCompare(String(right.name)));
}

/**
 * 会话榜行：按去重 skill 数降序（越多越靠前），并列按加载次数、再按最近使用。
 *
 * @param current - v2 数据。
 * @returns 行数组（含 id/loads/distinct/skills/firstUsedAt/lastUsedAt/loadsEstimated）。
 */
function sessionRankRows(current) {
  return Object.entries(current.sessions || {})
    .map(([id, record]) => ({
      id,
      loads: record?.loads || 0,
      distinct: record?.distinct || Object.keys(record?.skills || {}).length,
      skills: Object.keys(record?.skills || {}),
      firstUsedAt: record?.firstUsedAt || null,
      lastUsedAt: record?.lastUsedAt || null,
      loadsEstimated: !!record?.loadsEstimated,
    }))
    .sort((left, right) => right.distinct - left.distinct
      || right.loads - left.loads
      || String(right.lastUsedAt || '').localeCompare(String(left.lastUsedAt || '')));
}

export async function apply(ctx, config = {}) {
  const cfg = Config(config);
  if (cfg.enabled === false) {
    console.log('[skill-scoreboard] 已禁用');
    return;
  }
  const file = cfg.dataFile;
  await ensureDataDir(file);
  let store = await loadData(file);
  // v1.8.0：统一 v2 结构（v1 旧数据在此迁移，loads 用 distinct 兜底并标记 loadsEstimated）
  if (!store.sessions) store.sessions = {};
  let writeChain = Promise.resolve();
  // v1.8.2：read 工具直接读 skill 文件也记分（懒构建路径索引，TTL 5 分钟）
  const skillPathIndex = makeSkillPathIndex(
    () => Object.keys(store.skills || {}),
    typeof ctx.get === 'function' ? ctx.get('skills') : null,
  );

  ctx.on('tools/result', (exec, result) => {
    if (result?.isError) return;
    // v1.6.0：仅 skill 工具记分；v1.8.2：read 工具命中 skill 文件路径同样记分（AI 直接读文件 = 加载）
    if (exec?.name !== 'skill' && exec?.name !== 'read') return;
    let skillName = '';
    if (exec?.name === 'skill') {
      skillName = skillNameFromArgs(exec.arguments);
    } else {
      skillName = skillNameFromReadArgs(exec.arguments, skillPathIndex);
    }
    if (!skillName) return;
    const sessionId = exec.agent?.session?.id || exec.agent?.id || 'unknown';
    const callId = exec.callId || '';

    writeChain = writeChain.then(async () => {
      const record = store.skills[skillName];
      if (callId && record?.callIds?.includes(callId)) return;
      recordSkillUse(store, skillName, sessionId, callId);
      recordSessionUse(store, sessionId, skillName);
      try { await saveData(file, store); }
      catch (e) { console.log(`[skill-scoreboard] ⚠️ 写数据失败: ${errMsg(e)}`); }
    }).catch((e) => {
      console.log(`[skill-scoreboard] ⚠️ 记分失败: ${errMsg(e)}`);
    });
  });

  console.log(`[skill-scoreboard] ✅ 已启动，数据文件: ${file}，当前记录 ${Object.keys(store.skills).length} 个 skill`);

  // v1.4.0 agent/pre-step 注入（与 dsh-git-push 相同时机与形态）：
  // 每个 agent 首次 step 注入一次记分榜 + skill 实际路径，供 AI 参考。
  // 异步 get 路径不影响主链路；失败时降级为不带路径的榜单。
  if (cfg.injectEnabled) {
    const injectedAgents = new WeakSet();
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next();
      if (decision.kind === 'reject') return decision;
      if (signal?.aborted) return decision;
      if (injectedAgents.has(agent)) return decision;
      injectedAgents.add(agent);
      try {
        const text = await buildScoreboardInjection({
          file,
          topN: cfg.injectTopN,
          skillsSvc: ctx.get('skills'),
        });
        if (!text) return decision;
        return {
          ...decision,
          messages: [
            ...decision.messages,
            createUserMessage({
              content: [{ type: 'text', text }],
              source: { kind: 'plugin', plugin: name, form: 'instructions' },
            }),
          ],
        };
      } catch (e) {
        console.log(`[skill-scoreboard] ⚠️ 注入失败: ${errMsg(e)}`);
        return decision;
      }
    });
  }

  // v1.2.0 设置页展示 + v1.8.0 会话榜：只读接口与导入导出（回调必须同步）
  // v1.8.2：会话标题解析器（限并发 + 落盘缓存 + 后台预热，避免 API 冷启动 8.8s 卡面板）
  const titleResolver = makeTitleResolver(ctx, join(dirname(file), 'session-titles.json'));
  registerWebRoutes(ctx, {
    file,
    titleResolver,
    onImported: (next) => { store = next; },
  }, {
    readCurrentData,
    skillRankRows,
    sessionRankRows,
    saveData,
    normalizeScoreboardPayload,
    mergeScoreboard,
  });
  // 后台预热：解析全部已知会话标题并落盘，不阻塞路由注册/API 首响应
  titleResolver.warm(Object.keys(store.sessions || {}).concat(Object.keys(store.skills || {})
    .flatMap((n) => (store.skills[n]?.sessions || []).map(String))))
    .catch(() => { /* 后台预热失败不影响主链路（标题解析是增强，缺省显示短 id） */ });
}
