/**
 * dsh-skill-scoreboard — skill 使用记分板（代码级自动记录）
 *
 * 完全用代码记录 AI 实际用过哪些 skill，替代手动 skill-scoreboard.md 记分：
 *  - 监听 tools/result：skill 工具真正执行完后记分
 *  - 命中 exec.name === "skill" → 该 skill 使用次数 +1（按会话去重：同会话只计 1 次，跨会话累加）
 *  - 用 callId 做全局去重：已计过的调用不重复计
 *  - 持久化到 data/skill-usage.json（版本化 + 最近生效时间 + 会话去重记录）
 *  - v1.2.0+：注册只读接口 GET /api/skill-scoreboard 供设置页展示
 *  - v1.3.0：浏览器半侧改挂 设置 → 侧边栏 →「Skill 记分板」独立页面（settings.section），
 *    不再使用 设置 → 插件配置 里的卡片位（settings.plugin.item）
 *
 * 计分语义：与旧 skill-scoreboard.md 一致——"每次实际生效 +1"；一次会话内重复加载同一 skill 只计 1 次。
 *
 * 不读 agent.session.events：Session 没有公开 events 字段，事件在私有 log 里，
 * 公开入口是 snapshotEvents() / ownEvents()。agent/pre-step 还发生在本步 tool/call 之前，
 * 即便能扫到日志也会漏本步最后一次 skill。
 */
import z from '@deepseek-ai/schemastery';
import { readFileSync, promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-skill-scoreboard';
export const inject = ['agents'];

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, '..', 'data', 'skill-usage.json');

const Config = z.object({
  enabled: z.boolean().default(true),
  /** 数据文件路径覆盖（默认 data/skill-usage.json） */
  dataFile: z.string().default(DATA_FILE),
});

/** 读记分数据，缺省返回空结构 */
async function loadData(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, skills: {} };
  }
}

/** 原子写（临时文件 + rename，避免写一半） */
async function saveData(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

/** 从 skill 工具参数取出 skill 名 */
function skillNameFromArgs(args) {
  try {
    const obj = typeof args === 'string' ? JSON.parse(args) : args;
    return obj?.name ?? '';
  } catch {
    return '';
  }
}

export async function apply(ctx, config = {}) {
  const cfg = Config(config);
  if (cfg.enabled === false) {
    console.log('[skill-scoreboard] 已禁用');
    return;
  }
  const file = cfg.dataFile;
  let data = await loadData(file);
  if (data.version !== 1) data = { version: 1, skills: {} };
  let writeChain = Promise.resolve();

  ctx.on('tools/result', (exec, result) => {
    if (result?.isError) return;
    if (exec?.name !== 'skill') return;
    const skillName = skillNameFromArgs(exec.arguments);
    if (!skillName) return;
    const sessionId = exec.agent?.session?.id || exec.agent?.id || 'unknown';
    const callId = exec.callId || '';

    writeChain = writeChain.then(async () => {
      const rec = data.skills[skillName];
      if (callId && rec?.callIds?.includes(callId)) return;
      if (rec && rec.sessions?.includes(sessionId)) return;
      const target = rec ?? { count: 0, lastUsedAt: null, sessions: [], callIds: [] };
      target.count += 1;
      target.lastUsedAt = new Date().toISOString();
      if (!target.sessions.includes(sessionId)) target.sessions.push(sessionId);
      target.callIds = target.callIds ?? [];
      if (callId) target.callIds.push(callId);
      data.skills[skillName] = target;
      try { await saveData(file, data); }
      catch (e) { console.log(`[skill-scoreboard] ⚠️ 写数据失败: ${String(e?.message ?? e).slice(0, 120)}`); }
    }).catch((e) => {
      console.log(`[skill-scoreboard] ⚠️ 记分失败: ${String(e?.message ?? e).slice(0, 120)}`);
    });
  });

  console.log(`[skill-scoreboard] ✅ 已启动，数据文件: ${file}，当前记录 ${Object.keys(data.skills).length} 个 skill`);

  // v1.2.0 设置页展示：GET /api/skill-scoreboard（只读，返回按次数降序的记分表）
  // ⚠️ 回调必须同步（与 git-push 同构）：cordis 对 async inject 回调不调用，路由注册不生效（实测 401）
  ctx.inject(['webServer'], (wctx) => {
    const webServer = wctx.get('webServer');
    if (!webServer) return;
    webServer.register({
      kind: 'exact',
      path: '/api/skill-scoreboard',
      handler: (req, res) => {
        try {
          if ((req.method ?? 'GET') !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
            return;
          }
          let current;
          try { current = JSON.parse(readFileSync(file, 'utf8')); } catch { current = { version: 1, skills: {} }; }
          const skills = Object.entries(current.skills || {})
            .map(([name, rec]) => ({ name, count: rec?.count || 0, lastUsedAt: rec?.lastUsedAt || null }))
            .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)))
            .slice(0, 200);
          const total = skills.reduce((s, x) => s + x.count, 0);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, total, recorded: skills.length, updatedAt: current.updatedAt || null, skills }, null, 2));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
        }
      },
    });
    console.log('[skill-scoreboard] ✅ 已注册 GET /api/skill-scoreboard（设置页记分卡）');
  });
}