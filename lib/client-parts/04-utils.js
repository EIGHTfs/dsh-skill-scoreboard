// ── 通用小工具（纯函数） ────────────────────────────────────────────────
/** 会话短 id：去掉 session- 前缀后取前 8 位 */
function shortSessionId(id) {
  const s = String(id || '')
  const bare = s.startsWith('session-') ? s.slice('session-'.length) : s
  return bare.slice(0, 8)
}

/** 会话标题：优先取 API 行里的 title（host 侧已解析持久化会话标题）；否则宿主 sessions 服务快照 displayTitle；兼容裸 id 与 session- 前缀两种键 */
function sessionTitle(id, fromRow) {
  if (fromRow && typeof fromRow.title === 'string' && fromRow.title) return fromRow.title
  return titleFromSessionsSvc(id)
}

/**
 * 从宿主 sessions 服务的快照里取会话标题（sessionTitle 的子步骤）。
 * 快照按 id 索引；兼容 `session-` 前缀与裸 id 两种键。
 * @param {string} id 会话 id
 * @returns {string} 标题；服务缺失/查不到时返回空串
 */
function titleFromSessionsSvc(id) {
  const list = sessionsSvc && sessionsSvc.list
  if (!list || typeof list.getSnapshot !== 'function') return ''
  try {
return pickSessionTitle(list.getSnapshot(), id)
  } catch { return '' }
}

/**
 * 从会话快照里挑出 id 对应的标题（titleFromSessionsSvc 的子步骤）。
 * @param {object} snap 宿主 sessions 快照（{ byId: {...} }）
 * @param {string} id 会话 id
 * @returns {string} 标题；查不到返回空串
 */
function pickSessionTitle(snap, id) {
  const byId = (snap || {}).byId || {}
  const bare = String(id).replace(/^session-/, '')
  const hit = byId[id] || byId['session-' + id] || byId[bare]
  if (!hit || !hit.displayTitle) return ''
  return String(hit.displayTitle)
}

function openSession(id) {
  try {
if (!sessionsSvc || typeof sessionsSvc.open !== 'function') return false
sessionsSvc.open(id)
return true
  } catch { return false }
}

/** 页码序列：<=PAGE_WINDOW_MAX 全列，否则首尾 + 当前 ±1，中间用 '…' 省略 */
