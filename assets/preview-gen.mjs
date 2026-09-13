/**
 * 生成 assets/preview.html —— 记分板页面模拟预览（假数据、全部可点）。
 *
 * 跑的是仓库里真实的 lib/client.js（不是手抄 mockup），只垫片宿主环境，所以界面与真实插件一致，
 * 且能发现真实渲染/交互缺陷。生成物单文件自包含（内联 React UMD），双击即开、离线可用。
 *
 * 垫片的宿主面（与真实宿主同名同形）：
 *   window.__ModuleLoader__.load  客户端模块装载（lib/client.js 是 classic script）
 *   require                       react + 两份 i18n 字典（宿主 require 原生支持 JSON）
 *   ctx.locale                    getLocale / subscribe / register
 *   ctx.get('slots')              slots.inject + slots.register（settings.section 列表槽）
 *   ctx.get('sessions')           宿主会话服务（标题解析与「打开会话」）
 *   ctx.effect                    生命周期登记（预览里为空实现）
 *   fetch                         /api/skill-scoreboard（假数据）+ 导入导出
 *
 * 用法：node assets/preview-gen.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DSH = '/vol2/1000/DeepSeek Harness/dsh-v0.1.2-alpha.4';
const P = `${DSH}/.dsh-home/工作区/dsh-skill-scoreboard`;
const R = `${DSH}/node_modules/.pnpm/react@18.3.1/node_modules/react`;
const RD = `${DSH}/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom`;

const clientSrc = readFileSync(`${P}/lib/client.js`, 'utf8');
const reactUmd = readFileSync(`${R}/umd/react.development.js`, 'utf8');
const domUmd = readFileSync(`${RD}/umd/react-dom.development.js`, 'utf8');
const zhDict = readFileSync(`${P}/lib/i18n/zh.json`, 'utf8');
const enDict = readFileSync(`${P}/lib/i18n/en.json`, 'utf8');

/* ───────────── 假数据：/api/skill-scoreboard 的响应体（字段与真实接口逐项一致） ─────────────
 * 真实字段见 lib/client.js 的 snapshotToState：skills[{name,count,loads,lastUsedAt}]、
 * sessions[{id,loads,distinct,skills,firstUsedAt,lastUsedAt,loadsEstimated,title}]、
 * total/totalLoads/recorded/updatedAt/dataFile。
 * 行数刻意超过每页 20 条（PAGE_SIZE_DEFAULT）以展示分页控件。
 */
const SKILLS = [
  ['full-context-read', 18, 18], ['plugin-priority', 14, 15], ['verify-before-diagnose', 13, 13],
  ['bugfix-auto-authority', 12, 12], ['no-guess-on-user-question', 11, 12], ['any-md-is-skill', 10, 10],
  ['skill-repo-index', 9, 9], ['ai-ask-when-unsure', 9, 10], ['commit-push-modified-projects', 8, 8],
  ['chinese-think-and-output', 8, 8], ['ask-with-options', 7, 7], ['task-completion-report', 7, 8],
  ['safe-delete-trash', 6, 6], ['python-fileinput-write', 6, 6], ['skill-classification', 5, 5],
  ['proactive-self-review', 5, 5], ['frontend-render-selfcheck', 4, 4], ['code-truth-over-md', 4, 5],
  ['no-refresh-as-fix', 3, 3], ['single-line-output-rule', 3, 3], ['host-address-convention', 2, 2],
  ['dev-doc-archive-shorthand', 2, 2], ['skill-cite-sources', 1, 1], ['url-verify-before-write', 1, 1],
];

const SESSIONS = [
  ['a1b2c3d4-1111-4a2b-9c3d-000000000001', '插件截图与榜单收录', 9, 8, 21],
  ['a1b2c3d4-2222-4a2b-9c3d-000000000002', '审计规则包命中数修正', 7, 7, 19],
  ['a1b2c3d4-3333-4a2b-9c3d-000000000003', '推送通道改为 SSH', 6, 5, 15],
  ['a1b2c3d4-4444-4a2b-9c3d-000000000004', '记分板页面改版', 5, 5, 12],
  ['a1b2c3d4-5555-4a2b-9c3d-000000000005', '预览页渲染自检', 4, 3, 9],
  ['a1b2c3d4-6666-4a2b-9c3d-000000000006', 'skill 字典迁移', 3, 3, 6],
  ['a1b2c3d4-7777-4a2b-9c3d-000000000007', '导入导出联调', 2, 2, 4],
];

const TOTAL = SKILLS.reduce((n, [, count]) => n + count, 0);
const TOTAL_LOADS = SKILLS.reduce((n, [, , loads]) => n + loads, 0);

const FAKE = {
  ok: true,
  total: TOTAL,
  totalLoads: TOTAL_LOADS,
  recorded: SKILLS.length,
  updatedAt: '2026-09-13T04:12:08.000Z',
  dataFile: '<DSH 数据目录>/skill-scoreboard/skill-usage.json',
  skills: SKILLS.map(([name, count, loads], i) => ({
    name,
    count,
    loads,
    lastUsedAt: new Date(Date.UTC(2026, 8, 13, 3, 58 - i * 3, 20)).toISOString(),
  })),
  sessions: SESSIONS.map(([id, title, loads, distinct, hour]) => ({
    id: 'session-' + id,
    loads,
    distinct,
    skills: SKILLS.slice(0, distinct).map((s) => s[0]),
    firstUsedAt: new Date(Date.UTC(2026, 8, 12, 20, 10, 0)).toISOString(),
    lastUsedAt: new Date(Date.UTC(2026, 8, 13, hour, 24, 9)).toISOString(),
    loadsEstimated: false,
    title,
  })),
};

const harness = `
window.__ERRORS__ = [];
function __err(kind, msg) {
  window.__ERRORS__.push(kind + ': ' + msg);
  var d = document.getElementById('__err');
  if (!d) { d = document.createElement('pre'); d.id = '__err'; d.style.cssText = 'color:#f87171;white-space:pre-wrap;font-size:12px;border:1px solid #f87171;padding:8px;margin:0 0 12px'; document.body.insertBefore(d, document.body.firstChild); }
  d.textContent += kind + ': ' + msg + String.fromCharCode(10);
}
window.addEventListener('error', function (e) { __err('error', e.message); });
window.addEventListener('unhandledrejection', function (e) { __err('reject', String((e.reason && e.reason.stack) || e.reason)); });
var __oerr = console.error;
console.error = function () { __err('console', Array.prototype.map.call(arguments, function (x) { return String((x && x.stack) || x); }).join(' ')); __oerr.apply(console, arguments); };

window.__FAKE__ = ${JSON.stringify(FAKE)};
window.__CAPTURED__ = null;
window.__ModuleLoader__ = { load: function (m) { window.__CAPTURED__ = m; } };

// 宿主 require：react + 两份 i18n 字典（真实宿主对 JSON 原生支持）
window.__requireShim = function (name) {
  if (name === 'react') return React;
  if (name === './i18n/zh.json') return ${zhDict};
  if (name === './i18n/en.json') return ${enDict};
  throw new Error('未垫片的 require: ' + name);
};

// 宿主 locale 服务：getLocale 决定 tr() 走 zh 还是 en
window.__localeMock = {
  getLocale: function () { return window.__LOCALE__ || { id: 'zh' }; },
  subscribe: function () { return function () {}; },
  register: function () { return function () {}; },
};

// 宿主 sessions 服务：列表快照供标题解析，open 供「打开会话」
window.__sessionsMock = {
  list: function () { return window.__FAKE__.sessions.map(function (s) { return { id: s.id, displayTitle: s.title }; }); },
  open: function (id) { window.__OPENED__ = id; return true; },
};

// 宿主 slots：settings.section 列表槽，register 收到渲染函数
window.__slotsMock = {
  inject: function (name, fn) { window.__INJECTED_NAME__ = name; fn(); },
  register: function (spec, render) { window.__PAGE_RENDER__ = render; return spec; },
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

// 假接口：GET /api/skill-scoreboard 返回假快照；导出返回 blob；导入返回成功
window.fetch = function (url, init) {
  var u = String(url);
  var json = function (body) {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
  };
  if (u.indexOf('/api/skill-scoreboard/export') >= 0) {
    return Promise.resolve({ ok: true, status: 200, blob: function () { return Promise.resolve(new Blob([JSON.stringify(window.__FAKE__, null, 1)], { type: 'application/json' })); } });
  }
  if (u.indexOf('/api/skill-scoreboard/import') >= 0) {
    window.__IMPORTED__ = true;
    return json({ ok: true, added: 3, total: window.__FAKE__.total + 3 });
  }
  if (u.indexOf('/api/skill-scoreboard') >= 0) return json(window.__FAKE__);
  return json({ ok: true });
};
`;

const post = `
try {
  var mod = window.__CAPTURED__.factory(window.__requireShim);
  window.__CAPTURED__ = null;
  mod.apply(window.__ctxMock);
  if (!window.__PAGE_RENDER__) throw new Error('settings.section 未注册渲染函数');
  ReactDOM.flushSync(function () {
    ReactDOM.createRoot(document.getElementById('root')).render(
      React.createElement(function () {
        var el = window.__PAGE_RENDER__();
        return el || React.createElement('div', null, '（无内容）');
      }, null)
    );
  });
  window.__ready = true;
} catch (e) {
  __err('harness', (e && e.message) || String(e));
}
`;

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>dsh-skill-scoreboard 界面模拟预览</title>
<style>
body{margin:0;padding:20px;background:#0f1117;color:#e8eaf0;
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.banner{max-width:900px;margin:0 0 14px;padding:10px 12px;border:1px dashed rgba(255,255,255,.18);
  border-radius:10px;color:#a0a6b4;font-size:12px}
.banner b{color:#e8eaf0}
#root{max-width:900px}
#__err{max-width:900px}
</style></head><body>
<div class="banner">这是<b>模拟预览</b>（假数据）：跑的是仓库里真实的 <b>lib/client.js</b>，只垫片了宿主环境
（ModuleLoader / require / locale / slots / sessions / fetch）。三个选项卡、分页、会话展开、导入导出都可点，改动只留在页面内，不写任何文件。</div>
<div id="root"></div>
<script>${reactUmd}</script>
<script>${domUmd}</script>
<script>${harness}</script>
<script>${clientSrc}</script>
<script>${post}</script>
</body></html>`;

writeFileSync(`${P}/assets/preview.html`, html);
console.log('生成 assets/preview.html', (html.length / 1048576).toFixed(2), 'MB');
