function activeLocaleId() {
  try {
const snap = localeCtx && typeof localeCtx.getLocale === 'function' ? localeCtx.getLocale() : null
if (snap && typeof snap.id === 'string') return snap.id
  } catch { /* locale 读取失败，降级默认中文 */ }
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

