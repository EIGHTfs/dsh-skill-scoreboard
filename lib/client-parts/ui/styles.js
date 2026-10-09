const cssText = [
  '.dshsb_page{display:flex;flex-direction:column;gap:12px}',
  '.dshsb_hero{display:flex;flex-direction:column;gap:6px}',
  '.dshsb_title{font-size:20px;font-weight:650;color:var(--dsw-alias-label-primary)}',
  '.dshsb_desc{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-tertiary);max-width:66ch}',
  '.dshsb_meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
  '.dshsb_badge{border-radius:999px;padding:2px 10px;font-size:12px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l3)}',
  '.dshsb_api{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
  '.dshsb_btn{font:inherit;font-size:12px;border-radius:8px;padding:5px 12px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}',
  '.dshsb_btn:hover{background:var(--dsw-alias-bg-layer-3)}',
  '.dshsb_btn:disabled{opacity:.55;cursor:default}',
  '.dshsb_select{font:inherit;font-size:12px;border-radius:8px;padding:5px 10px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);cursor:pointer}',
  // 顶部选项卡（对齐插件市场 .tabs/.tab/.on）
  '.dshsb_tabs{display:flex;align-items:flex-end;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2);margin-top:2px}',
  '.dshsb_tab{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-bottom:2px solid transparent;padding:7px 12px;font-size:13px}',
  '.dshsb_tab:hover{color:var(--dsw-alias-label-primary)}',
  '.dshsb_tabOn{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}',
  '.dshsb_tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:2px}',
  // 榜单表格 + 分页
  '.dshsb_panelWrap{display:flex;flex-direction:column;gap:10px}',
  '.dshsb_panel{list-style:none;margin:0;padding:0;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
  '.dshsb_headrow{display:flex;align-items:center;gap:8px;padding:10px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);border-bottom:.5px solid var(--dsw-alias-border-l2)}',
  '.dshsb_headname{flex:1;min-width:0}',
  '.dshsb_headcount,.dshsb_headtime,.dshsb_headrank,.dshsb_headexpand{flex-shrink:0;text-align:right}',
  '.dshsb_headrank{width:34px}',
  '.dshsb_headcount{width:72px}.dshsb_headtime{width:132px}',
  '.dshsb_headexpand{width:22px}',
  '.dshsb_rows{max-height:56vh;overflow-y:auto}',
  '.dshsb_row{display:flex;align-items:center;gap:8px;padding:9px 16px;font-size:13px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
  '.dshsb_row:last-child{border-bottom:0}',
  '.dshsb_row:hover{background:var(--dsw-alias-bg-layer-2)}',
  '.dshsb_rank{flex-shrink:0;width:34px;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}',
  '.dshsb_name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary)}',
  '.dshsb_sessName{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}',
  '.dshsb_sessId{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.dshsb_count{flex-shrink:0;width:72px;text-align:right;font-weight:650;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
  '.dshsb_countDim{flex-shrink:0;width:72px;text-align:right;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
  '.dshsb_countHot{color:var(--dsw-alias-brand-primary)}',
  '.dshsb_time{flex-shrink:0;width:132px;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px}',
  '.dshsb_expandBtn{flex-shrink:0;width:22px;height:20px;padding:0;line-height:1;border:0;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px}',
  '.dshsb_expandBtn:hover{color:var(--dsw-alias-label-primary)}',
  '.dshsb_subrow{padding:2px 16px 12px 58px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:12px}',
  '.dshsb_chip{display:inline-block;border:.5px solid var(--dsw-alias-border-l3);border-radius:4px;padding:1px 7px;margin:2px 4px 2px 0;font-size:11px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
  '.dshsb_state{padding:28px 16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}',
  '.dshsb_err{color:var(--dsw-alias-label-error)}',
  '.dshsb_muted{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px}',
  // 翻页（对齐插件市场 .pager）
  '.dshsb_pager{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin:12px 0 2px}',
  '.dshsb_pagerPages{display:flex;flex-wrap:wrap;flex:1;justify-content:center;align-items:center;gap:4px;min-width:0}',
  '.dshsb_pageBtn{font:inherit;font-size:12px;border-radius:6px;padding:3px 9px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}',
  '.dshsb_pageBtn:hover:not(:disabled){color:var(--dsw-alias-brand-primary)}',
  '.dshsb_pageBtn:disabled{opacity:.45;cursor:default}',
  '.dshsb_pageOn{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;font-weight:600}',
  '.dshsb_pageEll{color:var(--dsw-alias-label-tertiary);padding:0 2px;font-size:12px}',
  '.dshsb_pageInfo{color:var(--dsw-alias-label-secondary);white-space:nowrap;font-size:12px}',
  '.dshsb_pageSize{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}',
  // 管理页卡片
  '.dshsb_cards{display:flex;flex-direction:column;gap:10px}',
  '.dshsb_card{border:.5px solid var(--dsw-alias-border-l4);border-radius:14px;background:var(--dsw-alias-bg-layer-3);padding:12px 16px}',
  '.dshsb_cardTitle{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.dshsb_cardActions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
  '.dshsb_kv{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:12px;padding:3px 0}',
  '.dshsb_kvKey{color:var(--dsw-alias-label-tertiary);flex-shrink:0}',
  '.dshsb_kvVal{color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;text-align:right}',
  '.dshsb_hint{margin:6px 0 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
].join('')

function ensureCss() {
  if (typeof document === 'undefined') return
  // 注意：本函数是顶层作用域，只能引用顶层常量 NS（不能引用 createModule 内的 name）
  if (document.querySelector('style[data-plugin-css="' + NS + '"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = NS
  tag.dataset.pluginCss = NS
  tag.textContent = cssText
  document.head.appendChild(tag)
}

let localeCtx = null // apply 时挂上，供 tr() 与组件读取当前 locale
let sessionsSvc = null // apply 时尝试取宿主 sessions 服务（取不到则标题/打开会话功能降级）

