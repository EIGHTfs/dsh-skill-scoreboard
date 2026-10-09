
/** 通用默认配置：注入的 <style> 用什么属性值做去重键、写什么样式文本。
 *  默认值取**中性值**（不含任何项目名）——复制到别的插件后必须由应用侧显式配置。 */
const STYLE_DEFAULT_CFG = { key: 'ui-plugin-css', css: '' }
let styleCfg = STYLE_DEFAULT_CFG

/**
 * 覆盖样式注入配置（应用侧调一次即可；未给的键沿用中性默认值）。
 * @param {{key?: string, css?: string}} cfg key=去重键（同时写入 data-plugin / data-plugin-css），css=样式文本
 */
function setStyleCfg(cfg) {
  styleCfg = { ...STYLE_DEFAULT_CFG, ...(cfg || {}) }
}

function ensureCss() {
  if (typeof document === 'undefined') return
  // 注意：本函数是顶层作用域，只能引用顶层变量（不能引用 createModule 内的 name）
  if (document.querySelector('style[data-plugin-css="' + styleCfg.key + '"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = styleCfg.key
  tag.dataset.pluginCss = styleCfg.key
  tag.textContent = styleCfg.css
  document.head.appendChild(tag)
}

let localeCtx = null // apply 时挂上，供 tr() 与组件读取当前 locale
let sessionsSvc = null // apply 时尝试取宿主 sessions 服务（取不到则标题/打开会话功能降级）

