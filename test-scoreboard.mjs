/** dsh-skip-sensitive dsh-skill-scoreboard v1.2.0 单测：tools/result 记分去重 + 设置页 API（mock ctx + 临时数据文件） */
import { apply, name } from './lib/index.js';
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
  let registered = null;
  const webServerMock = { register: (r) => { registered = r; } };
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
  ok(registered && registered.path === '/api/skill-scoreboard' && registered.kind === 'exact', '已注册 GET /api/skill-scoreboard');

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
  ok(data.skills['foo-skill']?.count === 2, `foo-skill 跨会话累计 2 次（实际 ${data.skills['foo-skill']?.count}）`);
  ok(data.skills['foo-skill']?.sessions?.length === 2, 'foo-skill 记 2 个会话');
  ok(data.skills['bar-skill']?.count === 1, 'bar-skill 计 1 次');
  ok(!data.skills['x'], '非 skill 工具不计分');
  ok(!data.skills['err-skill'], 'isError 结果不计分');

  // ---- 设置页 API 输出 ----
  let apiBody = null;
  const mockRes = {
    writeHead: (status, h) => { apiStatus = status; apiHeaders = h; },
    end: (s) => { apiBody = JSON.parse(s); },
  };
  let apiStatus = 0; let apiHeaders = null;
  await registered.handler({ method: 'GET', url: '/api/skill-scoreboard' }, mockRes);
  ok(apiStatus === 200 && apiHeaders['Content-Type']?.includes('application/json'), 'API 返回 JSON 200');
  ok(apiBody.ok === true && apiBody.total === 3, `API total=3（实际 ${apiBody.total}）`);
  ok(apiBody.skills.length === 2 && apiBody.skills[0].name === 'foo-skill' && apiBody.skills[0].count === 2, 'API 按次数降序且首条 foo-skill');
  ok(apiBody.skills.every((s) => typeof s.lastUsedAt === 'string' || s.lastUsedAt === null), 'lastUsedAt 字段');
  ok(typeof apiBody.updatedAt === 'string' || apiBody.updatedAt === null, 'updatedAt 字段');

  // 非 GET → 405
  await registered.handler({ method: 'POST', url: '/' }, mockRes);
  ok(apiStatus === 405, '非 GET 返回 405');

  // ---- 损坏数据文件不崩 ----
  writeFileSync(dataFile, '{broken', 'utf8');
  await registered.handler({ method: 'GET', url: '/' }, mockRes);
  ok(apiStatus === 200 && apiBody.ok === true && apiBody.total === 0, '损坏数据文件回退空表（total=0）不崩');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);