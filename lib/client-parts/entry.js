// dsh-skill-scoreboard — 浏览器半侧
// 设置 → 侧边栏 →「Skill 记分板」独立页面，仿插件市场的顶部选项卡结构，共三个选项卡：
//   Skill：skill 排行，固定按会话去重次数降序；去重与加载两种次数同列显示（去重列高亮）；列表分页（« ‹ 页码 › » + 每页条数）
//   会话：加载过 skill 的会话排行榜（去重 skill 数降序，越多越靠前），可展开看该会话加载过哪些 skill，
//        会话标题经宿主 sessions 服务解析（取不到则显示短 id），可点击打开该会话
//   管理：导出 / 导入（合并、覆盖）+ 数据概览（skill 数、会话数、累计次数、数据文件路径）
// 数据来自宿主端只读接口 GET /api/skill-scoreboard（lib/index.js 注册）。
//
// ── 整体 IIFE 包裹（2026-09-19） ─────────────────────────────────────────
// 手写插件的 client.js 自带自注册 load 调用时，client-modules 聚合会「原样拼接整个文件」，
// 顶层 let/const/function 因此全部落进聚合文件的同一个顶层作用域。本文件顶层有 55 个声明，
// 与同聚合的 dsh-session-migrate 有 10 个重名（createModule / tr / ensureCss / cssText /
// dictListeners / subscribeDict / localeCtx / activeLocaleId / FETCH_TIMEOUT_MS /
// SETTINGS_SECTION_ORDER）——顶层 let 重名是**解析期 SyntaxError**，会让整个聚合脚本失效，
// 浏览器表现为「Failed to load plugins」。包一层 IIFE 后顶层只剩一个表达式，所有声明进函数
// 作用域，与官方插件的 factory 闭包效果一致，且一个名字都不用改（默认采用此写法）。
(() => {
// Client entries must be classic scripts registered via window.__ModuleLoader__.load
// ({ id, factory }); the factory receives a synchronous `require`.
window.__ModuleLoader__.load({
  id: 'dsh-skill-scoreboard',
  factory: (require) => createModule(require),
})


/**
 * 模块装配：由 ModuleLoader 的 factory 调用，返回插件 exports。
 *
 * @param require - 宿主注入的同步 require（仅 react）。
 * @returns 插件模块导出对象（name/inject/apply）。
 */
/** 宿主注入的 React（createModule 时赋值，供顶层组件函数共用）。 */
let ReactRef = null

function createModule(require) {
var module = { exports: {} }
var exports = module.exports
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

const React = require('react')
ReactRef = React
const name = 'dsh-skill-scoreboard'
// 2026-09-13 修复：DSH 浏览器端 ModuleLoader 的宿主 require 只认模块表词（seed/已注册工厂），
// 不支持相对路径 JSON —— `./i18n/*.json` 会抛 missed-the-module-table。
// 2026-09-14（方案A）解耦：字典不再整份内嵌，由 host 侧把外置 lib/i18n/*.json 经 GET /api/skill-scoreboard/i18n
// 暴露、客户端 apply 后 fetch 拉取合并（改 dict 无需重打包 client bundle）。此处仅保留侧边栏导航标签所需的
// 极少量同步兜底字段，fetch 失败/未完成时导航不入键名。
L = {
  zh: {
    'settings.title': "Skill 记分板",
    'settings.desc': "AI 会话中 skill 工具的使用次数自动统计。",
  },
  en: {
    'settings.title': "Skill scoreboard",
    'settings.desc': "Automatic skill usage counts.",
  },
}

// 外置 i18n 字典的订阅与拉取（dictListeners / subscribeDict / loadDict）定义在顶层作用域，
// 因为消费它们的 ScoreboardPage 等组件也在顶层——放进本 factory 内部会导致组件侧 ReferenceError。


