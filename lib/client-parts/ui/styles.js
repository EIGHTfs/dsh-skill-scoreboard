
function ensureCss() {
  if (typeof document === 'undefined') return
  // 注意：本函数是顶层作用域，只能引用顶层常量 NS（不能引用 createModule 内的 name）
  if (document.querySelector('style[data-plugin-css="' + NS + '"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = NS
  tag.dataset.pluginCss = NS
  tag.textContent = cssText
  document.head.appendChild(tag)
}

let localeCtx = null // apply 时挂上，供 tr() 与组件读取当前 locale
let sessionsSvc = null // apply 时尝试取宿主 sessions 服务（取不到则标题/打开会话功能降级）

