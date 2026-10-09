/**
 * ★通用模块 4：面板表头 + 状态区（Table）
 *
 * 为什么抽成独立模块：列表型插件页都有「表头行 + 四态主体（error/loading/empty/rows）」这套骨架，
 *   复刻容易各处不一致（尤其四态渲染顺序与 key 处理）。这里把骨架固化，把**类名**做成可覆盖映射：
 *   应用侧调一次 `setTableCls({...})` 即可接自己的样式，不改组件本身。
 *
 * 复制到别的插件时需保证：作用域里有 `ReactRef`（React 引用）与 `tr`（文案函数 `tr(key, vars)`）。
 * 表头列约定：`cols = [[类名, 文案键], …]`——**必须带 key**（React 对无 key 列表项告警；用下标而非类名，
 *   因为同一类名可能被两列复用，用类名当 key 会撞车）。
 */

/** 通用默认类名（应用侧可整体覆盖，见 setTableCls）。 */
const TABLE_DEFAULT_CLS = { headrow: 'ui-headrow', state: 'ui-state', err: 'ui-state-err', rows: 'ui-rows' }
let tableCls = TABLE_DEFAULT_CLS

/**
 * 覆盖表格类名映射（应用侧调一次即可；未给的键沿用通用默认值）。
 * @param {Partial<typeof TABLE_DEFAULT_CLS>} map 类名映射
 */
function setTableCls(map) {
  tableCls = { ...TABLE_DEFAULT_CLS, ...(map || {}) }
}

function panelHeadRow(cols) {
  return ReactRef.createElement('li', { className: tableCls.headrow },
    // 表头列必须带 key：React 对无 key 的列表项会告警。用下标而非类名——
    //   同一类名可能被「去重次数」与「加载次数」两列复用，用类名当 key 会撞车。
    cols.map(([cls, key], i) => ReactRef.createElement('span', { className: cls, key: i }, key ? tr(key) : '')),
  )
}

/** 面板状态区：error → loading → empty → rows（四选一渲染）。 */
function panelBody({ error, loading, hasRows, emptyKey, rowsNode }) {
  if (error) return ReactRef.createElement('li', { className: `${tableCls.state} ${tableCls.err}` }, tr('settings.error', { err: error }))
  if (loading && !hasRows) return ReactRef.createElement('li', { className: tableCls.state }, tr('settings.loading'))
  if (!hasRows) return ReactRef.createElement('li', { className: tableCls.state }, tr(emptyKey))
  return ReactRef.createElement('li', { className: tableCls.rows }, rowsNode)
}
