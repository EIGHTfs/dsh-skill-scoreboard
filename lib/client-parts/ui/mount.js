/**
 * ★通用模块 6：设置侧边栏「独立页」注册（settings.section 列表槽）
 *
 * 为什么抽成独立模块：DSH 第三方插件要在「设置 → 左侧导航」出独立页，写法固定但**容易踩坑**——
 *   ① 槽名必须是 `settings.section`；② 页面组件必须能用 `React.createElement(Page, null)` 渲染
 *   （`react/jsx-runtime` 的 `jsx(Component, null)` 会崩，表现为「导航在、内容全白」）；
 *   ③ 宿主没提供 slots 服务时要**静默跳过**，不能让整个插件挂掉。
 *   把这三条固化成一行调用，复制到别的插件即可复用（只传自己的 id/order/label/组件）。
 *
 * 复制到别的插件时需保证：作用域里有 `React`（DSH 客户端 factory 的常规写法：`require('react')`）。
 *
 * @param {object} p
 * @param {object} p.ctx    cordis 上下文（用 ctx.get('slots') 动态取服务）
 * @param {string} p.id     侧边栏导航键（本插件用 'skill-scoreboard'）
 * @param {number} p.order  排序值（越小越靠前）
 * @param {Function} p.label 返回标题文本的 thunk（可读当前语言）
 * @param {Function} p.Page  页面组件（React 组件）
 * @returns {boolean} 是否注册成功；宿主未提供 slots 时返回 false（调用方据此静默跳过）
 */
function registerSettingsSection({ ctx, id, order, label, Page }) {
  const slots = ctx && typeof ctx.get === 'function' ? ctx.get('slots') : undefined
  if (slots === undefined) return false
  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id, order, label },
    // 必须用 createElement 且允许 props 为 null——jsx-runtime 的 jsx(Comp, null) 会抛错并让面板空白
    () => React.createElement(Page, null),
  ))
  return true
}
