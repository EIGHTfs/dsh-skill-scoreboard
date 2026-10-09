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
