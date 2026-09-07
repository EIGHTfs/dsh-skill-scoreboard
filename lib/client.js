// dsh-skill-scoreboard — 浏览器半侧（v1.6.0）
// 设置 → 侧边栏 →「Skill 记分板」独立页面：按次数降序展示全部 skill 使用统计；
// 可切换「按会话去重」/「每次加载」两种记分规则。
// 数据来自宿主端只读接口 GET /api/skill-scoreboard（lib/index.js 注册）。
//
// Client entries must be classic scripts registered via window.__ModuleLoader__.load
// ({ id, factory }); the factory receives a synchronous `require`.
window.__ModuleLoader__.load({
  id: 'dsh-skill-scoreboard',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const name = 'dsh-skill-scoreboard'

    // ── i18n：zh/en 同键字典；tr 读当前 locale，缺词回退 en → 键名 ──────────
    // 字典注册进 locale 服务（ctx.locale.register），tr 走同步查表，保证
    // label thunk 每次投影都能拿到当前语言的标题。
    const NS = 'dsh-skill-scoreboard'
    const L = {
      zh: {
        'settings.title': 'Skill 记分板',
        'settings.desc': 'AI 会话中 skill 工具的使用次数自动统计。可切换两种规则：按会话去重（同会话同一 skill 只计 1），或每次成功加载都计。数据由宿主端 tools/result 监听写入 data/skill-usage.json。',
        'settings.loading': '加载中…',
        'settings.empty': '暂无记录：还没有 skill 被加载过。',
        'settings.error': '加载失败: {err}',
        'settings.refresh': '刷新',
        'settings.totalBadge': '{n} 次',
        'settings.modeSession': '按会话去重',
        'settings.modeLoads': '每次加载',
        'settings.skillCol': 'skill',
        'settings.countCol': '次数',
        'settings.lastUsedCol': '最近使用',
        'settings.updatedAt': '更新于 {time}',
        'settings.recorded': '共 {n} 个 skill',
        'settings.dateLocale': 'zh-CN',
        'settings.apiNote': 'GET /api/skill-scoreboard · 导出/导入 JSON',
        'settings.export': '导出',
        'settings.import': '导入',
        'settings.importMerge': '导入并合并',
        'settings.importReplace': '导入并替换',
        'settings.importOk': '已导入 {n} 个 skill',
        'settings.importFail': '导入失败: {err}',
      },
      en: {
        'settings.title': 'Skill scoreboard',
        'settings.desc': 'Automatic skill usage counts. Switch between session-dedup (same skill once per session) and every successful load. Written by the host tools/result listener into data/skill-usage.json.',
        'settings.loading': 'Loading…',
        'settings.empty': 'No records yet: no skill has been loaded.',
        'settings.error': 'Failed to load: {err}',
        'settings.refresh': 'Refresh',
        'settings.totalBadge': '{n} uses',
        'settings.modeSession': 'Per session',
        'settings.modeLoads': 'Every load',
        'settings.skillCol': 'skill',
        'settings.countCol': 'uses',
        'settings.lastUsedCol': 'last used',
        'settings.updatedAt': 'Updated {time}',
        'settings.recorded': '{n} skills total',
        'settings.dateLocale': 'en-US',
        'settings.apiNote': 'GET /api/skill-scoreboard · export/import JSON',
        'settings.export': 'Export',
        'settings.import': 'Import',
        'settings.importMerge': 'Import and merge',
        'settings.importReplace': 'Import and replace',
        'settings.importOk': 'Imported {n} skills',
        'settings.importFail': 'Import failed: {err}',
      },
    }

    // 组件级 CSS：设置页全局注入一次，主题走 DSH 设计 token（明暗自适应）
    const cssText = [
      '.dshsb_page{display:flex;flex-direction:column;gap:14px}',
      '.dshsb_hero{display:flex;flex-direction:column;gap:6px}',
      '.dshsb_title{font-size:20px;font-weight:650;color:var(--dsw-alias-label-primary)}',
      '.dshsb_desc{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-tertiary);max-width:66ch}',
      '.dshsb_meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dshsb_badge{border-radius:999px;padding:2px 10px;font-size:12px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l3)}',
      '.dshsb_api{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.dshsb_btn{font:inherit;font-size:12px;border-radius:8px;padding:5px 12px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}',
      '.dshsb_btn:hover{background:var(--dsw-alias-bg-layer-3)}',
      '.dshsb_btn:disabled{opacity:.55;cursor:default}',
      '.dshsb_btnActive{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);font-weight:650}',
      '.dshsb_panel{list-style:none;margin:0;padding:0;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.dshsb_headrow{display:flex;align-items:center;gap:8px;padding:10px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dshsb_headname{flex:1;min-width:0}',
      '.dshsb_headcount,.dshsb_headtime{flex-shrink:0;text-align:right}',
      '.dshsb_headcount{width:64px}.dshsb_headtime{width:132px}',
      '.dshsb_rows{max-height:56vh;overflow-y:auto}',
      '.dshsb_row{display:flex;align-items:center;gap:8px;padding:9px 16px;font-size:13px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.dshsb_row:last-child{border-bottom:0}',
      '.dshsb_row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshsb_name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary)}',
      '.dshsb_count{flex-shrink:0;width:64px;text-align:right;font-weight:650;color:var(--dsw-alias-label-primary)}',
      '.dshsb_time{flex-shrink:0;width:132px;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.dshsb_state{padding:28px 16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}',
      '.dshsb_err{color:var(--dsw-alias-label-error)}',
    ].join('')

    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="dsh-skill-scoreboard"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = name
      tag.dataset.pluginCss = name
      tag.textContent = cssText
      document.head.appendChild(tag)
    }

    let localeCtx = null // apply 时挂上，供 tr() 与组件读取当前 locale

    function activeLocaleId() {
      try {
        const snap = localeCtx && typeof localeCtx.getLocale === 'function' ? localeCtx.getLocale() : null
        if (snap && typeof snap.id === 'string') return snap.id
      } catch {}
      return 'zh'
    }

    function tr(key, vars) {
      const id = activeLocaleId()
      const dict = String(id).toLowerCase().startsWith('zh') ? L.zh : L.en
      let s = dict[key] ?? L.zh[key] ?? L.en[key] ?? key
      if (vars) {
        for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]))
      }
      return s
    }

    function fmtTime(iso) {
      if (!iso) return '—'
      try {
        return new Date(iso).toLocaleString(tr('settings.dateLocale'), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      } catch {
        return String(iso).slice(0, 16).replace('T', ' ')
      }
    }

    // ── 记分板页面 ──────────────────────────────────────────────────────────
    function ScoreboardPage() {
      ensureCss()
      const [state, setState] = React.useState({ loading: true, error: '', skills: [], total: 0, totalLoads: 0, updatedAt: null, notice: '' })
      const [mode, setMode] = React.useState('session')
      const [, setLocaleTick] = React.useState(0)
      const fileRef = React.useRef(null)

      // 语言切换时重渲染（label thunk 由 shell 按投影重读，页面正文靠订阅）
      React.useEffect(() => {
        if (!localeCtx || typeof localeCtx.subscribe !== 'function') return
        return localeCtx.subscribe(() => setLocaleTick((t) => t + 1))
      }, [])

      const load = React.useCallback(() => {
        setState((s) => ({ ...s, loading: true, error: '' }))
        fetch('/api/skill-scoreboard', { credentials: 'same-origin' })
          .then(async (res) => {
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || 'HTTP ' + res.status)
            setState((s) => ({
              ...s,
              loading: false,
              error: '',
              skills: Array.isArray(data.skills) ? data.skills : [],
              total: data.total || 0,
              totalLoads: data.totalLoads || data.total || 0,
              updatedAt: data.updatedAt || null,
            }))
          })
          .catch((e) => setState((s) => ({ ...s, loading: false, error: (e && e.message) || String(e) })))
      }, [])

      React.useEffect(() => { load() }, [load])

      const byLoads = mode === 'loads'
      const rows = state.skills.slice().sort((a, b) => {
        const av = byLoads ? (a.loads || a.count || 0) : (a.count || 0)
        const bv = byLoads ? (b.loads || b.count || 0) : (b.count || 0)
        return bv - av || String(a.name).localeCompare(String(b.name))
      })
      const totalShown = byLoads ? (state.totalLoads || state.total) : state.total
      return React.createElement('div', { className: 'dshsb_page' },
        React.createElement('div', { className: 'dshsb_hero' },
          React.createElement('div', { className: 'dshsb_title' }, tr('settings.title')),
          React.createElement('p', { className: 'dshsb_desc' }, tr('settings.desc')),
          React.createElement('div', { className: 'dshsb_meta' },
            React.createElement('button', { type: 'button', className: 'dshsb_btn' + (mode === 'session' ? ' dshsb_btnActive' : ''), onClick: () => setMode('session') }, tr('settings.modeSession')),
            React.createElement('button', { type: 'button', className: 'dshsb_btn' + (mode === 'loads' ? ' dshsb_btnActive' : ''), onClick: () => setMode('loads') }, tr('settings.modeLoads')),
            React.createElement('span', { className: 'dshsb_badge' }, tr('settings.totalBadge', { n: totalShown })),
            rows.length ? React.createElement('span', { className: 'dshsb_badge' }, tr('settings.recorded', { n: rows.length })) : null,
            state.updatedAt ? React.createElement('span', { className: 'dshsb_api' }, tr('settings.updatedAt', { time: fmtTime(state.updatedAt) })) : null,
            React.createElement('button', { type: 'button', className: 'dshsb_btn', disabled: state.loading, onClick: load }, tr('settings.refresh')),
            React.createElement('button', {
              type: 'button', className: 'dshsb_btn',
              onClick: () => {
                fetch('/api/skill-scoreboard/export', { credentials: 'same-origin' })
                  .then(async (res) => {
                    if (!res.ok) throw new Error('HTTP ' + res.status)
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'skill-usage.json'
                    document.body.appendChild(a)
                    a.click()
                    a.remove()
                    URL.revokeObjectURL(url)
                  })
                  .catch((e) => setState((s) => ({ ...s, error: (e && e.message) || String(e) })))
              },
            }, tr('settings.export')),
            React.createElement('button', {
              type: 'button', className: 'dshsb_btn',
              onClick: () => { if (fileRef.current) fileRef.current.click() },
            }, tr('settings.import')),
            React.createElement('input', {
              ref: fileRef, type: 'file', accept: 'application/json,.json', style: { display: 'none' },
              onChange: (ev) => {
                const f = ev.target.files && ev.target.files[0]
                ev.target.value = ''
                if (!f) return
                const merge = !window.confirm(tr('settings.importReplace') + '\n\nOK = ' + tr('settings.importMerge'))
                f.text().then((text) => fetch('/api/skill-scoreboard/import?merge=' + (merge ? 'true' : 'false'), {
                  method: 'POST', credentials: 'same-origin',
                  headers: { 'Content-Type': 'application/json' },
                  body: text,
                })).then(async (res) => {
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok || !data.ok) throw new Error(data.error || 'HTTP ' + res.status)
                  setState((s) => ({ ...s, notice: tr('settings.importOk', { n: data.recorded || 0 }) }))
                  load()
                }).catch((e) => setState((s) => ({ ...s, error: tr('settings.importFail', { err: (e && e.message) || String(e) }) })))
              },
            }),
            state.notice ? React.createElement('span', { className: 'dshsb_api' }, state.notice) : null,
          ),
        ),
        React.createElement('ol', { className: 'dshsb_panel' },
          React.createElement('li', { className: 'dshsb_headrow' },
            React.createElement('span', { className: 'dshsb_headname' }, tr('settings.skillCol')),
            React.createElement('span', { className: 'dshsb_headcount' }, tr('settings.countCol')),
            React.createElement('span', { className: 'dshsb_headtime' }, tr('settings.lastUsedCol')),
          ),
          state.error
            ? React.createElement('li', { className: 'dshsb_state dshsb_err' }, tr('settings.error', { err: state.error }))
            : state.loading && !rows.length
              ? React.createElement('li', { className: 'dshsb_state' }, tr('settings.loading'))
              : !state.loading && !rows.length
                ? React.createElement('li', { className: 'dshsb_state' }, tr('settings.empty'))
                : React.createElement('li', { className: 'dshsb_rows' },
                    rows.map((row) => React.createElement('div', {
                      className: 'dshsb_row',
                      key: row.name,
                      title: row.name,
                    },
                      React.createElement('span', { className: 'dshsb_name' }, row.name),
                      React.createElement('span', { className: 'dshsb_count' }, String(byLoads ? (row.loads || row.count || 0) : (row.count || 0))),
                      React.createElement('span', { className: 'dshsb_time' }, fmtTime(row.lastUsedAt)),
                    )),
                  ),
        ),
      )
    }

    // ── 插件装配：设置侧边栏导航条目（settings.section 列表槽） ─────────────
    // id 取 'skill-scoreboard' 新键，order 50 排在 Agent presets(20) 之后；
    // label 用 thunk 以便投影时跟随当前语言。
    const inject = ['slots', 'locale']

    function apply(ctx) {
      localeCtx = ctx.locale
      const disposeDict = ctx.locale.register(NS, L)
      const slots = ctx.get('slots')
      if (slots !== undefined) {
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'skill-scoreboard', order: 50, label: () => tr('settings.title') },
          () => React.createElement(ScoreboardPage, null),
        ))
      }
      ctx.effect(() => disposeDict, 'dsh-skill-scoreboard: dictionaries')
    }

    exports.NS = NS
    exports.name = name
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})