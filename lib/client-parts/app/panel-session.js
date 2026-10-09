
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
