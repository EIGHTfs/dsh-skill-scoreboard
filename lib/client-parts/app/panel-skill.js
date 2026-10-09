
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
