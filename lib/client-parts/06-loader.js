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
