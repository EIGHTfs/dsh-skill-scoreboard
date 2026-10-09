function useSnapshotLoader(setState) {
  return ReactRef.useCallback(() => {
setState((s) => ({ ...s, loading: true, error: '' }))
fetch('/api/skill-scoreboard', { credentials: 'same-origin', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  .then((res) => applySnapshotResponse(res, setState))
  .catch((e) => setState((s) => ({ ...s, loading: false, error: (e && e.message) || String(e) })))
  }, [])
}

/**
 * 解析 /api/skill-scoreboard 的响应并写入页面状态（useSnapshotLoader 的子步骤）。
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
