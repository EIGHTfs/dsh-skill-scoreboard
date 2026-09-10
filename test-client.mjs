/**
 * dsh-skill-scoreboard v1.8.0 前端冒烟测试（无浏览器环境）
 *
 * 用最小 React 替身 + 假 fetch 加载 lib/client.js，验证：
 *  - 模块装配（ModuleLoader 注册、exports/inject、apply 注册 settings.section）
 *  - 三个选项卡渲染（Skill / 会话 / 管理）与二级翻页（去重 / 全部加载）
 *  - 分页控件、页码信息、每页条数选择
 *  - 会话榜行渲染与展开态
 *  - 管理页概览与导入导出控件
 * 不依赖 DOM：仅做虚拟树结构断言。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pass = 0, fail = 0
const ok = (c, l) => { console.log(`${c ? '  ✅' : '  ❌'} ${l}`); if (c) pass++; else fail++; }

// ── 最小 React 替身 ────────────────────────────────────────────────────────
let stateSlots = []
let cursor = 0
let pendingEffects = []
const React = {
  createElement: (t, p, ...c) => ({ t, p: p || {}, c: c.flat().filter((x) => x !== null && x !== undefined && x !== false) }),
  useState: (v) => {
    const i = cursor++
    if (!(i in stateSlots)) stateSlots[i] = typeof v === 'function' ? v() : v
    return [stateSlots[i], (n) => { stateSlots[i] = typeof n === 'function' ? n(stateSlots[i]) : n }]
  },
  useEffect: (fn) => { pendingEffects.push(fn) },
  useCallback: (f) => f,
  useRef: (v) => ({ current: v }),
}

let entry = null
globalThis.window = { __ModuleLoader__: { load: (m) => { entry = m } } }
const origRequire = Module.prototype.require
Module.prototype.require = function (id) { return id === 'react' ? React : origRequire.apply(this, arguments) }

// ── 假数据与假 fetch ───────────────────────────────────────────────────────
const API = {
  ok: true, total: 40, totalLoads: 55, recorded: 30,
  updatedAt: '2026-09-10T00:00:00.000Z', dataFile: '/x/skill-usage.json',
  skills: Array.from({ length: 30 }, (_, i) => ({
    name: 'skill-' + String(i).padStart(2, '0'),
    count: 30 - i,
    loads: (30 - i) + (i % 3),
    lastUsedAt: '2026-09-10T00:00:00.000Z',
  })),
  sessions: Array.from({ length: 25 }, (_, i) => ({
    id: 'session-000' + i + '-abcd',
    loads: 25 - i,
    distinct: 25 - i,
    skills: ['full-context-read', 'dsh-repo-index'],
    firstUsedAt: null,
    lastUsedAt: '2026-09-10T00:00:00.000Z',
    loadsEstimated: i === 0,
  })),
}
globalThis.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => API })

await import(join(__dirname, 'lib', 'client.js'))
ok(!!entry, 'ModuleLoader 注册了客户端入口')
ok(entry.id === 'dsh-skill-scoreboard', '入口 id 正确')

const mod = entry.factory((id) => (id === 'react' ? React : origRequire.call(module, id)))
ok(mod.name === 'dsh-skill-scoreboard' && typeof mod.apply === 'function', 'exports 暴露 name/apply')
ok(Array.isArray(mod.inject) && mod.inject.includes('slots') && mod.inject.includes('locale'), 'inject 声明 slots/locale')

// ── 装配（模拟 cordis ctx） ────────────────────────────────────────────────
const registered = []
const sectionCtx = {
  locale: { register: () => () => {}, getLocale: () => ({ id: 'zh' }), subscribe: () => () => {} },
  get: (n) => (n === 'slots' ? {
    inject: (_slot, cb) => cb(),
    register: (opt, render) => { registered.push({ opt, render }) },
  } : undefined),
  effect: () => {},
}
mod.apply(sectionCtx)
ok(registered.length === 1, 'apply 注册了 settings.section 一个页面')
ok(registered[0].opt && registered[0].opt.id === 'skill-scoreboard', 'settings.section id = skill-scoreboard')

// ── 渲染与结构断言 ─────────────────────────────────────────────────────────
// 槽位渲染回调返回的是 <ScoreboardPage/> 元素，真正的 React 渲染器会调用函数组件；
// 这里手工展开函数组件（含 Pager 等子组件），还原出完整虚拟树。
const expand = (node, depth = 0) => {
  if (depth > 50) return node
  if (typeof node.t === 'function') return expand(node.t(node.p), depth + 1)
  if (!node.c || !node.c.length) return node
  return { ...node, c: node.c.map((ch) => (ch && typeof ch === 'object' ? expand(ch, depth + 1) : ch)) }
}
const collect = (node, acc = { cls: [], texts: [], nodes: [] }) => {
  if (!node || typeof node !== 'object') return acc
  const cls = node.p && node.p.className
  if (cls) acc.cls.push(String(cls))
  acc.nodes.push(node)
  for (const ch of node.c || []) {
    if (typeof ch === 'string') acc.texts.push(ch)
    else collect(ch, acc)
  }
  return acc
}
// 渲染一次：展开函数组件 + 跑一次 effect（首次渲染会触发 fetch 加载）
const renderOnce = () => {
  cursor = 0
  pendingEffects = []
  const tree = collect(expand(registered[0].render()))
  const effects = pendingEffects
  pendingEffects = []
  for (const fn of effects) { try { fn() } catch {} }
  return tree
}
// 首帧 + 刷新若干微任务（等假 fetch 的 Promise 链落定）后重渲染
const render = () => renderOnce()
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const renderSettled = async () => { let t = renderOnce(); await flush(); t = renderOnce(); await flush(); return t }

// ── ensureCss 回归防护：模拟浏览器 document ────────────────────────────────
// ensureCss 曾因引用重构后不可见的变量，在真实浏览器抛 ReferenceError（页面白屏）；
// 这里让 document 存在，覆盖「有 DOM 时注入样式」这条此前测不到的路径。
const injectedStyles = []
const makeEl = () => ({ dataset: {}, textContent: '', click() {}, remove() {}, style: {} })
globalThis.document = {
  querySelector: () => null,
  createElement: makeEl,
  head: { appendChild: (el) => injectedStyles.push(el) },
  body: { appendChild: () => {} },
}

// 默认页（Skill 选项卡）
let view = await renderSettled()
ok(injectedStyles.some((el) => el.dataset.pluginCss === 'dsh-skill-scoreboard'), 'ensureCss 在浏览器环境注入插件样式（不抛错）')
ok(view.cls.includes('dshsb_tabs'), '渲染出顶部选项卡容器')
const tabBtns = view.nodes.filter((n) => n.p && String(n.p.className || '').includes('dshsb_tab') && !String(n.p.className).includes('dshsb_tabs'))
ok(tabBtns.length === 3, `三个选项卡按钮（实际 ${tabBtns.length}）`)
ok(['Skill', '会话', '管理'].every((t) => view.texts.includes(t)), '选项卡文案为 Skill / 会话 / 管理')
ok(view.cls.filter((c) => c.split(' ').some((x) => x === 'dshsb_subTab' || x === 'dshsb_subTabOn')).length === 0, 'Skill 内已无「去重 / 全部加载」二级切换选项')
ok(!view.texts.includes('按会话去重') && !view.texts.includes('按全部加载'), '不再渲染两种排行的切换文案')
ok(view.nodes.filter((n) => n.p && n.p.className === 'dshsb_count dshsb_countHot').length === 20, 'Skill 行去重列固定高亮（20 行）')
ok(view.nodes.filter((n) => n.p && n.p.className === 'dshsb_count dshsb_countDim').length === 20, 'Skill 行加载列常显（20 行，不高亮）')
ok(view.cls.some((c) => c.includes('dshsb_pagerPages')), '存在分页控件')
ok(view.texts.some((t) => String(t).includes('共 30 条')), '分页信息含总条数')
ok(view.nodes.filter((n) => n.p && n.p.className === 'dshsb_row').length === 20, 'Skill 首页 20 行（默认每页 20）')

// 切到会话选项卡
const tabSession = view.nodes.find((n) => n.p && n.p.role === 'tab' && n.c.includes('会话'))
tabSession.p.onClick()
view = await renderSettled()
ok(view.texts.includes('加载过 skill 的会话排行：去重 skill 数越多越靠前，并列按加载次数。'), '会话选项卡描述渲染')
ok(view.nodes.filter((n) => n.p && n.p.className === 'dshsb_row').length === 20, '会话首页 20 行')
ok(view.texts.some((t) => String(t).includes('0000')), '会话短 id 渲染')
const expandBtn = view.nodes.find((n) => n.p && String(n.p.className || '').includes('dshsb_expandBtn'))
ok(!!expandBtn, '会话行有展开按钮')
expandBtn.p.onClick()
view = await renderSettled()
ok(view.cls.includes('dshsb_subrow') && view.texts.includes('full-context-read'), '展开后显示该会话加载的 skill')

// 切到管理选项卡
const tabManage = view.nodes.find((n) => n.p && n.p.role === 'tab' && n.c.includes('管理'))
tabManage.p.onClick()
view = await renderSettled()
ok(view.cls.includes('dshsb_cards') && view.texts.includes('数据概览'), '管理页渲染概览卡片')
ok(view.texts.includes('导出 JSON') && view.texts.includes('导入 JSON'), '管理页含导出/导入按钮')
ok(view.texts.includes('合并导入（保留原数据）') || view.nodes.some((n) => n.t === 'option'), '管理页含导入模式选择')
ok(view.texts.some((t) => String(t).includes('/x/skill-usage.json')), '管理页显示数据文件路径')
ok(view.texts.includes('含 v1 迁移估计值（加载次数按去重数兜底）'), '管理页提示 v1 迁移估计值')

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
