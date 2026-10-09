/**
 * ★通用模块 5：快照数据加载（useSnapshotLoader）
 *
 * 为什么抽成独立模块：插件页的「取数 → 解析 → 写状态 → 错误态」这套骨架反复出现，且容易各处不一致
 *   （超时、非 JSON 降级、HTTP 层失败转 Error）。这里把骨架固化，把**接口地址**做成可配置项：
 *   应用侧调一次 `setFetcherCfg({ apiBase })` 即可接自己的后端路径，组件本身不含项目专有路径。
 *
 * 复制到别的插件时需保证：作用域里有 `ReactRef`、`snapshotToState`（快照→state 的纯函数映射）、
 *   `httpError`（构造 HTTP 错误）与 `FETCH_TIMEOUT_MS`（超时毫秒）。
 * 用法（本项目）：`setFetcherCfg({ apiBase: '/api/skill-scoreboard' })` 后再渲染页面。
 */

/** 通用默认配置（应用侧可覆盖，见 setFetcherCfg）。apiBase 为空串表示「未配置」。 */
const FETCHER_DEFAULT_CFG = { apiBase: '' }
let fetcherCfg = FETCHER_DEFAULT_CFG

/**
 * 覆盖快照加载配置（应用侧调一次即可）。
 * @param {{apiBase?: string}} cfg 配置；未给的键沿用默认值
 */
function setFetcherCfg(cfg) {
  fetcherCfg = { ...FETCHER_DEFAULT_CFG, ...(cfg || {}) }
}

function useSnapshotLoader(setState) {
  return ReactRef.useCallback(() => {
setState((s) => ({ ...s, loading: true, error: '' }))
fetch(fetcherCfg.apiBase, { credentials: 'same-origin', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  .then((res) => applySnapshotResponse(res, setState))
  .catch((e) => setState((s) => ({ ...s, loading: false, error: (e && e.message) || String(e) })))
  }, [])
}

/**
 * 解析快照接口的响应并写入页面状态（useSnapshotLoader 的子步骤）。
 * 响应非 JSON 时降级为空快照；HTTP 层失败（非 2xx 或 ok:false）转成 Error 抛出，
 * 由调用方 catch 写进 error 状态。
 *
 * @param {object} res fetch 响应
 * @param {Function} setState 页面状态 setter
 * @returns {Promise<void>}
 */
async function applySnapshotResponse(res, setState) {
  const payload = await res.json().catch((e) => { /* 响应非 JSON 时降级空数据 */ return {} })
  if (!res.ok || !payload || !payload.ok) throw (payload && payload.error) ? new Error(payload.error) : httpError(res.status)
  setState((s) => ({ ...s, loading: false, error: '', ...snapshotToState(payload) }))
}
