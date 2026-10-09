// ── i18n：zh/en 同键字典；tr 读当前 locale，缺词回退 en → 键名 ──────────
// 2026-09-14（方案A）字典改为外置：host 侧暴露 /api/skill-scoreboard/i18n，client apply 后由 loadDict
// fetch 拉取合并进 L（源码仅保留导航所需 title/desc 同步兜底）。DSH 浏览器 require 不支持相对路径 JSON，
// 故不落地为内嵌对象字面量、也不经 require 加载。
const NS = 'dsh-skill-scoreboard'
let L = null // createModule 时注入同步兜底字典；loadDict 拉取外置 json 后合并扩充

// ── 外置 i18n 字典：订阅 + 拉取（方案A，2026-09-14） ──────────────────────
// 根因见 DSH 宿主 packages/client/modules/src/client/system.ts makeRequire：浏览器 require 只认 seed 词、
// 已注册 factory、已实例化模块，不做相对路径解析；故字典改走 host 暴露的 HTTP 接口拉取。
// 注意：dictListeners / subscribeDict / loadDict 必须留在顶层——ScoreboardPage、apply 等
// 顶层函数都要引用它们；若放回 createModule 内部，组件在 useEffect 里调用会抛 ReferenceError，
// React 随即卸载整棵树，表现为「设置里有入口但点进去空白」（2026-09-18 修复）。
const dictListeners = new Set()

/** 订阅字典拉取完成事件；返回退订函数（组件 effect 用）。 */
function subscribeDict(fn) { dictListeners.add(fn); return () => dictListeners.delete(fn) }

/** 拉取外置字典并合并进 L（同引用，页面与导航 label 一并更新）；失败保留同步兜底。 */
async function loadDict() {
  try {
    const res = await fetch('/api/skill-scoreboard/i18n', {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const body = await res.json()
    if (body && body.zh && typeof body.zh === 'object' && body.en && typeof body.en === 'object') {
      L.zh = { ...L.zh, ...body.zh }
      L.en = { ...L.en, ...body.en }
    }
  } catch { /* fetch 失败/格式异常：保留同步兜底，不影响页面可用 */ }
  for (const fn of dictListeners) { try { fn() } catch { /* 单个监听失败不阻断 */ } }
}

// 组件级 CSS：设置页全局注入一次，主题走 DSH 设计 token（明暗自适应）
// 选项卡 / 分页样式对齐插件市场（.tabs/.tab/.on/.pager）
