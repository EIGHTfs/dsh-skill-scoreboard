/** dsh-skip-sensitive dsh-skill-scoreboard v1.6.0 单测：两种记分 + 设置页 API + 注入路径兜底 + 导入导出 + mkdir */
import { apply, name, buildScoreboardInjection, normalizeScoreboardPayload, mergeScoreboard, ensureDataDir, resolveSkillPath } from './lib/index.js';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const root = mkdtempSync(join(tmpdir(), 'skill-scoreboard-'));
const dataFile = join(root, 'skill-usage.json');

try {
  const handlers = {};
  let injectCb = null;
  let registered = null;
  const routes = {};
  const webServerMock = { register: (r) => { registered = r; if (r?.path) routes[r.path] = r; } };
  const ctx = {
    on: (evt, fn) => { handlers[evt] = fn; },
    effect: () => () => {},
    inject: (_deps, cb) => { injectCb = cb; },
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  };

  ok(name === 'dsh-skill-scoreboard', '插件名');

  await apply(ctx, { enabled: true, dataFile });
  ok(typeof handlers['tools/result'] === 'function', '已监听 tools/result');
  await injectCb({ get: (n) => (n === 'webServer' ? webServerMock : null) });
  ok(registered && routes['/api/skill-scoreboard'] && routes['/api/skill-scoreboard'].kind === 'exact', '已注册 GET /api/skill-scoreboard');
  ok(routes['/api/skill-scoreboard/export'] && routes['/api/skill-scoreboard/import'], '已注册 export/import');

  // ---- 记分去重 ----
  const exec = (n, args, sessionId, callId, isError = false) => ({
    name: n,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
    agent: { session: { id: sessionId } },
    callId,
    ...(isError ? { isError: true } : {}),
  });
  const result = { isError: false };

  handlers['tools/result'](exec('skill', { name: 'foo-skill' }, 's1', 'c1'), result);
  handlers['tools/result'](exec('skill', { name: 'foo-skill' }, 's1', 'c2'), result); // 同 session 第二次
  handlers['tools/result'](exec('skill', { name: 'foo-skill' }, 's2', 'c3'), result); // 新 session
  handlers['tools/result'](exec('skill', { name: 'bar-skill' }, 's2', 'c4'), result);
  handlers['tools/result'](exec('git_scan', { name: 'x' }, 's1', 'c5'), result); // 非 skill 工具
  handlers['tools/result'](exec('skill', { name: 'err-skill' }, 's1', 'c6', true), { isError: true }); // isError 不计
  await sleep(120);

  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  ok(data.skills['foo-skill']?.count === 2, `foo-skill 会话去重 2 次（实际 ${data.skills['foo-skill']?.count}）`);
  ok(data.skills['foo-skill']?.loads === 3, `foo-skill 每次加载 3 次（实际 ${data.skills['foo-skill']?.loads}）`);
  ok(data.skills['foo-skill']?.sessions?.length === 2, 'foo-skill 记 2 个会话');
  ok(data.skills['bar-skill']?.count === 1 && data.skills['bar-skill']?.loads === 1, 'bar-skill 会话去重/加载各 1 次');
  ok(!data.skills['x'], '非 skill 工具不计分');
  ok(!data.skills['err-skill'], 'isError 结果不计分');

  // ---- 设置页 API 输出 ----
  let apiBody = null;
  const mockRes = {
    writeHead: (status, h) => { apiStatus = status; apiHeaders = h; },
    end: (s) => { apiBody = JSON.parse(s); },
  };
  let apiStatus = 0; let apiHeaders = null;
  await routes['/api/skill-scoreboard'].handler({ method: 'GET', url: '/api/skill-scoreboard' }, mockRes);
  ok(apiStatus === 200 && apiHeaders['Content-Type']?.includes('application/json'), 'API 返回 JSON 200');
  ok(apiBody.ok === true && apiBody.total === 3 && apiBody.totalLoads === 4, `API total=3 totalLoads=4（实际 ${apiBody.total}/${apiBody.totalLoads}）`);
  ok(apiBody.skills.length === 2 && apiBody.skills[0].name === 'foo-skill' && apiBody.skills[0].count === 2 && apiBody.skills[0].loads === 3, 'API 按会话去重降序且首条 foo-skill 含 loads');
  ok(apiBody.skills.every((s) => typeof s.lastUsedAt === 'string' || s.lastUsedAt === null), 'lastUsedAt 字段');
  ok(typeof apiBody.updatedAt === 'string' || apiBody.updatedAt === null, 'updatedAt 字段');

  // 非 GET → 405
  await routes['/api/skill-scoreboard'].handler({ method: 'POST', url: '/' }, mockRes);
  ok(apiStatus === 405, '非 GET 返回 405');

  // ---- v1.4.0 注入文本 ----
  const injection = await buildScoreboardInjection({
    file: dataFile,
    topN: 25,
    skillsSvc: {
      get: async (n) => (n === 'foo-skill' ? { path: '/tmp/skills/foo-skill.md' } : undefined),
    },
  });
  ok(injection.includes('【dsh-skill-scoreboard 注入：skill 使用记分榜】'), '注入带标题');
  ok(injection.includes('foo-skill') && injection.includes('bar-skill'), '注入包含全部 skill 名');
  ok(injection.includes('/tmp/skills/foo-skill.md'), '注入包含 skill 实际路径');
  ok(injection.includes('会话去重 ×2') && injection.includes('加载 ×3'), '注入同时带两种次数');
  ok(injection.indexOf('foo-skill') < injection.indexOf('bar-skill'), '注入按次数降序');
  ok(injection.includes('共 2 个 skill') && injection.includes('会话去重累计 3 次') && injection.includes('加载累计 4 次'), '注入带两种总数');
  ok(injection.includes('完整榜单见 设置'), '注入带 UI 指引');
  const emptyInj = await buildScoreboardInjection({ file: join(root, 'no-such.json'), topN: 25 });
  ok(emptyInj === '', '无记录返回空串');

  const viaResourceBase = await resolveSkillPath('foo-skill', {
    get: async () => ({ resourceBase: { kind: 'directory', path: '/tmp/skills' } }),
  });
  ok(viaResourceBase === '/tmp/skills' || viaResourceBase.endsWith('foo-skill.md') || viaResourceBase === '/tmp/skills', `resourceBase 兜底路径（实际 ${viaResourceBase}）`);
  const noPathInj = await buildScoreboardInjection({
    file: dataFile,
    topN: 1,
    skillsSvc: { get: async () => ({}) },
  });
  ok(noPathInj.includes('→ '), 'skills.get 无 path 时注入仍带路径位（扫描或未找到提示）');

  // ---- 导入导出 / 规范化 ----
  const norm = normalizeScoreboardPayload({ version: 9, skills: { 'a-skill': { count: '3', lastUsedAt: '2026-01-01T00:00:00.000Z', sessions: ['s'] } } });
  ok(norm.version === 1 && norm.skills['a-skill'].count === 3, 'normalize 把 version/count 收成标准结构');
  const merged = mergeScoreboard({ skills: { 'a-skill': { count: 2, sessions: ['s0'], callIds: [], lastUsedAt: '2025-01-01T00:00:00.000Z' } } }, norm);
  ok(merged.skills['a-skill'].count === 5 && merged.skills['a-skill'].sessions.includes('s') && merged.skills['a-skill'].sessions.includes('s0'), 'merge 累加次数并合并会话');

  let exportBody = '';
  const exportRes = { writeHead: (status, h) => { apiStatus = status; apiHeaders = h; }, end: (s) => { exportBody = s; } };
  await routes['/api/skill-scoreboard/export'].handler({ method: 'GET', url: '/api/skill-scoreboard/export' }, exportRes);
  const exported = JSON.parse(exportBody);
  ok(apiStatus === 200 && exported.skills['foo-skill']?.count === 2 && exported.exportedAt, 'export 返回完整记分 JSON');

  const nestedFile = join(root, 'nested', 'deep', 'skill-usage.json');
  await ensureDataDir(nestedFile);
  ok(existsSync(join(root, 'nested', 'deep')), 'ensureDataDir 路径不存在则创建');

  const importChunks = [];
  const importReq = {
    method: 'POST',
    url: '/api/skill-scoreboard/import?merge=false',
    on: (evt, fn) => {
      if (evt === 'data') setTimeout(() => fn(Buffer.from(JSON.stringify({ version: 1, skills: { 'imported-skill': { count: 7 } } }))), 0);
      if (evt === 'end') setTimeout(() => fn(), 5);
      if (evt === 'error') importChunks.push(fn);
    },
    destroy: () => {},
  };
  let importStatus = 0; let importBody = null;
  const importRes = { writeHead: (s) => { importStatus = s; }, end: (s) => { importBody = JSON.parse(s); } };
  await routes['/api/skill-scoreboard/import'].handler(importReq, importRes);
  await sleep(40);
  ok(importStatus === 200 && importBody?.ok === true && importBody.merge === false && importBody.recorded === 1, `import 替换成功 recorded=${importBody?.recorded}`);
  const afterImport = JSON.parse(readFileSync(dataFile, 'utf8'));
  ok(afterImport.skills['imported-skill']?.count === 7 && !afterImport.skills['foo-skill'], 'import merge=false 整表替换');

  // ---- 损坏数据文件不崩 ----
  writeFileSync(dataFile, '{broken', 'utf8');
  await routes['/api/skill-scoreboard'].handler({ method: 'GET', url: '/' }, mockRes);
  ok(apiStatus === 200 && apiBody.ok === true && apiBody.total === 0, '损坏数据文件回退空表（total=0）不崩');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);