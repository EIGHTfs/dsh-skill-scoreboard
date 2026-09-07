// dsh-skill-scoreboard — 浏览器半侧（v1.5.0）
// 设置 → 侧边栏 →「Skill 记分板」独立页面：按次数降序展示全部 skill 使用统计。
// v1.5.0：页面顶部「会话去重 / 每次都算」切换——两种计数同时记录，切换只改变显示维度
// （count=同一会话只计 1 次；alwaysCount=每次加载都 +1）。
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
        'settings.desc': 'AI 会话中 skill 工具的使用统计。两种计数同时记录：会话去重（同一会话同一 skill 只计 1 次）与每次都算（每次加载都 +1）；顶部切换显示维度。数据由宿主端 tools/result 监听写入 data/skill-usage.json。',
        'settings.modeDedupe': '会话去重',
        'settings.modeDedupeHint': '同一会话内重复加载同一 skill 只计 1 次，跨会话累加',
        'settings.modeAlways': '每次都算',
        'settings.modeAlwaysHint': '每次加载 skill 都 +1，不按会话去重',
        'settings.loading': '加载中…',
        'settings.empty': '暂无记录：还没有 skill 被加载过。',
        'settings.error': '加载失败: {err}',
        'settings.refresh': '刷新',
        'settings.totalBadge': '{n} 次',
        'settings.totalAlwaysBadge': '全部 {n} 次',
        'settings.skillCol': 'skill',
        'settings.countCol': '次数',
        'settings.lastUsedCol': '最近使用',
        'settings.updatedAt': '更新于 {time}',
        'settings.recorded': '共 {n} 个 skill',
        'settings.dateLocale': 'zh-CN',
        'settings.apiNote': '只读接口 GET /api/skill-scoreboard',
      },
      en: {
        'settings.title': 'Skill scoreboard',
        'settings.desc': 'Automatic skill usage stats across AI sessions. Two counters are kept at once: per-session (deduplicated, 1 use per session per skill) and every-load (each load counts). Switch the display at the top. Written by the host tools/result listener into data/skill-usage.json.',
        'settings.modeDedupe': 'Per-session',
        'settings.modeDedupeHint': 'Same skill loaded repeatedly in one session counts once; accumulates across sessions',
        'settings.modeAlways': 'Every load',
        'settings.modeAlwaysHint': 'Each skill load counts +1 regardless of session',
        'settings.loading': 'Loading…',
        'settings.empty': 'No records yet: no skill has been loaded.',
        'settings.error': 'Failed to load: {err}',
        'settings.refresh': 'Refresh',
        'settings.totalBadge': '{n} uses',
        'settings.totalAlwaysBadge': '{n} loads total',
        'settings.skillCol': 'skill',
        'settings.countCol': 'uses',
        'settings.lastUsedCol': 'last used',
        'settings.updatedAt': 'Updated {time}',
        'settings.recorded': '{n} skills total',
        'settings.dateLocale': 'en-US',
        'settings.apiNote': 'Read-only endpoint GET /api/skill-scoreboard',
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
      // v1.5.0 顶部模式切换
      '.dshsb_mode{display:inline-flex;gap:4px;padding:3px;border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;background:var(--dsw-alias-bg-module-platform)}',
      '.dshsb_modebtn{font:inherit;font-size:12px;border:0;border-radius:7px;padding:4px 12px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-tertiary)}',
      '.dshsb_modebtn:hover{color:var(--dsw-alias-label-primary)}',
      '.dshsb_modebtn_active{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:600}',
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
      const [state, setState] = React.useState({ loading: true, error: '', skills: [], total: 0, totalAlways: 0, updatedAt: null })
      // v1.5.0 显示模式：'dedupe'（会话去重，默认）| 'always'（每次都算）
      const [mode, setMode] = React.useState('dedupe')
      const [, setLocaleTick] = React.useState(0)

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
            setState({
              loading: false,
              error: '',
              skills: Array.isArray(data.skills) ? data.skills : [],
              total: data.total || 0,
              totalAlways: data.totalAlways || 0,
              updatedAt: data.updatedAt || null,
            })
          })
          .catch((e) => setState((s) => ({ ...s, loading: false, error: (e && e.message) || String(e) })))
      }, [])

      React.useEffect(() => { load() }, [load])

      const rows = state.skills
      const shownTotal = mode === 'always' ? state.totalAlways : state.total
      return React.createElement('div', { className: 'dshsb_page' },
        React.createElement('div', { className: 'dshsb_hero' },
          React.createElement('div', { className: 'dshsb_title' }, tr('settings.title')),
          React.createElement('p', { className: 'dshsb_desc' }, tr('settings.desc')),
          React.createElement('div', { className: 'dshsb_meta' },
            React.createElement('div', { className: 'dshsb_mode', role: 'group', 'aria-label': tr('settings.title') },
              React.createElement('button', {
                type: 'button',
                className: 'dshsb_modebtn' + (mode === 'dedupe' ? ' dshsb_modebtn_active' : ''),
                title: tr('settings.modeDedupeHint'),
                onClick: () => setMode('dedupe'),
              }, tr('settings.modeDedupe')),
              React.createElement('button', {
                type: 'button',
                className: 'dshsb_modebtn' + (mode === 'always' ? ' dshsb_modebtn_active' : ''),
                title: tr('settings.modeAlwaysHint'),
                onClick: () => setMode('always'),
              }, tr('settings.modeAlways')),
            ),
            React.createElement('span', { className: 'dshsb_badge' },
              mode === 'always' ? tr('settings.totalAlwaysBadge', { n: shownTotal }) : tr('settings.totalBadge', { n: shownTotal })),
            rows.length ? React.createElement('span', { className: 'dshsb_badge' }, tr('settings.recorded', { n: rows.length })) : null,
            state.updatedAt ? React.createElement('span', { className: 'dshsb_api' }, tr('settings.updatedAt', { time: fmtTime(state.updatedAt) })) : null,
            React.createElement('button', { type: 'button', className: 'dshsb_btn', disabled: state.loading, onClick: load }, tr('settings.refresh')),
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
                      React.createElement('span', { className: 'dshsb_count' },
                        String(mode === 'always' ? (row.alwaysCount || 0) : row.count)),
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