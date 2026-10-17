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
// <i18n-fallback-start> 由 scripts/sync-i18n-fallback.mjs 从 lib/i18n/{zh,en}.json 生成，勿手改
  // 完整字典内嵌为同步兜底：外置 fetch 失败时页面仍显示正确文案，不退化出原始键名。
  zh: {
    "settings.title": "Skill 记分板",
    "settings.desc": "AI 会话中 skill 工具的使用次数自动统计。",
    "settings.loading": "加载中…",
    "settings.empty": "暂无记录：还没有 skill 被加载过。",
    "settings.error": "加载失败: {err}",
    "settings.refresh": "刷新",
    "settings.totalBadge": "{n} 次",
    "settings.skillCol": "skill",
    "settings.rankCol": "#",
    "settings.countCol": "去重次数",
    "settings.loadCountCol": "加载次数",
    "settings.lastUsedCol": "最近使用",
    "settings.updatedAt": "更新于 {time}",
    "settings.recorded": "共 {n} 个 skill",
    "settings.dateLocale": "zh-CN",
    "settings.apiNote": "GET /api/skill-scoreboard · 导出/导入 JSON",
    "settings.export": "导出",
    "settings.import": "导入",
    "settings.importMerge": "合并导入（保留原数据）",
    "settings.importReplace": "覆盖导入（仅保留新数据）",
    "settings.importOk": "已导入 {n} 个 skill",
    "settings.importFail": "导入失败: {err}",
    "settings.tabSkill": "Skill",
    "settings.tabSession": "会话",
    "settings.tabManage": "管理",
    "settings.sessionDesc": "加载过 skill 的会话排行：去重 skill 数越多越靠前，并列按加载次数。",
    "settings.manageDesc": "记分数据的导入、导出与概览。",
    "settings.sessionCol": "会话",
    "settings.distinctCol": "去重 skill",
    "settings.expand": "展开该会话加载的 skill",
    "settings.collapse": "收起",
    "settings.openSession": "打开会话",
    "settings.sessionNoTitle": "（无标题会话）",
    "settings.pageInfo": "共 {total} 条 · 第 {page}/{pages} 页",
    "settings.pageSizeLabel": "每页",
    "settings.pagerFirst": "首页",
    "settings.pagerPrev": "上一页",
    "settings.pagerNext": "下一页",
    "settings.pagerLast": "末页",
    "settings.manageOverview": "数据概览",
    "settings.manageExport": "导出 JSON",
    "settings.manageImport": "导入 JSON",
    "settings.manageImportHint": "选择要导入的 skill-usage.json",
    "settings.manageFile": "数据文件",
    "settings.manageSkills": "skill 数",
    "settings.manageSessions": "会话数",
    "settings.manageTotal": "累计去重",
    "settings.manageTotalLoads": "累计加载",
    "settings.manageUpdated": "最近写入",
    "settings.manageEstimated": "含 v1 迁移估计值（加载次数按去重数兜底）",
    "settings.emptySessions": "暂无会话记录：还没有会话加载过 skill。",
  },
  en: {
    "settings.title": "Skill scoreboard",
    "settings.desc": "Automatic skill usage counts.",
    "settings.loading": "Loading…",
    "settings.empty": "No records yet: no skill has been loaded.",
    "settings.error": "Failed to load: {err}",
    "settings.refresh": "Refresh",
    "settings.totalBadge": "{n} uses",
    "settings.skillCol": "skill",
    "settings.rankCol": "#",
    "settings.countCol": "per session",
    "settings.loadCountCol": "every load",
    "settings.lastUsedCol": "last used",
    "settings.updatedAt": "Updated {time}",
    "settings.recorded": "{n} entries",
    "settings.dateLocale": "en-US",
    "settings.apiNote": "GET /api/skill-scoreboard · export/import JSON",
    "settings.export": "Export",
    "settings.import": "Import",
    "settings.importMerge": "Merge import (keep existing)",
    "settings.importReplace": "Replace import (new only)",
    "settings.importOk": "Imported {n} skills",
    "settings.importFail": "Import failed: {err}",
    "settings.tabSkill": "Skills",
    "settings.tabSession": "Sessions",
    "settings.tabManage": "Manage",
    "settings.sessionDesc": "Sessions that loaded skills: more distinct skills first, ties by load count.",
    "settings.manageDesc": "Import, export and inspect the scoreboard data.",
    "settings.sessionCol": "session",
    "settings.distinctCol": "skills",
    "settings.expand": "Show skills loaded in this session",
    "settings.collapse": "Collapse",
    "settings.openSession": "Open session",
    "settings.sessionNoTitle": "(untitled session)",
    "settings.pageInfo": "{total} total · page {page}/{pages}",
    "settings.pageSizeLabel": "per page",
    "settings.pagerFirst": "First",
    "settings.pagerPrev": "Previous",
    "settings.pagerNext": "Next",
    "settings.pagerLast": "Last",
    "settings.manageOverview": "Overview",
    "settings.manageExport": "Export JSON",
    "settings.manageImport": "Import JSON",
    "settings.manageImportHint": "Choose a skill-usage.json to import",
    "settings.manageFile": "Data file",
    "settings.manageSkills": "skills",
    "settings.manageSessions": "sessions",
    "settings.manageTotal": "per-session total",
    "settings.manageTotalLoads": "load total",
    "settings.manageUpdated": "Last write",
    "settings.manageEstimated": "includes v1 migration estimates (loads fall back to distinct count)",
    "settings.emptySessions": "No session records yet: no session has loaded a skill.",
  },
// <i18n-fallback-end>
}

// 外置 i18n 字典的订阅与拉取（dictListeners / subscribeDict / loadDict）定义在顶层作用域，
// 因为消费它们的 ScoreboardPage 等组件也在顶层——放进本 factory 内部会导致组件侧 ReferenceError。


