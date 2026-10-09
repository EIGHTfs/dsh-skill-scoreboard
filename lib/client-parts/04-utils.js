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
const PAGE_WINDOW_MAX = 7
function pageSequence(current, total) {
  if (total <= PAGE_WINDOW_MAX) {
const out = []
for (let i = 1; i <= total; i++) out.push(i)
return out
  }
  const wanted = new Set([1, total, current - 1, current, current + 1])
  const list = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out = []
  let prev = 0
  for (const p of list) {
if (p - prev > 1) out.push('…')
out.push(p)
prev = p
  }
  return out
}

// ── 翻页控件（复刻插件市场 Pager：« ‹ 页码… › » + 每页条数 + 共 N 条） ──
/** 设置页左侧栏「Skill 记分板」条目的排序权重（越小越靠前）。 */
const SETTINGS_SECTION_ORDER = 50
/** 只读接口请求超时（毫秒）——超时后降级显示错误态，不阻塞页面。 */
const FETCH_TIMEOUT_MS = 30000

/** 构造 HTTP 错误信息（统一「HTTP <status>」文案，避免同字面量散落多处）。 */
function httpError(status) {
  return new Error('HTTP ' + status)
}

const PAGE_SIZES = [10, 20, 50]
const PAGE_SIZE_DEFAULT = 20

function Pager({ page, pageSize, total, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const cur = Math.min(Math.max(1, page), pages)
  const seq = pageSequence(cur, pages)
  const go = (p) => { if (p >= 1 && p <= pages && p !== cur) onPage(p) }
  const navBtn = (label, titleKey, target, disabled) => ReactRef.createElement('button', {
type: 'button', className: 'dshsb_pageBtn', disabled,
onClick: () => go(target), title: tr(titleKey), 'aria-label': tr(titleKey),
  }, label)
  return ReactRef.createElement('div', { className: 'dshsb_pager' },
ReactRef.createElement('span', { className: 'dshsb_pageInfo' }, tr('settings.pageInfo', { total, page: cur, pages })),
ReactRef.createElement('div', { className: 'dshsb_pagerPages' },
  pages > 1 ? navBtn('«', 'settings.pagerFirst', 1, cur === 1) : null,
  pages > 1 ? navBtn('‹', 'settings.pagerPrev', cur - 1, cur === 1) : null,
  pages > 1 ? seq.map((p, i) => (p === '…'
    ? ReactRef.createElement('span', { className: 'dshsb_pageEll', key: 'e' + i }, '…')
    : ReactRef.createElement('button', {
        type: 'button',
        key: 'p' + p,
        className: p === cur ? 'dshsb_pageBtn dshsb_pageOn' : 'dshsb_pageBtn',
        'aria-current': p === cur ? 'page' : undefined,
        onClick: () => go(p),
      }, String(p)))) : null,
  pages > 1 ? navBtn('›', 'settings.pagerNext', cur + 1, cur === pages) : null,
  pages > 1 ? navBtn('»', 'settings.pagerLast', pages, cur === pages) : null,
),
ReactRef.createElement('label', { className: 'dshsb_pageSize' },
  ReactRef.createElement('span', null, tr('settings.pageSizeLabel')),
  ReactRef.createElement('select', {
    className: 'dshsb_select',
    value: String(pageSize),
    onChange: (e) => onPageSize(Number(e.target.value) || PAGE_SIZE_DEFAULT),
  }, PAGE_SIZES.map((n) => ReactRef.createElement('option', { key: n, value: String(n) }, String(n)))),
),
  )
}

