/**
 * ★通用模块 2：翻页控件（Pager）
 *
 * 为什么抽成独立模块：DSH 插件页的翻页是固定形态（« ‹ 页码… › » + 每页条数 + 共 N 条），
 *   复刻一遍容易各处不一致。这里把**结构与行为**固化，把**类名**做成可覆盖的映射：
 *   应用侧调一次 `setPagerCls({...})` 即可接自己的样式，不改组件本身。
 *
 * 复制到别的插件时需保证：作用域里有 `ReactRef`（React 引用）与 `tr`（文案函数 `tr(key, vars)`）。
 * 用法（本项目）：`setPagerCls({ root: 'dshsb_pager', … })`，然后 `ReactRef.createElement(Pager, { page, pageSize, total, onPage, onPageSize })`。
 */

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

/** 通用默认类名（应用侧可整体覆盖，见 setPagerCls）。 */
const PAGER_DEFAULT_CLS = {
  root: 'ui-pager',
  info: 'ui-pager-info',
  pages: 'ui-pager-pages',
  btn: 'ui-pager-btn',
  on: 'ui-pager-btn-on',
  ell: 'ui-pager-ell',
  size: 'ui-pager-size',
  select: 'ui-select',
}
let pagerCls = PAGER_DEFAULT_CLS

/**
 * 覆盖翻页控件类名映射（应用侧调一次即可；未给的键沿用通用默认值）。
 * @param {Partial<typeof PAGER_DEFAULT_CLS>} map 类名映射
 */
function setPagerCls(map) {
  pagerCls = { ...PAGER_DEFAULT_CLS, ...(map || {}) }
}

function Pager({ page, pageSize, total, onPage, onPageSize }) {
  const C = pagerCls
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const cur = Math.min(Math.max(1, page), pages)
  const seq = pageSequence(cur, pages)
  const go = (p) => { if (p >= 1 && p <= pages && p !== cur) onPage(p) }
  const navBtn = (label, titleKey, target, disabled) => ReactRef.createElement('button', {
type: 'button', className: C.btn, disabled,
onClick: () => go(target), title: tr(titleKey), 'aria-label': tr(titleKey),
  }, label)
  return ReactRef.createElement('div', { className: C.root },
ReactRef.createElement('span', { className: C.info }, tr('settings.pageInfo', { total, page: cur, pages })),
ReactRef.createElement('div', { className: C.pages },
  pages > 1 ? navBtn('«', 'settings.pagerFirst', 1, cur === 1) : null,
  pages > 1 ? navBtn('‹', 'settings.pagerPrev', cur - 1, cur === 1) : null,
  pages > 1 ? seq.map((p, i) => (p === '…'
    ? ReactRef.createElement('span', { className: C.ell, key: 'e' + i }, '…')
    : ReactRef.createElement('button', {
        type: 'button',
        key: 'p' + p,
        className: p === cur ? `${C.btn} ${C.on}` : C.btn,
        'aria-current': p === cur ? 'page' : undefined,
        onClick: () => go(p),
      }, String(p)))) : null,
  pages > 1 ? navBtn('›', 'settings.pagerNext', cur + 1, cur === pages) : null,
  pages > 1 ? navBtn('»', 'settings.pagerLast', pages, cur === pages) : null,
),
ReactRef.createElement('label', { className: C.size },
  ReactRef.createElement('span', null, tr('settings.pageSizeLabel')),
  ReactRef.createElement('select', {
    className: C.select,
    value: String(pageSize),
    onChange: (e) => onPageSize(Number(e.target.value) || PAGE_SIZE_DEFAULT),
  }, PAGE_SIZES.map((n) => ReactRef.createElement('option', { key: n, value: String(n) }, String(n)))),
),
  )
}
