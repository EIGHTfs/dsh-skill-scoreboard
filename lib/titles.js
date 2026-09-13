/**
 * dsh-skill-scoreboard — 会话标题解析（host 半侧子模块）
 *
 * 2026-09-13 从 lib/index.js 拆出（单文件超 400 行阈值）：
 * 把「会话 id → 人类可读标题」的整套策略集中在此，供 API/注入链路复用：
 *  ① 活跃会话快照 displayTitle（免费，不缓存防 stale）
 *  ② 历史日志折叠标题（sessionPersistence.inspect，限并发 + cwd 兜底）
 *  ③ 落盘缓存（<数据目录>/session-titles.json，只存真实标题，重启不丢）
 *  ④ 兜底短 id（前 8 位裸 uuid）
 * 对外入口：makeTitleResolver(ctx, cacheFile) → { resolve, warm }。
 *
 * 依赖：node 内置 + 同目录 util.js（createSemaphore/shortIdOf/errMsg）；不反向依赖 index.js。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createSemaphore, shortIdOf } from './util.js';

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
/**
 * 读标题缓存文件（不存在/损坏/非对象一律当空缓存）。
 * @param {string|null} cacheFile 缓存文件路径
 * @returns {object} { [会话id]: 标题 }
 */
function readTitleCache(cacheFile) {
  if (!cacheFile) return {};
  try {
    const raw = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  } catch { /* 无缓存或文件损坏：当空缓存处理，下次解析后重写 */ }
  return {};
}

/**
 * 写标题缓存文件（只落「真实标题」，空的/非字符串不落，防兜底短 id 污染缓存）。
 * 写失败只打日志，不影响主链路。
 *
 * @param {string} cacheFile 缓存文件路径
 * @param {Map<string, string>} resolved 内存缓存
 * @returns {void}
 */
function writeTitleCache(cacheFile, resolved) {
  try {
    const cacheMap = {};
    for (const [k, v] of resolved) if (typeof v === 'string' && v) cacheMap[k] = v;
    writeFileSync(cacheFile, JSON.stringify(cacheMap, null, 2), 'utf8');
  } catch (e) {
    console.log(`[skill-scoreboard] ⚠️ 标题缓存写盘失败: ${errMsg(e)}`);
  }
}

/**
 * 并发等待一组任务，全部失败也静默（预热属旁路，失败不影响主链路）。
 * @param {Array<Promise>} tasks 待等待任务
 * @returns {Promise<void>}
 */
async function settleQuietly(tasks) {
  try {
    await Promise.all(tasks);
  } catch { /* 预热失败不影响主链路 */ }
}

/**
 * 收集「尚未有标题」的会话解析任务（预热用）。
 * @param {Array<string>} knownIds 已知会话 id
 * @param {Map<string,string>} resolved 内存标题缓存
 * @param {object} disk 磁盘标题缓存
 * @param {Function} resolve 单个会话的解析函数
 * @returns {Array<Promise<string>>} 待解析任务
 */
function pendingTitleTasks(knownIds, resolved, disk, resolve) {
  const tasks = [];
  for (const id of knownIds) {
    const key = String(id ?? '');
    if (!key) continue;
    if (cachedTitle(resolved, disk, key)) continue;
    tasks.push(resolve(key));
  }
  return tasks;
}

export function makeTitleResolver(ctx, cacheFile = null) {
  const limit = createSemaphore(2);
  const resolved = new Map(); // key -> 真实标题（仅日志解析出的；活跃快照命中不缓存，防 stale）
  let sessionsSvc = null;
  let persistence = null;
  try { sessionsSvc = ctx?.get?.('sessions') ?? null; } catch { sessionsSvc = null; }
  try { persistence = ctx?.get?.('sessionPersistence') ?? null; } catch { persistence = null; }

  const disk = readTitleCache(cacheFile);
  let saveQueued = false;
  function persist() {
    if (!cacheFile || saveQueued) return;
    saveQueued = true;
    Promise.resolve().then(() => {
      saveQueued = false;
      writeTitleCache(cacheFile, resolved);
    });
  }

  async function resolveOne(key) {
    // ① 活跃会话列表快照 displayTitle（免费）；② 历史日志折叠标题（限并发，含 cwd 兜底）
    return titleFromSessionSnapshot(sessionsSvc, key) || await titleFromInspect(persistence, limit, key);
  }

  const state = { resolved, disk, persist, resolveOne, cacheFile };

  return {
    resolve: (id) => resolveSessionTitle(id, state),
    warm: (knownIds = []) => warmSessionTitles(knownIds, state),
  };
}

/**
 * 解析单个会话标题：缓存命中直接返回，否则现场解析（限并发）并落盘。
 * 全部失败时兜底显示会话短 id（前 8 位裸 uuid）。
 *
 * @param {string} id 会话 id
 * @param {object} st 解析器共享状态（resolved/disk/persist/resolveOne）
 * @returns {Promise<string>} 会话标题
 */
async function resolveSessionTitle(id, st) {
  const key = String(id ?? '');
  if (!key) return '';
  const hit = cachedTitle(st.resolved, st.disk, key);
  if (hit) {
    if (!hit.fromMemory) st.resolved.set(key, hit.title);
    return hit.title;
  }
  try {
    const title = await st.resolveOne(key);
    if (title) {
      st.resolved.set(key, title);
      st.persist();
      return title;
    }
  } catch { /* 单个会话解析失败不阻断其它会话（下面走短 id 兜底） */ }
  return shortIdOf(key);
}

/**
 * 后台预热：解析全部已知会话（限并发），完成后落盘。不等待、不抛错。
 *
 * @param {Array<string>} knownIds 已知会话 id
 * @param {object} st 解析器共享状态
 * @returns {Promise<void>}
 */
async function warmSessionTitles(knownIds, st) {
  const tasks = pendingTitleTasks(knownIds, st.resolved, st.disk, (id) => resolveSessionTitle(id, st));
  if (!tasks.length) return;
  await settleQuietly(tasks);
}
