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

