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
import { readFileSync, writeFileSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
// 2026-09-13：纯工具函数拆至 lib/util.js（文件行数超标 + 复用；实现与原内嵌一致）
import { errMsg, fmtShortTime, emptyV2 } from './util.js';
export { fmtShortTime } from './util.js'; // 历史 export 签名保持不变（供外部/测试引用）
// 2026-09-13：web 路由拆至 lib/routes.js（文件行数超标）
import { registerWebRoutes } from './routes.js';
// 2026-09-13：数据存取/合并拆至 lib/store.js（文件行数超标）
import {
  ensureDataDir, loadData, saveData, migrateToV2, deriveSessionsFromSkills,
  normalizeScoreboardPayload, mergeScoreboard, recordSkillUse, recordSessionUse,
} from './store.js';
// 保持历史 export 签名（供外部/测试引用；实现已迁至 store.js）
export {
  ensureDataDir, migrateToV2, deriveSessionsFromSkills, normalizeScoreboardPayload, mergeScoreboard,
} from './store.js';
// 2026-09-13：skill 路径解析拆至 lib/skillpath.js（文件行数超标）
import {
  resolveSkillPath, makeSkillPathIndex, skillNameFromReadArgs,
} from './skillpath.js';
// 保持历史 export 签名（供外部/测试引用；实现已迁至 skillpath.js）
export { resolveSkillPath, makeSkillPathIndex, skillNameFromReadArgs } from './skillpath.js';
// 2026-09-13：会话标题解析拆至 lib/titles.js（文件行数超标）
import { makeTitleResolver, foldTitleFromEvents } from './titles.js';
export { makeTitleResolver, foldTitleFromEvents } from './titles.js';

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
    .map(([id, record]) => sessionRowOf(id, record))
    .sort(compareSessionRows);
}

/**
 * 会话表条目 → 排行行（会话榜展示用；distinct 缺失时按 skills 表长度兜底）。
 * @param {string} id 会话 id
 * @param {object} record 会话表条目
 * @returns {object} 排行行
 */
function sessionRowOf(id, record) {
  const skills = Object.keys(record?.skills || {});
  return {
    id,
    loads: record?.loads || 0,
    distinct: record?.distinct || skills.length,
    skills,
    firstUsedAt: record?.firstUsedAt || null,
    lastUsedAt: record?.lastUsedAt || null,
    loadsEstimated: !!record?.loadsEstimated,
  };
}

/**
 * 会话榜排序：去重 skill 数降序 → 累计次数降序 → 最近使用时间降序。
 * @param {object} left 左行
 * @param {object} right 右行
 * @returns {number} 排序值
 */
function compareSessionRows(left, right) {
  return right.distinct - left.distinct
    || right.loads - left.loads
    || String(right.lastUsedAt || '').localeCompare(String(left.lastUsedAt || ''));
}

/**
 * 判断一次工具调用是否应记分，返回要记的 skill 名（不该记分时返回空串）。
 * 记分条件：结果非错误，且调用的是 skill 工具或 read 工具（read 需命中 skill 文件路径）。
 *
 * @param {object} exec 工具调用记录（name/arguments/agent/callId）
 * @param {object} result 工具结果
 * @param {object|null} pathIndex skill 路径索引（read 工具用）
 * @returns {string} skill 名；不记分返回空串
 */
function skillNameOfCall(exec, result, pathIndex) {
  if (result?.isError) return '';
  // v1.6.0：仅 skill 工具记分；v1.8.2：read 工具命中 skill 文件路径同样记分（AI 直接读文件 = 加载）
  if (exec?.name === 'skill') return skillNameFromArgs(exec.arguments);
  if (exec?.name === 'read') return skillNameFromReadArgs(exec.arguments, pathIndex);
  return '';
}

/**
 * agent/pre-step 注入：每个 agent 只注入一次记分榜 + skill 实际路径。
 * 注入失败/无内容/被拒/已中止时原样放行，不影响主链路。
 *
 * @param {object} payload 事件载荷（{ agent, signal }）
 * @param {Function} next 下游 chain 调用
 * @param {object} o 选项（ctx/file/topN/injectedAgents）
 * @returns {Promise<object>} pre-step 决策
 */
async function injectOncePerAgent({ agent, signal }, next, o) {
  const decision = await next();
  if (decision.kind === 'reject') return decision;
  if (signal?.aborted) return decision;
  if (o.injectedAgents.has(agent)) return decision;
  o.injectedAgents.add(agent);
  try {
    const text = await buildScoreboardInjection({
      file: o.file,
      topN: o.topN,
      skillsSvc: o.ctx.get('skills'),
    });
    if (!text) return decision;
    return withInjectedText(decision, text);
  } catch (e) {
    console.log(`[skill-scoreboard] ⚠️ 注入失败: ${errMsg(e)}`);
    return decision;
  }
}

/**
 * 把记分榜正文追加成一条 user 消息（source 标记为插件 instructions）。
 * @param {object} decision 原 pre-step 决策
 * @param {string} text 注入正文
 * @returns {object} 追加消息后的决策
 */
function withInjectedText(decision, text) {
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
}

/**
 * 把一个记分动作排进串行写盘队列（保证同一时刻只有一次写盘，避免竞态覆盖）。
 * 单次记分失败只打日志，不打断后续排队。
 *
 * @param {Promise} queue 当前队列尾
 * @param {object} o 记分上下文（exec/result/skillPathIndex/getStore/setStore/file）
 * @returns {Promise} 新的队列尾
 */
function enqueueScoring(queue, o) {
  return queue.then(async () => {
    const skillName = skillNameOfCall(o.exec, o.result, o.skillPathIndex);
    if (!skillName) return;
    const sessionId = o.exec.agent?.session?.id || o.exec.agent?.id || 'unknown';
    const callId = o.exec.callId || '';
    const store = o.getStore();
    const record = store.skills[skillName];
    if (callId && record?.callIds?.includes(callId)) return;
    recordSkillUse(store, skillName, sessionId, callId);
    recordSessionUse(store, sessionId, skillName);
    try { await saveData(o.file, store); }
    catch (e) { console.log(`[skill-scoreboard] ⚠️ 写数据失败: ${errMsg(e)}`); }
  }).catch((e) => {
    console.log(`[skill-scoreboard] ⚠️ 记分失败: ${errMsg(e)}`);
  });
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
  // v1.8.2：read 工具直接读 skill 文件也记分（懒构建路径索引，TTL 5 分钟）
  const skillPathIndex = makeSkillPathIndex(
    () => Object.keys(store.skills || {}),
    typeof ctx.get === 'function' ? ctx.get('skills') : null,
  );

  // 记分链：串行化的写盘队列（全局 state，供每次记录排队）
  const scoring = { queue: Promise.resolve() };
  ctx.on('tools/result', (exec, result) => {
    scoring.queue = enqueueScoring(scoring.queue, { exec, result, skillPathIndex, getStore: () => store, setStore: (n) => { store = n; }, file });
  });

  console.log(`[skill-scoreboard] ✅ 已启动，数据文件: ${file}，当前记录 ${Object.keys(store.skills).length} 个 skill`);

  // v1.4.0 agent/pre-step 注入（与 dsh-git-push 相同时机与形态）：
  // 每个 agent 首次 step 注入一次记分榜 + skill 实际路径，供 AI 参考。
  // 异步 get 路径不影响主链路；失败时降级为不带路径的榜单。
  if (cfg.injectEnabled) {
    const injectedAgents = new WeakSet();
    ctx.on('agent/pre-step', (payload, next) => injectOncePerAgent(payload, next, {
      ctx, file, topN: cfg.injectTopN, injectedAgents,
    }));
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
