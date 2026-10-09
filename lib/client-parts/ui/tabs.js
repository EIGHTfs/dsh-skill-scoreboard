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
