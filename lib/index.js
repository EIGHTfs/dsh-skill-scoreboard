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
import { readFileSync, existsSync, readdirSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const name = 'dsh-skill-scoreboard';
export const inject = ['agents'];

const __dirname = dirname(fileURLToPath(import.meta.url));
// DSH_HOME 可能已含 .dsh 后缀（如 .../.dsh-home/.dsh），也可能不含（如 ~/.dsh）
// 统一处理：去除尾部 .dsh 再拼接，确保路径稳定
const rawHome = process.env.DSH_HOME || homedir();
const normalizedHome = String(rawHome).endsWith('/.dsh') || String(rawHome).endsWith('.dsh')
  ? rawHome.replace(/\/\.dsh$/, '').replace(/\.dsh$/, '')
  : rawHome;
const DEFAULT_DATA_DIR = join(normalizedHome, '.dsh', 'skill-scoreboard');
const DATA_FILE = join(DEFAULT_DATA_DIR, 'skill-usage.json');

const Config = z.object({
  enabled: z.boolean().default(true),
  /** 数据文件路径覆盖（默认 $DSH_HOME/.dsh/skill-scoreboard/skill-usage.json） */
  dataFile: z.string().default(DATA_FILE),
  /** v1.4.0：是否在 agent/pre-step 注入记分榜 + skill 路径（默认开） */
  injectEnabled: z.boolean().default(true),
  /** v1.4.0：注入 Top N 个 skill（含路径解析；其余只报总数） */
  injectTopN: z.number().default(25),
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
      entry.skills[skillName] = (entry.skills[skillName] || 0) + 1;
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
  const tmp = `${file}.tmp`;
  const payload = { ...data, updatedAt: data.updatedAt || new Date().toISOString() };
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

/** 归一化单条 skill 记录（缺字段补默认，数字字段转数值）。 */
function normalizeSkillEntry(record) {
  const count = Number(record?.count) || 0;
  return {
    count,
    loads: Number(record?.loads) || count,
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
      const skillLoads = Number(rawCount) || 0;
      if (skillLoads > 0) {
        skillCounts[skillName] = skillLoads;
        summedLoads += skillLoads;
      }
    }
  }
  const entry = {
    loads: Number(record?.loads) || summedLoads,
    distinct: Object.keys(skillCounts).length,
    skills: skillCounts,
    firstUsedAt: record?.firstUsedAt || null,
    lastUsedAt: record?.lastUsedAt || null,
  };
  if (record?.loadsEstimated) entry.loadsEstimated = true;
  return entry;
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
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('记分文件必须是 JSON 对象');
  }
  const skillsIn = payload.skills && typeof payload.skills === 'object' && !Array.isArray(payload.skills) ? payload.skills : null;
  if (!skillsIn) throw new Error('记分文件缺少 skills 对象');
  const skills = {};
  for (const [name, record] of Object.entries(skillsIn)) {
    const skillName = String(name || '').trim();
    if (!skillName) continue;
    skills[skillName] = normalizeSkillEntry(record);
  }
  const sessionsIn = payload.sessions && typeof payload.sessions === 'object' && !Array.isArray(payload.sessions) ? payload.sessions : null;
  const sessions = sessionsIn ? {} : deriveSessionsFromSkills(skills);
  if (sessionsIn) {
    for (const [rawId, record] of Object.entries(sessionsIn)) {
      const sessionId = String(rawId || '').trim();
      if (!sessionId) continue;
      sessions[sessionId] = normalizeSessionEntry(record);
    }
  }
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
  const previousLoads = Number(previous.loads) || Number(previous.count) || 0;
  const incomingLoads = Number(incoming.loads) || Number(incoming.count) || 0;
  const lastUsedAt = (incoming.lastUsedAt || '') > (previous.lastUsedAt || '')
    ? incoming.lastUsedAt
    : previous.lastUsedAt;
  return {
    count: (Number(previous.count) || 0) + (Number(incoming.count) || 0),
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
    const count = Number(rawCount) || 0;
    if (count > 0) skillCounts[skillName] = (Number(skillCounts[skillName]) || 0) + count;
  }
  const entry = {
    loads: (Number(baseEntry.loads) || 0) + (Number(extraEntry.loads) || 0),
    distinct: Object.keys(skillCounts).length,
    skills: skillCounts,
    firstUsedAt: (baseEntry.firstUsedAt || extraEntry.firstUsedAt) || null,
    lastUsedAt: (extraEntry.lastUsedAt || baseEntry.lastUsedAt) || null,
  };
  if (baseEntry.loadsEstimated || extraEntry.loadsEstimated) entry.loadsEstimated = true;
  return entry;
}

/**
 * merge=true 时按 skill 名累加次数、合并会话/callId；会话题同样按会话 id 合并。
 *
 * @param current - 现有数据（可为 v1）。
 * @param incoming - 导入数据（v2）。
 * @returns 合并后的 v2 数据。
 */
export function mergeScoreboard(current, incoming) {
  const baseSkills = current?.skills && typeof current.skills === 'object' ? current.skills : {};
  const extraSkills = incoming?.skills && typeof incoming.skills === 'object' ? incoming.skills : {};
  const skills = { ...baseSkills };
  for (const [skillName, record] of Object.entries(extraSkills)) {
    const previous = skills[skillName];
    skills[skillName] = previous ? mergeSkillEntries(previous, record) : { ...record };
  }
  const baseSessions = current?.sessions && typeof current.sessions === 'object' ? current.sessions : {};
  const extraSessions = incoming?.sessions && typeof incoming.sessions === 'object' ? incoming.sessions : {};
  const sessions = {};
  for (const sessionId of new Set([...Object.keys(baseSessions), ...Object.keys(extraSessions)])) {
    sessions[sessionId] = mergeSessionEntries(
      baseSessions[sessionId] || { loads: 0, skills: {}, firstUsedAt: null, lastUsedAt: null },
      extraSessions[sessionId] || { loads: 0, skills: {}, firstUsedAt: null, lastUsedAt: null },
    );
  }
  return { version: 2, skills, sessions, updatedAt: new Date().toISOString() };
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
    const obj = typeof args === 'string' ? JSON.parse(args) : args;
    return obj?.name ?? '';
  } catch {
    return '';
  }
}

/** ISO 时间 → 本地可读短格式 */
export function fmtShortTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(iso).slice(0, 16).replace('T', ' ');
  }
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
    } catch {}
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
    } catch {}
  }
  if (skillsSvc && typeof skillsSvc.list === 'function') {
    try {
      const list = await skillsSvc.list();
      const hit = Array.isArray(list) ? list.find((s) => s && s.name === name) : null;
      const fromList = pathFromSkillDef(hit, name);
      if (fromList) return fromList;
    } catch {}
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
  lines.push('', '（完整榜单见 设置 → 侧边栏 → Skill 记分板；页面三个选项卡：Skill 排行 / 会话榜 / 管理；Skill 内可切换去重/全部两种排行并分页）');
  return lines.join('\n');
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
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch { parsed = { version: 2, skills: {}, sessions: {} }; }
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
  let data = await loadData(file);
  // v1.8.0：统一 v2 结构（v1 旧数据在此迁移，loads 用 distinct 兜底并标记 loadsEstimated）
  if (!data.sessions) data.sessions = {};
  let writeChain = Promise.resolve();

  ctx.on('tools/result', (exec, result) => {
    if (result?.isError) return;
    if (exec?.name !== 'skill') return;
    const skillName = skillNameFromArgs(exec.arguments);
    if (!skillName) return;
    const sessionId = exec.agent?.session?.id || exec.agent?.id || 'unknown';
    const callId = exec.callId || '';

    writeChain = writeChain.then(async () => {
      const record = data.skills[skillName];
      if (callId && record?.callIds?.includes(callId)) return;
      recordSkillUse(data, skillName, sessionId, callId);
      recordSessionUse(data, sessionId, skillName);
      try { await saveData(file, data); }
      catch (e) { console.log(`[skill-scoreboard] ⚠️ 写数据失败: ${String(e?.message ?? e).slice(0, 120)}`); }
    }).catch((e) => {
      console.log(`[skill-scoreboard] ⚠️ 记分失败: ${String(e?.message ?? e).slice(0, 120)}`);
    });
  });

  console.log(`[skill-scoreboard] ✅ 已启动，数据文件: ${file}，当前记录 ${Object.keys(data.skills).length} 个 skill`);

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
        console.log(`[skill-scoreboard] ⚠️ 注入失败: ${String(e?.message ?? e).slice(0, 120)}`);
        return decision;
      }
    });
  }

  // v1.2.0 设置页展示 + v1.8.0 会话榜：只读接口与导入导出（回调必须同步）
  registerWebRoutes(ctx, {
    file,
    onImported: (next) => { data = next; },
  });
}


/** 单次 API 返回的最大行数（前端自己分页，这里只兜底防止极端数据量）。 */
const API_ROW_LIMIT = 200;

/** 统一 JSON 响应写法（所有只读接口共用）。 */
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

/**
 * 组装 GET /api/skill-scoreboard 的返回体：skill 榜 + 会话榜 + 概览字段。
 *
 * @param file - 数据文件路径。
 * @returns 响应体对象。
 */
function buildSnapshot(file) {
  const current = readCurrentData(file);
  const skills = skillRankRows(current).slice(0, API_ROW_LIMIT);
  const sessions = sessionRankRows(current).slice(0, API_ROW_LIMIT);
  const total = skills.reduce((sum, row) => sum + row.count, 0);
  const totalLoads = skills.reduce((sum, row) => sum + row.loads, 0);
  return {
    ok: true, total, totalLoads, recorded: skills.length,
    sessions, updatedAt: current.updatedAt || null, dataFile: file, skills,
  };
}

/**
 * 读请求体（导入用），超过 8MB 直接拒绝。
 *
 * @param req - HTTP 请求。
 * @returns 请求体文本。
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error('导入体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 注册只读记分接口 GET /api/skill-scoreboard。
 *
 * @param webServer - 宿主 webServer 服务。
 * @param file - 数据文件路径。
 */
function registerSnapshotRoute(webServer, file) {
  webServer.register({
    kind: 'exact',
    path: '/api/skill-scoreboard',
    handler: (req, res) => {
      if ((req.method ?? 'GET') !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
        return;
      }
      try { sendJson(res, 200, buildSnapshot(file)); }
      catch (e) { sendJson(res, 500, { ok: false, error: String(e?.message ?? e) }); }
    },
  });
}

/**
 * 注册导出接口 GET /api/skill-scoreboard/export（下载完整 v2 记分 JSON）。
 *
 * @param webServer - 宿主 webServer 服务。
 * @param file - 数据文件路径。
 */
function registerExportRoute(webServer, file) {
  webServer.register({
    kind: 'exact',
    path: '/api/skill-scoreboard/export',
    handler: (req, res) => {
      try {
        if ((req.method ?? 'GET') !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
          return;
        }
        const current = readCurrentData(file);
        const payload = {
          version: 2,
          skills: current.skills || {},
          sessions: current.sessions || {},
          updatedAt: current.updatedAt || null,
          exportedAt: new Date().toISOString(),
        };
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="skill-usage.json"',
        });
        res.end(JSON.stringify(payload, null, 2));
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
      }
    },
  });
}

/**
 * 注册导入接口 POST /api/skill-scoreboard/import?merge=true|false。
 *
 * @param webServer - 宿主 webServer 服务。
 * @param file - 数据文件路径。
 * @param onImported - 写盘后回写内存态。
 */
function registerImportRoute(webServer, file, onImported) {
  webServer.register({
    kind: 'exact',
    path: '/api/skill-scoreboard/import',
    handler: async (req, res) => {
      try {
        if ((req.method ?? 'GET') !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
          return;
        }
        const raw = await readBody(req);
        const incoming = normalizeScoreboardPayload(raw);
        const url = new URL(req.url || '/', 'http://localhost');
        const merge = url.searchParams.get('merge') !== 'false';
        const current = readCurrentData(file);
        const next = merge ? mergeScoreboard(current, incoming) : incoming;
        await saveData(file, next);
        onImported(next);
        sendJson(res, 200, { ok: true, merge, recorded: Object.keys(next.skills || {}).length, updatedAt: next.updatedAt });
      } catch (e) {
        sendJson(res, 400, { ok: false, error: String(e?.message ?? e) });
      }
    },
  });
}

/**
 * 注册设置页三个只读接口：记分快照（含会话榜）、导出、导入。
 *
 * ⚠️ 回调必须同步（与 git-push 同构）：cordis 对 async inject 回调不调用，路由注册不生效（实测 401）。
 *
 * @param ctx - 宿主插件上下文（提供 ctx.inject）。
 * @param options - { file: 数据文件路径, onImported: 导入写盘后回写内存态 }。
 */
function registerWebRoutes(ctx, options) {
  const file = options.file;
  ctx.inject(['webServer'], (wctx) => {
    const webServer = wctx.get('webServer');
    if (!webServer) return;
    registerSnapshotRoute(webServer, file);
    registerExportRoute(webServer, file);
    registerImportRoute(webServer, file, options.onImported);
    console.log('[skill-scoreboard] ✅ 已注册 GET /api/skill-scoreboard（含会话榜）+ export/import');
  });
}
