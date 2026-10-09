// ── 插件装配：设置侧边栏导航条目（settings.section 列表槽） ─────────────
// 页面组件与文案由 createScoreboardUi 提供（顶层函数，见文件上方）。
const ui = createScoreboardUi()
const inject = ['slots', 'locale']

function apply(ctx) {
  ui.setLocale(ctx.locale)
  // 宿主 sessions 服务：用 ctx.get 动态取（cordis 的 get 不需要 inject 声明，未提供时返回 undefined），
  // 取不到则会话标题退化为短 id、「打开会话」不可用，页面本身不受影响。
  try { ui.setSessions(ctx.get ? ctx.get('sessions') : null) } catch { ui.setSessions(null) }
  const disposeDict = ctx.locale.register(ui.NS, ui.dict)
  const slots = ctx.get('slots')
  if (slots !== undefined) {
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'skill-scoreboard', order: SETTINGS_SECTION_ORDER, label: () => ui.tr('settings.title') },
      () => React.createElement(ui.page, null),
    ))
  }
  ctx.effect(() => disposeDict, 'dsh-skill-scoreboard: dictionaries')
  // 外置 i18n 字典：插件激活即开始拉取（fire-and-forget，失败静默保留同步兜底）。
  loadDict()
}

exports.NS = ui.NS
exports.name = name
exports.apply = apply
exports.inject = inject
return module.exports
}


/**
 * 记分板 UI 工厂：把 i18n 字典、样式与三个选项卡组件装配成一个页面组件。
 * 定义为顶层函数（而非塞进 ModuleLoader 的 factory），便于阅读与单测。
 *
 * @param React - 宿主提供的 React。
 * @returns { page: 页面组件, ensureCss, tr, fmtTime, shortSessionId, pageSequence, Pager, setLocale, setSessions }
 */
