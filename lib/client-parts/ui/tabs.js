/**
 * ★通用模块 3：选项卡条（TabBar）
 *
 * 为什么抽成独立模块：DSH 插件页做「多选项卡」时，结构与样式（对齐插件市场 .tabs/.tab/.on）是固定的，
 *   但**标签项与类名不该写死在通用组件里**——否则复制到别的插件就得改组件本身。
 *   这里把两者都做成入参：`tabs`（[{id,label}]）与 `cls`（类名映射），并给出通用默认值。
 *
 * 复制到别的插件时需保证：作用域里有 `ReactRef`（或把 `ReactRef` 换成该插件的 React 引用）。
 * 用法（本项目调用点）：
 *   ReactRef.createElement(TabBar, { tab, onSelect, tabs: [{ id: 'skill', label: tr('settings.tabSkill') }, …],
 *                                    cls: { tabs: 'dshsb_tabs', tab: 'dshsb_tab', on: 'dshsb_tabOn' } })
 *
 * @param {object} p
 * @param {string} p.tab        当前选中项 id
 * @param {Array<{id:string,label:string}>} p.tabs 标签项（id 用于 onSelect 回调）
 * @param {(id:string)=>void} p.onSelect 切换回调
 * @param {{tabs:string,tab:string,on:string}} [p.cls] 类名映射（缺省用通用默认值）
 */
const TABBAR_DEFAULT_CLS = { tabs: 'ui-tabs', tab: 'ui-tab', on: 'ui-tab-on' }

function TabBar({ tab, tabs, onSelect, cls }) {
  const C = cls || TABBAR_DEFAULT_CLS
  const defs = Array.isArray(tabs) ? tabs : []
  return ReactRef.createElement('div', { className: C.tabs, role: 'tablist' },
    defs.map((item) => ReactRef.createElement('button', {
      key: item.id,
      type: 'button',
      role: 'tab',
      'aria-selected': tab === item.id,
      className: tab === item.id ? `${C.tab} ${C.on}` : C.tab,
      onClick: () => onSelect(item.id),
    }, item.label)),
  )
}

/** API 快照 → state 增量（纯函数；loading/error 由调用方管理）。
 * @param data API 返回的快照对象（skills/sessions/total/... 域字段）
 */
