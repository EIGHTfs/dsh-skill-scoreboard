/** dsh-skip-sensitive dsh-skill-scoreboard v1.5.0 单测：tools/result 双计数记分（会话去重 + 每次都算）+ 设置页 API + 注入文本（mock ctx + 临时数据文件） */
import { apply, name, buildScoreboardInjection } from './lib/index.js';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
  const regs = [];
  const webServerMock = { register: (r) => { regs.push(r); } };
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
  const scoreboardReg = regs.find((r) => r.path === '/api/skill-scoreboard' && r.kind === 'exact');
  ok(scoreboardReg && typeof scoreboardReg.handler === 'function', '已注册 GET /api/skill-scoreboard');

  // ---- 双计数记分 ----
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
  await sleep(150);

  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  ok(data.skills['foo-skill']?.count === 2, `foo-skill 会话去重 2 次（实际 ${data.skills['foo-skill']?.count}）`);
  ok(data.skills['foo-skill']?.alwaysCount === 3, `foo-skill 每次都算 3 次（实际 ${data.skills['foo-skill']?.alwaysCount}）——双计数并行`);
  ok(data.skills['foo-skill']?.sessions?.length === 2, 'foo-skill 记 2 个会话');
  ok(data.skills['bar-skill']?.count === 1 && data.skills['bar-skill']?.alwaysCount === 1, 'bar-skill 双计数均 1');
  ok(!data.skills['x'], '非 skill 工具不计分');
  ok(!data.skills['err-skill'], 'isError 结果不计分');

  // ---- 设置页 API 输出（双计数） ----
  let apiStatus = 0; let apiHeaders = null; let apiBody = null;
  const mockRes = {
    writeHead: (status, h) => { apiStatus = status; apiHeaders = h; },
    end: (s) => { apiBody = JSON.parse(s); },
  };
  await scoreboardReg.handler({ method: 'GET', url: '/api/skill-scoreboard' }, mockRes);
  ok(apiStatus === 200 && apiHeaders['Content-Type']?.includes('application/json'), 'API 返回 JSON 200');
  ok(apiBody.ok === true && apiBody.total === 3, `API total=3（会话去重，实际 ${apiBody.total}）`);
  ok(apiBody.totalAlways === 4, `API totalAlways=4（每次都算，实际 ${apiBody.totalAlways}）`);
  ok(apiBody.skills.length === 2 && apiBody.skills[0].name === 'foo-skill' && apiBody.skills[0].count === 2, 'API 按次数降序且首条 foo-skill');
  ok(apiBody.skills[0].alwaysCount === 3, 'API 每行带 alwaysCount');
  ok(apiBody.skills.every((s) => typeof s.lastUsedAt === 'string' || s.lastUsedAt === null), 'lastUsedAt 字段');
  ok(typeof apiBody.updatedAt === 'string' || apiBody.updatedAt === null, 'updatedAt 字段');

  // 非 GET → 405
  await scoreboardReg.handler({ method: 'POST', url: '/' }, mockRes);
  ok(apiStatus === 405, '非 GET 返回 405');

  // ---- v1.4.0 注入文本（v1.5.0 双计数格式） ----
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
  ok(injection.includes('foo-skill（去重 2 / 全部 3'), '注入带双计数');
  ok(injection.includes('去重累计 3 次') && injection.includes('每次加载累计 4 次'), '注入带总数');
  ok(injection.indexOf('foo-skill') < injection.indexOf('bar-skill'), '注入按次数降序');
  ok(injection.includes('完整榜单见 设置'), '注入带 UI 指引');
  const emptyInj = await buildScoreboardInjection({ file: join(root, 'no-such.json'), topN: 25 });
  ok(emptyInj === '', '无记录返回空串');

  // ---- 损坏数据文件不崩 ----
  writeFileSync(dataFile, '{broken', 'utf8');
  await scoreboardReg.handler({ method: 'GET', url: '/' }, mockRes);
  ok(apiStatus === 200 && apiBody.ok === true && apiBody.total === 0, '损坏数据文件回退空表（total=0）不崩');

  // ---- v1.4.1 目录缺失自动创建 ----
  const deepFile = join(root, 'nested', 'dir', 'skill-usage.json');
  const handlers2 = {};
  const ctx2 = {
    on: (e, f) => { handlers2[e] = f; },
    effect: () => () => {},
    inject: () => {},
    get: () => undefined,
  };
  await apply(ctx2, { enabled: true, dataFile: deepFile });
  handlers2['tools/result'](
    { name: 'skill', arguments: JSON.stringify({ name: 'deep-skill' }), agent: { session: { id: 's9' } }, callId: 'cd1' },
    { isError: false },
  );
  handlers2['tools/result'](
    { name: 'skill', arguments: JSON.stringify({ name: 'deep-skill' }), agent: { session: { id: 's9' } }, callId: 'cd2' },
    { isError: false },
  );
  await sleep(150);
  const deepData = JSON.parse(readFileSync(deepFile, 'utf8'));
  ok(deepData.skills['deep-skill']?.count === 1 && deepData.skills['deep-skill']?.alwaysCount === 2,
    '目录缺失自动创建；同会话 deep-skill count=1 / alwaysCount=2');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);