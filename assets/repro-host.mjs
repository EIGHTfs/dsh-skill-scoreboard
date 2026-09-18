/**
 * 生成 assets/repro-host.html —— 用「真实宿主的组件注册语义」渲染 lib/client.js 的诊断页。
 *
 * 与 assets/preview-gen.mjs 的关键差别：
 *   preview-gen.mjs 的 slots 垫片把 register 的第二参当「渲染函数」直接调用（__PAGE_RENDER__()），
 *   而真实宿主把它当 React 组件交给 reconciler 渲染。两种语义不同，
 *   所以 preview 能显示不等于真实宿主能显示。本页复现真实语义：
 *     ReactDOM.createRoot(root).render(React.createElement(RegisteredComponent, null))
 *
 * 若组件在渲染期抛错，错误边界会把堆栈打到页面上，从而暴露「有入口、点进去空白」的真实原因。
 *
 * 用法：node assets/repro-host.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 仓库根 = 本文件所在目录的上一级（换机/换工作区即用；原先写死本机绝对路径）
const WS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = readFileSync(`${WS}/lib/client.js`, 'utf8');
const reactUmd = readFileSync(process.env.REACT_UMD || '/tmp/react_umd.js', 'utf8');
const domUmd = readFileSync(process.env.REACTDOM_UMD || '/tmp/reactdom_umd.js', 'utf8');
const zhDict = readFileSync(`${WS}/lib/i18n/zh.json`, 'utf8');
const enDict = readFileSync(`${WS}/lib/i18n/en.json`, 'utf8');

/* 假数据：字段与真实 /api/skill-scoreboard 逐项一致 */
const SKILLS = [
  ['full-context-read', 18, 18], ['plugin-priority', 14, 15], ['verify-before-diagnose', 13, 13],
  ['bugfix-auto-authority', 12, 12], ['no-guess-on-user-question', 11, 12], ['any-md-is-skill', 10, 10],
  ['skill-repo-index', 9, 9], ['ai-ask-when-unsure', 9, 10], ['commit-push-modified-projects', 8, 8],
  ['release-docs-rule', 7, 7], ['read-before-claim', 7, 8], ['token-budget-guard', 6, 6],
  ['no-silent-truncation', 5, 5], ['audit-before-commit', 5, 6], ['dry-run-first', 4, 4],
  ['atomic-write-data', 4, 4], ['session-title-resolve', 3, 3], ['pager-window', 3, 3],
  ['i18n-external-dict', 2, 2], ['error-boundary', 2, 2], ['css-inject-once', 1, 1],
  ['path-index-ttl', 1, 1],
];
// 演示用假数据：id 存裸串，前缀在下方 map 里拼接（与 preview-gen.mjs 同形）。
//   会话标题刻意用中性词，不引用任何真实会话记录。
const SESSIONS = [
  ['00000001', 12, 9, '文档整理'],
  ['00000002', 9, 7, '界面渲染排查'],
  ['00000003', 7, 6, '插件审计'],
  ['00000004', 5, 5, '发布流程'],
  ['00000005', 3, 3, '模板调整'],
];
const TOTAL = SKILLS.reduce((n, [, c]) => n + c, 0);
const TOTAL_LOADS = SKILLS.reduce((n, [, , l]) => n + l, 0);
const FAKE = {
  ok: true, total: TOTAL, totalLoads: TOTAL_LOADS, recorded: SKILLS.length,
  updatedAt: '2026-09-18T12:00:00.000Z',
  // 展示用假字段：模拟真实接口回传的数据文件路径（不参与读取，故用占位形态而非本机绝对路径）
  dataFile: '<DSH_HOME>/.dsh/skill-scoreboard/skill-usage.json',
  skills: SKILLS.map(([name, count, loads], i) => ({
    name, count, loads, lastUsedAt: `2026-09-${String(18 - (i % 9)).padStart(2, '0')}T10:00:00.000Z`,
  })),
  sessions: SESSIONS.map(([id, loads, distinct, title]) => ({
    id: 'session-' + id, loads, distinct, skills: SKILLS.slice(0, distinct).map(([n]) => n),
    firstUsedAt: '2026-09-10T00:00:00.000Z', lastUsedAt: '2026-09-18T00:00:00.000Z',
    loadsEstimated: false, title,
  })),
};

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>dsh-skill-scoreboard — 真实宿主语义复现页</title>
<style>
body{margin:0;padding:18px;background:#0f1117;color:#e8eaf0;
 font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.banner{max-width:1000px;margin:0 0 14px;padding:10px 12px;border:1px dashed rgba(255,255,255,.18);
 border-radius:10px;color:#a0a6b4;font-size:12px}
.banner b{color:#e8eaf0}
h2{font-size:13px;color:#a0a6b4;font-weight:600;margin:18px 0 6px}
.pane{max-width:1000px;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:12px;margin-bottom:14px}
pre{white-space:pre-wrap;font-size:12px;border:1px solid #f87171;border-radius:8px;padding:10px;color:#f87171;max-width:1000px}
.ok{color:#7ee2b8;font-size:12px;margin-bottom:8px}
</style></head><body>
<div class="banner">
  <b>真实宿主语义复现页</b>：跑真实的 <b>lib/client.js</b>，把 <code>slots.register</code> 的第二参
  <b>当作 React 组件</b>交给 ReactDOM 渲染（preview-gen.mjs 是当普通函数直接调用的，语义不同）。
  若下方 A 区空白且报错区有堆栈，即复现了「有入口、点进去渲染不出来」。
</div>
<h2>A — 插件实际注册的对象（真实宿主会这样渲染）</h2>
<div class="pane"><div id="rootA">（等待渲染…）</div></div>
<h2>B — ui.page 组件本身（宿主标准写法对照）</h2>
<div class="pane"><div id="rootB">（等待渲染…）</div></div>
<h2>捕获到的报错</h2>
<pre id="__err">（暂无）</pre>

<script>${reactUmd}</script>
<script>${domUmd}</script>
<script>
/* 环境准备：client.js 是 classic script，执行时需要 __ModuleLoader__ 已就位 */
window.__CAPTURED__ = null;
window.__ModuleLoader__ = { load: function (m) { window.__CAPTURED__ = m; } };
</script>
<script>${clientSrc}</script>
<script>
window.__ERRORS__ = [];
function __err(kind, msg) {
  window.__ERRORS__.push(kind + ': ' + msg);
  var d = document.getElementById('__err');
  if (d) d.textContent = window.__ERRORS__.join('\\n\\n');
}
window.addEventListener('error', function (e) { __err('window.onerror', e.message + '\\n' + ((e.error && e.error.stack) || '')); });
window.addEventListener('unhandledrejection', function (e) { __err('unhandledrejection', String((e.reason && e.reason.stack) || e.reason)); });

window.__FAKE__ = ${JSON.stringify(FAKE)};

window.__requireShim = function (name) {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement };
  if (name === './i18n/zh.json') return ${zhDict};
  if (name === './i18n/en.json') return ${enDict};
  throw new Error('client-modules: require("' + name + '") missed the module table');
};

window.__localeMock = {
  getLocale: function () { return 'zh'; },
  subscribe: function () { return function () {}; },
  register: function () { return function () {}; },
};
window.__sessionsMock = {
  list: { getSnapshot: function () { return { byId: {} }; } },
  open: function () { return true; },
};
window.__REGISTERED__ = null;
window.__UI__ = null;
window.__slotsMock = {
  inject: function (name, fn) { fn(); },
  register: function (spec, component) {
    if (spec && spec.id === 'skill-scoreboard') window.__REGISTERED__ = component;
    return function () {};
  },
};
window.__ctxMock = {
  effect: function () { return function () {}; },
  get: function (name) {
    if (name === 'slots') return window.__slotsMock;
    if (name === 'sessions') return window.__sessionsMock;
    return undefined;
  },
  locale: window.__localeMock,
};

window.fetch = function (url) {
  var u = String(url);
  var json = function (body) {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
  };
  if (u.indexOf('/api/skill-scoreboard/i18n') >= 0) {
    return json({ ok: true, zh: ${zhDict}, en: ${enDict} });
  }
  if (u.indexOf('/api/skill-scoreboard/export') >= 0) {
    return Promise.resolve({ ok: true, status: 200, blob: function () { return Promise.resolve(new Blob([JSON.stringify(window.__FAKE__, null, 1)], { type: 'application/json' })); } });
  }
  if (u.indexOf('/api/skill-scoreboard') >= 0) return json(window.__FAKE__);
  return json({ ok: true });
};

(function () {
  try {
    var mod = window.__CAPTURED__.factory(window.__requireShim);
    mod.apply(window.__ctxMock);
    var A = window.__REGISTERED__;
    if (!A) { __err('harness', 'settings.section 未注册（apply 未走到 register）'); return; }

    function Boundary(props) {
      try {
        return React.createElement(props.comp, null);
      } catch (e) {
        __err('render', (e && e.stack) || e.message);
        return React.createElement('div', { style: { color: '#f87171' } }, '渲染失败：' + e.message);
      }
    }

    function mount(id, comp, tag) {
      var host = document.getElementById(id);
      try {
        ReactDOM.flushSync(function () {
          ReactDOM.createRoot(host).render(React.createElement(Boundary, { comp: comp }));
        });
        setTimeout(function () {
          var txt = host.textContent || '';
          if (txt.replace(/\\s/g, '') === '' || txt.indexOf('等待渲染') >= 0) {
            __err(tag, '渲染后容器为空或仅占位（组件未产出内容）');
          } else {
            var t = document.createElement('div');
            t.className = 'ok';
            t.textContent = tag + '：已渲染 ' + txt.length + ' 字符';
            host.insertBefore(t, host.firstChild);
          }
        }, 400);
      } catch (e) {
        __err(tag, (e && e.stack) || e.message);
      }
    }
    mount('rootA', A, 'A(插件实际注册对象)');
  } catch (e) {
    __err('harness', (e && e.stack) || String(e));
  }
})();
</script>
</body></html>
`;
writeFileSync(`${WS}/assets/repro-host.html`, html, 'utf8');
console.log('已生成 assets/repro-host.html', html.length, '字节');
