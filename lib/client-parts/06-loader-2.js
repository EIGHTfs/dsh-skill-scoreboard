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
