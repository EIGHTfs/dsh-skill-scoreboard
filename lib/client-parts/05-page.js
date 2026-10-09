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

  // 外置 i18n 字典异步到达后重渲染（页面正文文案此时才完整）。
  ReactRef.useEffect(() => subscribeDict(() => setLocaleTick((t) => t + 1)), [])

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
