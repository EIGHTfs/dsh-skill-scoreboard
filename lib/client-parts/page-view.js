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
