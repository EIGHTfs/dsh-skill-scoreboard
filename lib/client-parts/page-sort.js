// ── 记分板页面（三选项卡） ──────────────────────────────────────────────
/**
 * skill 榜排序：固定按会话去重次数降序；并列按名称。
 * 两种次数在表格里同时显示、去重列为主列，故排序键不再可切换。
 *
 * @param skills - API 返回的 skill 行。
 * @returns 排好序的新数组。
 */
function sortSkillRows(skills) {
  return skills.slice().sort((a, b) => (
    (b.count || 0) - (a.count || 0) || String(a.name).localeCompare(String(b.name))
  ))
}

/**
 * 会话榜排序：去重 skill 数降序（越多越靠前），并列按加载次数、再按最近活动。
 *
 * @param sessions - API 返回的会话行。
 * @returns 排好序的新数组。
 */
function sortSessionRows(sessions) {
  return sessions.slice().sort((a, b) => (
    (b.distinct || 0) - (a.distinct || 0)
    || (b.loads || 0) - (a.loads || 0)
    || String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || ''))
  ))
}

/**
 * 求分页参数：页码夹在合法区间内，并切出当前页数据。
 *
 * @param rows - 全量行。
 * @param requestedPage - 期望页码（1 基）。
 * @param pageSize - 每页条数。
 * @returns { page, pageCount, slice }。
 */
function paginate(rows, requestedPage, pageSize) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(Math.max(1, requestedPage || 1), pageCount)
  return { page, pageCount, slice: rows.slice((page - 1) * pageSize, page * pageSize) }
}

/**
 * 顶部选项卡栏（Skill / 会话 / 管理），样式对齐插件市场 .tabs/.tab。
 *
 * @param props - { tab: 当前选项卡 id, onSelect: 切换回调 }。
 * @returns 选项卡栏元素。
 */
