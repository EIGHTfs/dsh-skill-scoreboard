/** dsh-skill-scoreboard v1.8.0 单测：两种记分 + 会话表 + v1→v2 迁移 + 设置页 API + 注入路径兜底 + 导入导出 + mkdir */
import {
  apply, name, buildScoreboardInjection, normalizeScoreboardPayload, mergeScoreboard,
  ensureDataDir, resolveSkillPath, migrateToV2, deriveSessionsFromSkills,
} from './lib/index.js';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };
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

  let data = JSON.parse(readFileSync(dataFile, 'utf8'));
  ok(data.version === 2, `数据文件为 v2（实际 ${data.version}）`);
  ok(data.skills['foo-skill']?.count === 2, `foo-skill 会话去重 2 次（实际 ${data.skills['foo-skill']?.count}）`);
  ok(data.skills['foo-skill']?.loads === 3, `foo-skill 每次加载 3 次（实际 ${data.skills['foo-skill']?.loads}）`);
  ok(data.skills['foo-skill']?.sessions?.length === 2, 'foo-skill 记 2 个会话');
  ok(data.skills['bar-skill']?.count === 1 && data.skills['bar-skill']?.loads === 1, 'bar-skill 会话去重/加载各 1 次');
  ok(!data.skills['x'], '非 skill 工具不计分');
  ok(!data.skills['err-skill'], 'isError 结果不计分');

  // ---- v1.8.0 会话表 ----
  ok(!!data.sessions && typeof data.sessions === 'object', '写入顶层 sessions 会话表');
  ok(data.sessions['s1']?.loads === 2 && data.sessions['s1']?.distinct === 1, `s1 会话 loads=2 distinct=1（实际 ${data.sessions['s1']?.loads}/${data.sessions['s1']?.distinct}）`);
  ok(data.sessions['s1']?.skills?.['foo-skill'] === 2, 's1 会话记录 foo-skill 加载 2 次');
  ok(data.sessions['s2']?.loads === 2 && data.sessions['s2']?.distinct === 2, 's2 会话 loads=2 distinct=2');
  ok(typeof data.sessions['s2']?.firstUsedAt === 'string' && typeof data.sessions['s2']?.lastUsedAt === 'string', '会话表带 firstUsedAt/lastUsedAt');
  ok(!('err-skill' in (data.sessions['s1']?.skills || {})), 'isError 的调用不进会话表');
  // callId 去重：同 callId 再来一次不应重复计
  handlers['tools/result'](exec('skill', { name: 'foo-skill' }, 's1', 'c1'), result);
  await sleep(120);
  data = JSON.parse(readFileSync(dataFile, 'utf8'));
  ok(data.sessions['s1']?.loads === 2, `callId 重复调用不再累计会话（实际 ${data.sessions['s1']?.loads}）`);

  // ---- 设置页 API 输出 ----
  let apiBody = null;
  let apiStatus = 0; let apiHeaders = null;
  const mockRes = {
    writeHead: (status, h) => { apiStatus = status; apiHeaders = h; },
    end: (s) => { apiBody = JSON.parse(s); },
  };
  await routes['/api/skill-scoreboard'].handler({ method: 'GET', url: '/api/skill-scoreboard' }, mockRes);
  ok(apiStatus === 200 && apiHeaders['Content-Type']?.includes('application/json'), 'API 返回 JSON 200');
  ok(apiBody.ok === true && apiBody.total === 3 && apiBody.totalLoads === 4, `API total=3 totalLoads=4（实际 ${apiBody.total}/${apiBody.totalLoads}）`);
  ok(apiBody.skills.length === 2 && apiBody.skills[0].name === 'foo-skill' && apiBody.skills[0].count === 2 && apiBody.skills[0].loads === 3, 'API 按会话去重降序且首条 foo-skill 含 loads');
  ok(apiBody.skills.every((s) => typeof s.lastUsedAt === 'string' || s.lastUsedAt === null), 'lastUsedAt 字段');
  ok(typeof apiBody.updatedAt === 'string' || apiBody.updatedAt === null, 'updatedAt 字段');
  // v1.8.0：会话榜
  ok(Array.isArray(apiBody.sessions) && apiBody.sessions.length === 2, `API 返回会话榜（实际 ${apiBody.sessions?.length}）`);
  ok(apiBody.sessions[0].id === 's1' || apiBody.sessions[0].id === 's2', '会话榜含会话 id');
  ok(apiBody.sessions.every((s) => typeof s.distinct === 'number' && typeof s.loads === 'number' && Array.isArray(s.skills)), '会话榜字段齐全（distinct/loads/skills）');
  ok(apiBody.sessions[0].distinct >= apiBody.sessions[1].distinct, '会话榜按 distinct 降序');
  ok(typeof apiBody.dataFile === 'string' && apiBody.dataFile.endsWith('skill-usage.json'), 'API 返回 dataFile 供管理页展示');

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
  ok(injection.includes('三个选项卡'), '注入指引提到三选项卡（v1.8.0）');
  const emptyInj = await buildScoreboardInjection({ file: join(root, 'no-such.json'), topN: 25 });
  ok(emptyInj === '', '无记录返回空串');

  const viaResourceBase = await resolveSkillPath('foo-skill', {
    get: async () => ({ resourceBase: { kind: 'directory', path: '/tmp/skills' } }),
  });
  ok(viaResourceBase === '/tmp/skills' || viaResourceBase.endsWith('foo-skill.md'), `resourceBase 兜底路径（实际 ${viaResourceBase}）`);
  const noPathInj = await buildScoreboardInjection({
    file: dataFile,
    topN: 1,
    skillsSvc: { get: async () => ({}) },
  });
  ok(noPathInj.includes('→ '), 'skills.get 无 path 时注入仍带路径位（扫描或未找到提示）');

  // ---- v1 → v2 迁移 ----
  const v1 = {
    version: 1,
    skills: {
      'a-skill': { count: 2, loads: 4, lastUsedAt: '2026-01-02T00:00:00.000Z', sessions: ['sX', 'sY'], callIds: ['k1'] },
      'b-skill': { count: 1, loads: 1, lastUsedAt: '2026-01-01T00:00:00.000Z', sessions: ['sX'], callIds: [] },
    },
  };
  const migrated = migrateToV2(v1);
  ok(migrated.version === 2, 'migrateToV2 输出 v2');
  ok(Object.keys(migrated.sessions).length === 2, '迁移反推出 2 个会话');
  ok(migrated.sessions['sX'].distinct === 2 && migrated.sessions['sX'].skills['a-skill'] === 1 && migrated.sessions['sX'].skills['b-skill'] === 1, 'sX 会话含 2 个 skill');
  ok(migrated.sessions['sX'].loadsEstimated === true, '迁移会话标记 loadsEstimated（估计值）');
  ok(migrated.sessions['sX'].firstUsedAt === '2026-01-01T00:00:00.000Z', '迁移取最早时间作 firstUsedAt');
  ok(migrated.skills['a-skill'].count === 2 && migrated.skills['a-skill'].loads === 4, '迁移保留 skill 原始次数');
  const alreadyV2 = migrateToV2(migrated);
  ok(alreadyV2.version === 2 && Object.keys(alreadyV2.sessions).length === 2, 'v2 输入原样（幂等）');
  const derived = deriveSessionsFromSkills({ 'c-skill': { sessions: ['s1', 's1', 's2'], lastUsedAt: '2026-02-01T00:00:00.000Z' } });
  ok(derived['s1'].loads === 1, 'derive 对同一会话内重复 sid 只记 1（v1 只存去重列表）');
  // 启动即迁移：写一份 v1 文件给第二个插件实例读
  const v1File = join(root, 'v1-skill-usage.json');
  writeFileSync(v1File, JSON.stringify(v1), 'utf8');
  const h2 = {}; let inj2 = null;
  await apply({ on: (e, f) => { h2[e] = f; }, effect: () => () => {}, inject: (_d, cb) => { inj2 = cb; }, logger: () => ({}) }, { enabled: true, dataFile: v1File });
  const routes2 = {};
  await inj2({ get: (n) => (n === 'webServer' ? { register: (r) => { if (r?.path) routes2[r.path] = r; } } : null) });
  let body2 = null;
  await routes2['/api/skill-scoreboard'].handler({ method: 'GET', url: '/' }, { writeHead: () => {}, end: (s) => { body2 = JSON.parse(s); } });
  ok(Array.isArray(body2.sessions) && body2.sessions.length === 2, 'v1 旧文件启动后 API 也能给出会话榜');
  h2['tools/result'](exec('skill', { name: 'a-skill' }, 'sZ', 'k9'), result);
  await sleep(120);
  const afterWrite = JSON.parse(readFileSync(v1File, 'utf8'));
  ok(afterWrite.version === 2 && afterWrite.sessions['sZ']?.loads === 1, 'v1 文件被记分后落盘为 v2 并带新会话');

  // ---- 导入导出 / 规范化 ----
  const norm = normalizeScoreboardPayload({ version: 9, skills: { 'a-skill': { count: '3', lastUsedAt: '2026-01-01T00:00:00.000Z', sessions: ['s'] } } });
  ok(norm.version === 2 && norm.skills['a-skill'].count === 3, 'normalize 把 version/count 收成标准 v2 结构');
  ok(norm.sessions['s']?.skills?.['a-skill'] === 1, 'normalize 对无 sessions 的 v1 体反推会话表');
  const normV2 = normalizeScoreboardPayload({
    version: 2,
    skills: { 'a-skill': { count: 1, loads: 2, sessions: ['s1'] } },
    sessions: { s1: { loads: 2, distinct: 1, skills: { 'a-skill': 2 }, firstUsedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: '2026-01-02T00:00:00.000Z' } },
  });
  ok(normV2.sessions['s1'].loads === 2 && normV2.sessions['s1'].distinct === 1, 'normalize 读取导入体自带的 sessions');
  const merged = mergeScoreboard({ skills: { 'a-skill': { count: 2, sessions: ['s0'], callIds: [], lastUsedAt: '2025-01-01T00:00:00.000Z' } } }, norm);
  ok(merged.skills['a-skill'].count === 5 && merged.skills['a-skill'].sessions.includes('s') && merged.skills['a-skill'].sessions.includes('s0'), 'merge 累加次数并合并会话');
  const mergedSessions = mergeScoreboard(
    { skills: {}, sessions: { s1: { loads: 2, skills: { 'a': 2 }, firstUsedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: '2026-01-05T00:00:00.000Z' } } },
    { skills: {}, sessions: { s1: { loads: 1, skills: { 'a': 1, 'b': 1 }, firstUsedAt: '2026-01-03T00:00:00.000Z', lastUsedAt: '2026-01-06T00:00:00.000Z' } } },
  );
  ok(mergedSessions.sessions.s1.loads === 3 && mergedSessions.sessions.s1.distinct === 2, 'merge 合并会话表（loads 相加、distinct 重算）');
  ok(mergedSessions.sessions.s1.skills.a === 3 && mergedSessions.sessions.s1.skills.b === 1, 'merge 合并会话内 skill 次数');
  ok(mergedSessions.sessions.s1.firstUsedAt === '2026-01-01T00:00:00.000Z' && mergedSessions.sessions.s1.lastUsedAt === '2026-01-06T00:00:00.000Z', 'merge 会话时间取最早/最晚');

  let exportBody = '';
  const exportRes = { writeHead: (status, h) => { apiStatus = status; apiHeaders = h; }, end: (s) => { exportBody = s; } };
  await routes['/api/skill-scoreboard/export'].handler({ method: 'GET', url: '/api/skill-scoreboard/export' }, exportRes);
  const exported = JSON.parse(exportBody);
  ok(apiStatus === 200 && exported.skills['foo-skill']?.count === 2 && exported.exportedAt, 'export 返回完整记分 JSON');
  ok(exported.version === 2 && exported.sessions && exported.sessions['s1']?.loads === 2, 'export 带 v2 版本号与会话表');

  const nestedFile = join(root, 'nested', 'deep', 'skill-usage.json');
  await ensureDataDir(nestedFile);
  ok(existsSync(join(root, 'nested', 'deep')), 'ensureDataDir 路径不存在则创建');

  const importReq = {
    method: 'POST',
    url: '/api/skill-scoreboard/import?merge=false',
    on: (evt, fn) => {
      if (evt === 'data') setTimeout(() => fn(Buffer.from(JSON.stringify({ version: 1, skills: { 'imported-skill': { count: 7, sessions: ['sImp'] } } }))), 0);
      if (evt === 'end') setTimeout(() => fn(), 5);
    },
  };
  let importStatus = 0; let importBody = null;
  const importRes = { writeHead: (s) => { importStatus = s; }, end: (s) => { importBody = JSON.parse(s); } };
  await routes['/api/skill-scoreboard/import'].handler(importReq, importRes);
  await sleep(40);
  ok(importStatus === 200 && importBody?.ok === true && importBody.merge === false && importBody.recorded === 1, `import 替换成功 recorded=${importBody?.recorded}`);
  const afterImport = JSON.parse(readFileSync(dataFile, 'utf8'));
  ok(afterImport.skills['imported-skill']?.count === 7 && !afterImport.skills['foo-skill'], 'import merge=false 整表替换');
  ok(afterImport.sessions['sImp']?.skills?.['imported-skill'] === 1, 'import v1 体自动补会话表');

  // ---- 损坏数据文件不崩 ----
  writeFileSync(dataFile, '{broken', 'utf8');
  await routes['/api/skill-scoreboard'].handler({ method: 'GET', url: '/' }, mockRes);
  ok(apiStatus === 200 && apiBody.ok === true && apiBody.total === 0 && Array.isArray(apiBody.sessions), '损坏数据文件回退空表（total=0、sessions=[]）不崩');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
