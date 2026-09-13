// dsh-skill-scoreboard — 浏览器半侧（v1.8.0）
// 设置 → 侧边栏 →「Skill 记分板」独立页面，仿插件市场的顶部选项卡结构，共三个选项卡：
//   Skill：skill 排行，固定按会话去重次数降序；去重与加载两种次数同列显示（去重列高亮）；列表分页（« ‹ 页码 › » + 每页条数）
//   会话：加载过 skill 的会话排行榜（去重 skill 数降序，越多越靠前），可展开看该会话加载过哪些 skill，
//        会话标题经宿主 sessions 服务解析（取不到则显示短 id），可点击打开该会话
//   管理：导出 / 导入（合并、覆盖）+ 数据概览（skill 数、会话数、累计次数、数据文件路径）
// 数据来自宿主端只读接口 GET /api/skill-scoreboard（lib/index.js 注册）。
//
// Client entries must be classic scripts registered via window.__ModuleLoader__.load
// ({ id, factory }); the factory receives a synchronous `require`.
window.__ModuleLoader__.load({
  id: 'dsh-skill-scoreboard',
  factory: (require) => createModule(require),
})


/**
 * 模块装配：由 ModuleLoader 的 factory 调用，返回插件 exports。
 *
 * @param require - 宿主注入的同步 require（仅 react）。
 * @returns 插件模块导出对象（name/inject/apply）。
 */
/** 宿主注入的 React（createModule 时赋值，供顶层组件函数共用）。 */
let ReactRef = null

function createModule(require) {
var module = { exports: {} }
var exports = module.exports
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

const React = require('react')
ReactRef = React
const name = 'dsh-skill-scoreboard'
// 2026-09-13：i18n 字典迁至 JSON 文件，用宿主 require 读取（Node 原生支持 JSON require）
L = {
  zh: require('./i18n/zh.json'),
  en: require('./i18n/en.json'),
}


// ── 插件装配：设置侧边栏导航条目（settings.section 列表槽） ─────────────
// 页面组件与文案由 createScoreboardUi 提供（顶层函数，见文件上方）。
const ui = createScoreboardUi()
const inject = ['slots', 'locale']

function apply(ctx) {
  ui.setLocale(ctx.locale)
  // 宿主 sessions 服务：用 ctx.get 动态取（cordis 的 get 不需要 inject 声明，未提供时返回 undefined），
  // 取不到则会话标题退化为短 id、「打开会话」不可用，页面本身不受影响。
  try { ui.setSessions(ctx.get ? ctx.get('sessions') : null) } catch { ui.setSessions(null) }
  const disposeDict = ctx.locale.register(ui.NS, ui.dict)
  const slots = ctx.get('slots')
  if (slots !== undefined) {
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'skill-scoreboard', order: SETTINGS_SECTION_ORDER, label: () => ui.tr('settings.title') },
      () => React.createElement(ui.page, null),
    ))
  }
  ctx.effect(() => disposeDict, 'dsh-skill-scoreboard: dictionaries')
}

exports.NS = ui.NS
exports.name = name
exports.apply = apply
exports.inject = inject
return module.exports
}


/**
 * 记分板 UI 工厂：把 i18n 字典、样式与三个选项卡组件装配成一个页面组件。
 * 定义为顶层函数（而非塞进 ModuleLoader 的 factory），便于阅读与单测。
 *
 * @param React - 宿主提供的 React。
 * @returns { page: 页面组件, ensureCss, tr, fmtTime, shortSessionId, pageSequence, Pager, setLocale, setSessions }
 */
// ── i18n：zh/en 同键字典；tr 读当前 locale，缺词回退 en → 键名 ──────────
// 字典存 lib/i18n/*.json（2026-09-13 从内嵌硬编码迁出，消除重复字面量误报）；
// 读取放在 createModule 内用宿主 require（Node require 原生支持 JSON）。
const NS = 'dsh-skill-scoreboard'
let L = null // createModule 时经 setDict 注入

// 组件级 CSS：设置页全局注入一次，主题走 DSH 设计 token（明暗自适应）
// 选项卡 / 分页样式对齐插件市场（.tabs/.tab/.on/.pager）
const cssText = [
  '.dshsb_page{display:flex;flex-direction:column;gap:12px}',
  '.dshsb_hero{display:flex;flex-direction:column;gap:6px}',
  '.dshsb_title{font-size:20px;font-weight:650;color:var(--dsw-alias-label-primary)}',
  '.dshsb_desc{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-tertiary);max-width:66ch}',
  '.dshsb_meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
  '.dshsb_badge{border-radius:999px;padding:2px 10px;font-size:12px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l3)}',
  '.dshsb_api{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
  '.dshsb_btn{font:inherit;font-size:12px;border-radius:8px;padding:5px 12px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}',
  '.dshsb_btn:hover{background:var(--dsw-alias-bg-layer-3)}',
  '.dshsb_btn:disabled{opacity:.55;cursor:default}',
  '.dshsb_select{font:inherit;font-size:12px;border-radius:8px;padding:5px 10px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);cursor:pointer}',
  // 顶部选项卡（对齐插件市场 .tabs/.tab/.on）
  '.dshsb_tabs{display:flex;align-items:flex-end;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2);margin-top:2px}',
  '.dshsb_tab{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-bottom:2px solid transparent;padding:7px 12px;font-size:13px}',
  '.dshsb_tab:hover{color:var(--dsw-alias-label-primary)}',
  '.dshsb_tabOn{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}',
  '.dshsb_tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:2px}',
  // 榜单表格 + 分页
  '.dshsb_panelWrap{display:flex;flex-direction:column;gap:10px}',
  '.dshsb_panel{list-style:none;margin:0;padding:0;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
  '.dshsb_headrow{display:flex;align-items:center;gap:8px;padding:10px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);border-bottom:.5px solid var(--dsw-alias-border-l2)}',
  '.dshsb_headname{flex:1;min-width:0}',
  '.dshsb_headcount,.dshsb_headtime,.dshsb_headrank,.dshsb_headexpand{flex-shrink:0;text-align:right}',
  '.dshsb_headrank{width:34px}',
  '.dshsb_headcount{width:72px}.dshsb_headtime{width:132px}',
  '.dshsb_headexpand{width:22px}',
  '.dshsb_rows{max-height:56vh;overflow-y:auto}',
  '.dshsb_row{display:flex;align-items:center;gap:8px;padding:9px 16px;font-size:13px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
  '.dshsb_row:last-child{border-bottom:0}',
  '.dshsb_row:hover{background:var(--dsw-alias-bg-layer-2)}',
  '.dshsb_rank{flex-shrink:0;width:34px;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}',
  '.dshsb_name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary)}',
  '.dshsb_sessName{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}',
  '.dshsb_sessId{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.dshsb_count{flex-shrink:0;width:72px;text-align:right;font-weight:650;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
  '.dshsb_countDim{flex-shrink:0;width:72px;text-align:right;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
  '.dshsb_countHot{color:var(--dsw-alias-brand-primary)}',
  '.dshsb_time{flex-shrink:0;width:132px;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px}',
  '.dshsb_expandBtn{flex-shrink:0;width:22px;height:20px;padding:0;line-height:1;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px}',
  '.dshsb_expandBtn:hover{color:var(--dsw-alias-label-primary)}',
  '.dshsb_subrow{padding:2px 16px 12px 58px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:12px}',
  '.dshsb_chip{display:inline-block;border:.5px solid var(--dsw-alias-border-l3);border-radius:4px;padding:1px 7px;margin:2px 4px 2px 0;font-size:11px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
  '.dshsb_state{padding:28px 16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}',
  '.dshsb_err{color:var(--dsw-alias-label-error)}',
  '.dshsb_muted{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px}',
  // 翻页（对齐插件市场 .pager）
  '.dshsb_pager{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin:12px 0 2px}',
  '.dshsb_pagerPages{display:flex;flex-wrap:wrap;flex:1;justify-content:center;align-items:center;gap:4px;min-width:0}',
  '.dshsb_pageBtn{font:inherit;font-size:12px;border-radius:6px;padding:3px 9px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}',
  '.dshsb_pageBtn:hover:not(:disabled){color:var(--dsw-alias-brand-primary)}',
  '.dshsb_pageBtn:disabled{opacity:.45;cursor:default}',
  '.dshsb_pageOn{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;font-weight:600}',
  '.dshsb_pageEll{color:var(--dsw-alias-label-tertiary);padding:0 2px;font-size:12px}',
  '.dshsb_pageInfo{color:var(--dsw-alias-label-secondary);white-space:nowrap;font-size:12px}',
  '.dshsb_pageSize{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}',
  // 管理页卡片
  '.dshsb_cards{display:flex;flex-direction:column;gap:10px}',
  '.dshsb_card{border:.5px solid var(--dsw-alias-border-l4);border-radius:14px;background:var(--dsw-alias-bg-layer-3);padding:12px 16px}',
  '.dshsb_cardTitle{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.dshsb_cardActions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
  '.dshsb_kv{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:12px;padding:3px 0}',
  '.dshsb_kvKey{color:var(--dsw-alias-label-tertiary);flex-shrink:0}',
  '.dshsb_kvVal{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;text-align:right}',
  '.dshsb_hint{margin:6px 0 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
].join('')

function ensureCss() {
  if (typeof document === 'undefined') return
  // 注意：本函数是顶层作用域，只能引用顶层常量 NS（不能引用 createModule 内的 name）
  if (document.querySelector('style[data-plugin-css="' + NS + '"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = NS
  tag.dataset.pluginCss = NS
  tag.textContent = cssText
  document.head.appendChild(tag)
}

let localeCtx = null // apply 时挂上，供 tr() 与组件读取当前 locale
let sessionsSvc = null // apply 时尝试取宿主 sessions 服务（取不到则标题/打开会话功能降级）

function activeLocaleId() {
  try {
const snap = localeCtx && typeof localeCtx.getLocale === 'function' ? localeCtx.getLocale() : null
if (snap && typeof snap.id === 'string') return snap.id
  } catch { /* locale 读取失败，降级默认中文 */ }
  return 'zh'
}

function tr(key, vars) {
  const id = activeLocaleId()
  const dict = String(id).toLowerCase().startsWith('zh') ? L.zh : L.en
  let s = dict[key] ?? L.zh[key] ?? L.en[key] ?? key
  if (vars) {
for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]))
  }
  return s
}

function fmtTime(iso) {
  if (!iso) return '—'
  try {
return new Date(iso).toLocaleString(tr('settings.dateLocale'), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
return String(iso).slice(0, 16).replace('T', ' ')
  }
}

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

// ── 记分板页面（三选项卡） ──────────────────────────────────────────────
/**
 * skill 榜排序：固定按会话去重次数降序；并列按名称。
 * 两种次数在表格里同时显示、去重列为主列，故排序键不再可切换。
 *
 * @param skills - API 返回的 skill 行。
 * @returns 排好序的新数组。
 */
function sortSkillRows(skills) {
  return skills.slice().sort((a, b) => (
    (b.count || 0) - (a.count || 0) || String(a.name).localeCompare(String(b.name))
  ))
}

/**
 * 会话榜排序：去重 skill 数降序（越多越靠前），并列按加载次数、再按最近活动。
 *
 * @param sessions - API 返回的会话行。
 * @returns 排好序的新数组。
 */
function sortSessionRows(sessions) {
  return sessions.slice().sort((a, b) => (
    (b.distinct || 0) - (a.distinct || 0)
    || (b.loads || 0) - (a.loads || 0)
    || String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || ''))
  ))
}

/**
 * 求分页参数：页码夹在合法区间内，并切出当前页数据。
 *
 * @param rows - 全量行。
 * @param requestedPage - 期望页码（1 基）。
 * @param pageSize - 每页条数。
 * @returns { page, pageCount, slice }。
 */
function paginate(rows, requestedPage, pageSize) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(Math.max(1, requestedPage || 1), pageCount)
  return { page, pageCount, slice: rows.slice((page - 1) * pageSize, page * pageSize) }
}

/**
 * 顶部选项卡栏（Skill / 会话 / 管理），样式对齐插件市场 .tabs/.tab。
 *
 * @param props - { tab: 当前选项卡 id, onSelect: 切换回调 }。
 * @returns 选项卡栏元素。
 */
function TabBar({ tab, onSelect }) {
  const tabDefs = [
    { id: 'skill', label: tr('settings.tabSkill') },
    { id: 'session', label: tr('settings.tabSession') },
    { id: 'manage', label: tr('settings.tabManage') },
  ]
  return ReactRef.createElement('div', { className: 'dshsb_tabs', role: 'tablist' },
    tabDefs.map((item) => ReactRef.createElement('button', {
      key: item.id,
      type: 'button',
      role: 'tab',
      'aria-selected': tab === item.id,
      className: tab === item.id ? 'dshsb_tab dshsb_tabOn' : 'dshsb_tab',
      onClick: () => onSelect(item.id),
    }, item.label)),
  )
}

/** API 快照 → state 增量（纯函数；loading/error 由调用方管理）。
 * @param data API 返回的快照对象（skills/sessions/total/... 域字段）
 */
function snapshotToState(data) {
  const skills = Array.isArray(data.skills) ? data.skills : []
  return {
    skills,
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    total: data.total || 0,
    totalLoads: data.totalLoads || data.total || 0,
    recorded: data.recorded ?? skills.length,
    updatedAt: data.updatedAt || null,
    dataFile: data.dataFile || '',
  }
}

/** 顶部徽标：会话 tab 显示会话数，其余显示累计去重次数。 */
function badgeFor(tab, state, sessionRows) {
  if (tab === 'session') return tr('settings.recorded', { n: sessionRows.length })
  const n = tab === 'manage' ? (state.total || 0) : (state.total || 0)
  return tr('settings.totalBadge', { n })
}

/** 表头行：cols 为 [className, i18nKey] 数组（扩展列 key 可为 null 只占位）。 */
function panelHeadRow(cols) {
  return ReactRef.createElement('li', { className: 'dshsb_headrow' },
    // 表头列必须带 key：React 对无 key 的列表项会告警。用下标而非类名——
    //   dshsb_headcount 同时用于「去重次数」与「加载次数」两列，类名会撞车。
    cols.map(([cls, key], i) => ReactRef.createElement('span', { className: cls, key: i }, key ? tr(key) : '')),
  )
}

/** 面板状态区：error → loading → empty → rows（四选一渲染）。 */
function panelBody({ error, loading, hasRows, emptyKey, rowsNode }) {
  if (error) return ReactRef.createElement('li', { className: 'dshsb_state dshsb_err' }, tr('settings.error', { err: error }))
  if (loading && !hasRows) return ReactRef.createElement('li', { className: 'dshsb_state' }, tr('settings.loading'))
  if (!hasRows) return ReactRef.createElement('li', { className: 'dshsb_state' }, tr(emptyKey))
  return ReactRef.createElement('li', { className: 'dshsb_rows' }, rowsNode)
}

function ScoreboardPage() {
  ensureCss()
  const [state, setState] = ReactRef.useState({
loading: true, error: '', notice: '',
skills: [], sessions: [], total: 0, totalLoads: 0, recorded: 0, updatedAt: null, dataFile: '',
  })
  const [tab, setTab] = ReactRef.useState('skill') // 'skill' | 'session' | 'manage'
  const [pages, setPages] = ReactRef.useState({ skill: 1, session: 1 })
  const [expanded, setExpanded] = ReactRef.useState(() => new Set())
  const [pageSize, setPageSize] = ReactRef.useState(PAGE_SIZE_DEFAULT)
  const [importMode, setImportMode] = ReactRef.useState('merge') // 'merge' | 'replace'
  const [, setLocaleTick] = ReactRef.useState(0)
  const fileRef = ReactRef.useRef(null)

  // 语言切换时重渲染（label thunk 由 shell 按投影重读，页面正文靠订阅）
  ReactRef.useEffect(() => {
if (!localeCtx || typeof localeCtx.subscribe !== 'function') return
return localeCtx.subscribe(() => setLocaleTick((t) => t + 1))
  }, [])

  const load = useSnapshotLoader(setState)

  ReactRef.useEffect(() => { load() }, [load])

  const goPage = (which, p) => setPages((prev) => ({ ...prev, [which]: p }))
  const changePageSize = (n) => { setPageSize(n); setPages({ skill: 1, session: 1 }) }
  const toggleExpanded = (id) => setExpanded((prev) => toggleInSet(prev, id))

  const view = buildPageView({ state, tab, pages, pageSize })
  const panelProps = { state, pageSize, goPage, changePageSize, importMode, setImportMode, fileRef, load, expanded, toggleExpanded, view }

  return ReactRef.createElement('div', { className: 'dshsb_page' },
pageHero({ state, tab, skillCount: view.skillRows.length, badgeLabel: view.badgeLabel, tabBar: ReactRef.createElement(TabBar, { tab, onSelect: setTab }), load }),
pickPanel(tab, panelProps),
  )
}

/**
 * 切换 Set 内某元素的在/不在（展开态切换用；不改动原 Set）。
 * @param {Set} prev 原集合
 * @param {*} id 待切换元素
 * @returns {Set} 新集合
 */
function toggleInSet(prev, id) {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * 派生页面展示数据（排行行 + 分页切片 + 当前选项卡徽标）。
 * 抽成纯函数便于单测，也让 ScoreboardPage 只剩状态与组装。
 *
 * @param {object} p 入参（state/tab/pages/pageSize）
 * @returns {object} 含 skillRows/sessionRows/两种分页切片/badgeLabel 的视图对象
 */
function buildPageView({ state, tab, pages, pageSize }) {
  const skillRows = sortSkillRows(state.skills)
  const skillPaging = paginate(skillRows, pages.skill, pageSize)
  const sessionRows = sortSessionRows(state.sessions)
  const sessionPaging = paginate(sessionRows, pages.session, pageSize)
  return {
    skillRows,
    sessionRows,
    skillSlice: skillPaging.slice,
    skillPage: skillPaging.page,
    skillPageCount: skillPaging.pageCount,
    sessionSlice: sessionPaging.slice,
    sessionPage: sessionPaging.page,
    sessionPageCount: sessionPaging.pageCount,
    badgeLabel: badgeFor(tab, state, sessionRows),
  }
}

/**
 * 按当前选项卡挑出要渲染的面板元素。
 * @param {string} tab 当前选项卡（'skill' | 'session' | 'manage'）
 * @param {object} props 面板公共 props（含 state/view/回调）
 * @returns {object} 面板 React 元素
 */
function pickPanel(tab, props) {
  const { state, pageSize, goPage, changePageSize, importMode, setImportMode, fileRef, load, expanded, toggleExpanded, view } = props;
  if (tab === 'manage') {
    return ReactRef.createElement(ManagePanel, { state, sessionRows: view.sessionRows, importMode, setImportMode, fileRef, load });
  }
  if (tab === 'session') {
    return ReactRef.createElement(SessionPanel, {
      state, sessionRows: view.sessionRows, sessionSlice: view.sessionSlice, sessionPage: view.sessionPage,
      sessionPageCount: view.sessionPageCount, pageSize, goPage, changePageSize, expanded, toggleExpanded,
    });
  }
  return ReactRef.createElement(SkillPanel, {
    state, skillRows: view.skillRows, skillSlice: view.skillSlice, skillPage: view.skillPage,
    skillPageCount: view.skillPageCount, pageSize, goPage, changePageSize,
  });
}

/**
 * 页面顶部 hero 区（标题 + 说明 + 徽标/时间/刷新按钮 + 选项卡条）。
 * 由 ScoreboardPage 调用——把短路渲染的条件表达式集中在这里，主组件只做组装。
 *
 * @param {object} p 渲染入参
 * @param {object} p.state 页面状态（loading/notice/updatedAt）
 * @param {string} p.tab 当前选项卡
 * @param {number} p.skillCount skill 行数（>0 才显示「已记录 N 个」徽标）
 * @param {string} p.badgeLabel 当前选项卡徽标文案
 * @param {object} p.tabBar 选项卡条元素
 * @param {Function} p.load 刷新回调
 * @returns {object} hero 区 React 元素
 */
function pageHero({ state, tab, skillCount, badgeLabel, tabBar, load }) {
  return ReactRef.createElement('div', { className: 'dshsb_hero' },
ReactRef.createElement('div', { className: 'dshsb_title' }, tr('settings.title')),
ReactRef.createElement('p', { className: 'dshsb_desc' }, tr('settings.desc')),
ReactRef.createElement('div', { className: 'dshsb_meta' },
  ReactRef.createElement('span', { className: 'dshsb_badge' }, badgeLabel),
  tab === 'skill' && skillCount ? ReactRef.createElement('span', { className: 'dshsb_badge' }, tr('settings.recorded', { n: skillCount })) : null,
  state.updatedAt ? ReactRef.createElement('span', { className: 'dshsb_api' }, tr('settings.updatedAt', { time: fmtTime(state.updatedAt) })) : null,
  ReactRef.createElement('button', { type: 'button', className: 'dshsb_btn', disabled: state.loading, onClick: load }, tr('settings.refresh')),
  state.notice ? ReactRef.createElement('span', { className: 'dshsb_api' }, state.notice) : null,
),
tabBar,
  )
}

/**
 * 记分快照加载 hook：拉 /api/skill-scoreboard 并写入页面状态。
 * 抽出后 ScoreboardPage 只剩编排职责（fetch 链路/错误降级集中在此）。
 *
 * @param {Function} setState 页面状态 setter
 * @returns {Function} 触发加载的回调（useCallback 稳定引用）
 */
function useSnapshotLoader(setState) {
  return ReactRef.useCallback(() => {
setState((s) => ({ ...s, loading: true, error: '' }))
fetch('/api/skill-scoreboard', { credentials: 'same-origin', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  .then((res) => applySnapshotResponse(res, setState))
  .catch((e) => setState((s) => ({ ...s, loading: false, error: (e && e.message) || String(e) })))
  }, [])
}

/**
 * 解析 /api/skill-scoreboard 的响应并写入页面状态（useSnapshotLoader 的子步骤）。
 * 响应非 JSON 时降级为空快照；HTTP 层失败（非 2xx 或 ok:false）转成 Error 抛出，
 * 由调用方 catch 写进 error 状态。
 *
 * @param {object} res fetch 响应
 * @param {Function} setState 页面状态 setter
 * @returns {Promise<void>}
 */
async function applySnapshotResponse(res, setState) {
  const payload = await res.json().catch((e) => { /* 响应非 JSON 时降级空数据 */ return {} })
  if (!res.ok || !payload || !payload.ok) throw (payload && payload.error) ? new Error(payload.error) : httpError(res.status)
  setState((s) => ({ ...s, loading: false, error: '', ...snapshotToState(payload) }))
}

  /**
   * Skill 选项卡：按会话去重降序排行 + 列表分页（两种次数同时显示，去重列高亮）。
   */
  function SkillPanel({ state, skillRows, skillSlice, skillPage, skillPageCount, pageSize, goPage, changePageSize }) {
// 由 ScoreboardPage 传入所需的 state/行数据/回调，本函数只负责渲染。
return ReactRef.createElement('div', { className: 'dshsb_panelWrap' },
  ReactRef.createElement('ol', { className: 'dshsb_panel' },
    panelHeadRow([
      ['dshsb_headrank', 'settings.rankCol'],
      ['dshsb_headname', 'settings.skillCol'],
      ['dshsb_headcount', 'settings.countCol'],
      ['dshsb_headcount', 'settings.loadCountCol'],
      ['dshsb_headtime', 'settings.lastUsedCol'],
    ]),
    panelBody({
      error: state.error,
      loading: state.loading,
      hasRows: skillRows.length > 0,
      emptyKey: 'settings.empty',
      rowsNode: skillSlice.map((row, i) => {
                const count = row.count || 0
                const loads = row.loads || count
                const rank = (skillPage - 1) * pageSize + i + 1
                return ReactRef.createElement('div', { className: 'dshsb_row', key: row.name, title: row.name },
                  ReactRef.createElement('span', { className: 'dshsb_rank' }, String(rank)),
                  ReactRef.createElement('span', { className: 'dshsb_name' }, row.name),
                  ReactRef.createElement('span', {
                    className: 'dshsb_count dshsb_countHot',
                  }, String(count)),
                  ReactRef.createElement('span', {
                    className: 'dshsb_count dshsb_countDim',
                  }, String(loads)),
                  ReactRef.createElement('span', { className: 'dshsb_time' }, fmtTime(row.lastUsedAt)),
                )
      }),
    }),
  ),
  skillRows.length
    ? ReactRef.createElement(Pager, {
        page: skillPage, pageSize, total: skillRows.length,
        onPage: (p) => goPage('skill', p),
        onPageSize: changePageSize,
      })
    : null,
)
  }

  /**
   * 会话选项卡：加载过 skill 的会话排行榜（去重 skill 数降序），可展开看明细、可打开会话。
   */
  function SessionPanel({ state, sessionRows, sessionSlice, sessionPage, sessionPageCount, pageSize, goPage, changePageSize, expanded, toggleExpanded }) {
// 由 ScoreboardPage 传入所需的 state/行数据/回调，本函数只负责渲染。
return ReactRef.createElement('div', { className: 'dshsb_panelWrap' },
  ReactRef.createElement('p', { className: 'dshsb_muted' }, tr('settings.sessionDesc')),
  ReactRef.createElement('ol', { className: 'dshsb_panel' },
    panelHeadRow([
      ['dshsb_headrank', 'settings.rankCol'],
      ['dshsb_headname', 'settings.sessionCol'],
      ['dshsb_headcount', 'settings.distinctCol'],
      ['dshsb_headcount', 'settings.loadCountCol'],
      ['dshsb_headtime', 'settings.lastUsedCol'],
      ['dshsb_headexpand', null],
    ]),
    panelBody({
      error: state.error,
      loading: state.loading,
      hasRows: sessionRows.length > 0,
      emptyKey: 'settings.emptySessions',
      rowsNode: sessionSlice.flatMap((row, i) => {
                const rank = (sessionPage - 1) * pageSize + i + 1
                const title = sessionTitle(row.id, row)
                const shortId = shortSessionId(row.id)
                // host 兜底短 id 时不再重复显示短 id span；「无标题会话」仅在 title 空时兜底
                const isFallbackTitle = !title || title === shortId
                const displayTitle = isFallbackTitle ? shortId : title
                const isOpen = expanded.has(row.id)
                const canOpen = !!sessionsSvc && typeof sessionsSvc.open === 'function'
                const nodes = [
                  ReactRef.createElement('div', { className: 'dshsb_row', key: row.id, title: row.id },
                    ReactRef.createElement('span', { className: 'dshsb_rank' }, String(rank)),
                    ReactRef.createElement('span', {
                      className: 'dshsb_sessName',
                      onClick: canOpen ? () => { openSession(row.id) } : undefined,
                      style: canOpen ? { cursor: 'pointer' } : undefined,
                    },
                      displayTitle,
                      !isFallbackTitle
                        ? ReactRef.createElement('span', { className: 'dshsb_sessId' }, shortId)
                        : null,
                    ),
                    ReactRef.createElement('span', { className: 'dshsb_count dshsb_countHot' }, String(row.distinct || 0)),
                    ReactRef.createElement('span', { className: 'dshsb_countDim' }, String(row.loads || 0)),
                    ReactRef.createElement('span', { className: 'dshsb_time' }, fmtTime(row.lastUsedAt)),
                    ReactRef.createElement('button', {
                      type: 'button',
                      className: 'dshsb_expandBtn',
                      'aria-expanded': isOpen,
                      title: isOpen ? tr('settings.collapse') : tr('settings.expand'),
                      onClick: () => toggleExpanded(row.id),
                    }, isOpen ? '▾' : '▸'),
                  ),
                ]
                if (isOpen) {
                  const skillNames = Array.isArray(row.skills) ? row.skills : []
                  nodes.push(ReactRef.createElement('div', { className: 'dshsb_subrow', key: row.id + ':sub' },
                    skillNames.length
                      ? skillNames.map((sn) => ReactRef.createElement('span', { className: 'dshsb_chip', key: sn }, sn))
                      : ReactRef.createElement('span', { className: 'dshsb_muted' }, tr('settings.empty')),
                  ))
                }
                return nodes
      }),
    }),
  ),
  sessionRows.length
    ? ReactRef.createElement(Pager, {
        page: sessionPage, pageSize, total: sessionRows.length,
        onPage: (p) => goPage('session', p),
        onPageSize: changePageSize,
      })
    : null,
)
  }

  /**
   * 管理选项卡：数据概览 + 导出/导入（合并、覆盖）。
   */
/**
 * 导出记分数据：请求导出接口并把响应体作为 skill-usage.json 下载。
 * 失败写进页面 error 状态。
 *
 * @param {Function} setState 页面状态 setter
 * @returns {void}
 */
function downloadScoreboard(setState) {
  fetch('/api/skill-scoreboard/export', { credentials: 'same-origin', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    .then(async (res) => {
      if (!res.ok) throw httpError(res.status)
      saveBlobAs(await res.blob(), 'skill-usage.json')
    })
    .catch((e) => setState((s) => ({ ...s, error: (e && e.message) || String(e) })))
}

/**
 * 触发浏览器下载给定 blob（建临时 a 标签点击，用完即撤并释放 URL）。
 * @param {Blob} blob 文件内容
 * @param {string} filename 下载文件名
 * @returns {void}
 */
function saveBlobAs(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * 导入记分数据文件：读文件正文按当前模式（合并/覆盖）POST 到导入接口。
 * 成功提示条数并刷新页面数据，失败写进 error 状态。
 *
 * @param {object} ev input 的 change 事件
 * @param {object} o 上下文（importMode/setState/load）
 * @returns {void}
 */
function importScoreboardFile(ev, o) {
  const file = ev.target.files && ev.target.files[0]
  ev.target.value = ''
  if (!file) return
  // 直接用当前选择的导入模式，无需二次确认
  const merge = o.importMode === 'merge'
  file.text()
    .then((text) => postScoreboardImport(text, merge))
    .then((payload) => {
      o.setState((s) => ({ ...s, notice: tr('settings.importOk', { n: payload.recorded || 0 }) }))
      o.load()
    })
    .catch((e) => o.setState((s) => ({ ...s, error: tr('settings.importFail', { err: (e && e.message) || String(e) }) })))
}

/**
 * POST 导入数据；HTTP/业务失败转成 Error 抛出。
 * @param {string} text 导入文件正文
 * @param {boolean} merge true=合并，false=覆盖
 * @returns {Promise<object>} 接口响应体
 */
async function postScoreboardImport(text, merge) {
  const response = await fetch('/api/skill-scoreboard/import?merge=' + (merge ? 'true' : 'false'), {
    method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json' },
    body: text,
  })
  const payload = await response.json().catch((e) => { /* 响应非 JSON 时降级空数据 */ return {} })
  if (!response.ok || !payload.ok) throw payload.error ? new Error(payload.error) : httpError(response.status)
  return payload
}

  function ManagePanel({ state, sessionRows, importMode, setImportMode, fileRef, load }) {
// 由 ScoreboardPage 传入所需的 state/行数据/回调，本函数只负责渲染。
const hasEstimated = sessionRows.some((s) => s.loadsEstimated)
const kv = (key, value) => ReactRef.createElement('div', { className: 'dshsb_kv', key },
  ReactRef.createElement('span', { className: 'dshsb_kvKey' }, key),
  ReactRef.createElement('span', { className: 'dshsb_kvVal' }, value),
)
return ReactRef.createElement('div', { className: 'dshsb_panelWrap' },
  ReactRef.createElement('p', { className: 'dshsb_muted' }, tr('settings.manageDesc')),
  ReactRef.createElement('div', { className: 'dshsb_cards' },
    ReactRef.createElement('div', { className: 'dshsb_card' },
      ReactRef.createElement('h3', { className: 'dshsb_cardTitle' }, tr('settings.manageOverview')),
      kv(tr('settings.manageSkills'), String(state.recorded || 0)),
      kv(tr('settings.manageSessions'), String(sessionRows.length)),
      kv(tr('settings.manageTotal'), String(state.total || 0)),
      kv(tr('settings.manageTotalLoads'), String(state.totalLoads || 0)),
      kv(tr('settings.manageUpdated'), fmtTime(state.updatedAt)),
      kv(tr('settings.manageFile'), state.dataFile || '—'),
      hasEstimated ? ReactRef.createElement('p', { className: 'dshsb_hint' }, tr('settings.manageEstimated')) : null,
    ),
    ReactRef.createElement('div', { className: 'dshsb_card' },
      ReactRef.createElement('h3', { className: 'dshsb_cardTitle' }, tr('settings.export') + ' / ' + tr('settings.import')),
      ReactRef.createElement('div', { className: 'dshsb_cardActions' },
        ReactRef.createElement('button', {
          type: 'button', className: 'dshsb_btn',
          onClick: () => { downloadScoreboard(setState) },
        }, tr('settings.manageExport')),
        ReactRef.createElement('button', {
          type: 'button', className: 'dshsb_btn',
          onClick: () => { if (fileRef.current) fileRef.current.click() },
        }, tr('settings.manageImport')),
        ReactRef.createElement('input', {
          ref: fileRef, type: 'file', accept: 'application/json,.json', style: { display: 'none' },
          onChange: (ev) => { importScoreboardFile(ev, { importMode, setState, load }) },
        }),
        ReactRef.createElement('select', {
          className: 'dshsb_select',
          value: importMode,
          onChange: (e) => setImportMode(e.target.value),
        },
          ReactRef.createElement('option', { value: 'merge' }, tr('settings.importMerge')),
          ReactRef.createElement('option', { value: 'replace' }, tr('settings.importReplace')),
        ),
      ),
      ReactRef.createElement('p', { className: 'dshsb_hint' }, tr('settings.manageImportHint') + ' · ' + tr('settings.apiNote')),
    ),
  ),
)
  }

/**
 * 记分板 UI 工厂：把 i18n 字典、样式与三个选项卡组件装配成一个页面组件。
 *
 * @param React - 宿主提供的 React。
 * @returns { page, NS, dict, ensureCss, tr, fmtTime, shortSessionId, pageSequence, Pager, setLocale, setSessions }
 */
function createScoreboardUi() {
    return {
  page: ScoreboardPage,
  NS,
  dict: L,
  ensureCss,
  tr,
  fmtTime,
  shortSessionId,
  pageSequence,
  Pager,
  setLocale: (ctx) => { localeCtx = ctx },
  setSessions: (svc) => { sessionsSvc = svc },
    }
}