/**
 * dsh-skill-scoreboard — skill 使用记分板（代码级自动记录）
 *
 * 完全用代码记录 AI 实际用过哪些 skill，替代手动 skill-scoreboard.md 记分：
 *  - 监听 tools/result：skill 工具真正执行完后记分
 *  - 命中 exec.name === "skill" → 该 skill 使用次数 +1
 *  - v1.5.0 双计数同时记录（记分板页面顶部切换显示）：
 *      - count（会话去重）：同一会话同一 skill 只计 1 次，跨会话累加
 *      - alwaysCount（每次都算）：每次调用都 +1（仅 callId 幂等防同一调用重复写）
 *  - v1.4.1：写盘前自动创建 data/ 目录（防迁移/重装后目录缺失导致记分丢失）
 *  - v1.4.0：agent/pre-step 注入（与 dsh-git-push 相同时机，每个 agent 只注入一次）：
 *    记分榜信息 + 每个 skill 的实际文件路径（经 skills 服务解析，供 AI 参考定位；
 *    设置页 UI 保持不显示路径）
 *  - v1.3.0：浏览器半侧改挂 设置 → 侧边栏 →「Skill 记分板」独立页面（settings.section）
 *  - v1.2.0+：注册只读接口 GET /api/skill-scoreboard 供设置页展示
 *
 * 计分语义 v1.4.0 前：与旧 skill-scoreboard.md 一致——"每次实际生效 +1"；
 * 一次会话内重复加载同一 skill 只计 1 次（= count）。v1.5.0 起 alwaysCount 并行累计。
 *
 * 不读 agent.session.events：Session 没有公开 events 字段，事件在私有 log 里，
 * 公开入口是 snapshotEvents() / ownEvents()。agent/pre-step 还发生在本步 tool/call 之前，
 * 即便能扫到日志也会漏本步最后一次 skill。
 */
import z from '@deepseek-ai/schemastery';
import { readFileSync, promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const name = 'dsh-skill-scoreboard';
export const inject = ['agents'];

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, '..', 'data', 'skill-usage.json');

const Config = z.object({
  enabled: z.boolean().default(true),
  /** 数据文件路径覆盖（默认 data/skill-usage.json） */
  dataFile: z.string().default(DATA_FILE),
  /** v1.4.0：是否在 agent/pre-step 注入记分榜 + skill 路径（默认开） */
  injectEnabled: z.boolean().default(true),
  /** v1.4.0：注入 Top N 个 skill（含路径解析；其余只报总数） */
  injectTopN: z.number().default(25),
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

/** 原子写（临时文件 + rename；自动创建目录，避免 data/ 缺失（如迁移/重装后）导致写入失败） */
async function saveData(file, data) {
  const tmp = `${file}.tmp`;
  await fs.mkdir(dirname(file), { recursive: true });
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

/** ISO 时间 → 本地可读短格式 */
export function fmtShortTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(iso).slice(0, 16).replace('T', ' ');
  }
}

/**
 * v1.4.0：构建记分榜注入文本（纯函数，可单测）。
 * 读记分文件 → 按会话去重次数降序 → Top N 行，每行经 skills 服务解析实际路径。
 * @param {{ file: string, topN?: number, skillsSvc?: object }} opts
 * @returns {Promise<string>} 注入正文；无记录时返回空串
 */
export async function buildScoreboardInjection({ file, topN = 25, skillsSvc = null }) {
  let current;
  try { current = JSON.parse(await fs.readFile(file, 'utf8')); } catch { current = null; }
  const recs = (current && typeof current === 'object' ? current.skills : null) || {};
  const rows = Object.entries(recs)
    .map(([n, rec]) => ({ name: n, count: rec?.count || 0, alwaysCount: rec?.alwaysCount || 0, lastUsedAt: rec?.lastUsedAt || null }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  if (!rows.length) return '';
  const totalCount = rows.reduce((s, x) => s + x.count, 0);
  const totalAlways = rows.reduce((s, x) => s + x.alwaysCount, 0);
  const top = rows.slice(0, Math.max(0, topN || 0));
  // 并发解析路径（单个失败不影响整体；skills 服务缺位则不带路径）
  let paths = [];
  if (skillsSvc && typeof skillsSvc.get === 'function') {
    const defs = await Promise.all(top.map((row) => Promise.resolve(skillsSvc.get(row.name)).catch(() => undefined)));
    paths = defs.map((def) => (def && typeof def.path === 'string' && def.path ? def.path : ''));
  }
  const lines = [
    '【dsh-skill-scoreboard 注入：skill 使用记分榜】AI 会话实际加载过的 skill 统计（数据源 data/skill-usage.json；count=会话去重次数，alwaysCount=每次加载都算，见 设置 → 侧边栏 → Skill 记分板 顶部切换）。供参考：常用/已加载过的 skill 及其实际文件路径，避免无谓重复加载、便于定位 skill 文件：',
    '',
    `- 共 ${rows.length} 个 skill、会话去重累计 ${totalCount} 次、每次加载累计 ${totalAlways} 次（Top ${top.length}）：`,
  ];
  for (let i = 0; i < top.length; i++) {
    const row = top[i];
    const path = paths[i] || '';
    lines.push(`  ${i + 1}. ${row.name}（去重 ${row.count} / 全部 ${row.alwaysCount}，最近 ${fmtShortTime(row.lastUsedAt)}）${path ? ` → ${path}` : ''}`);
  }
  lines.push('', '（完整榜单见 设置 → 侧边栏 → Skill 记分板）');
  return lines.join('\n');
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
      // callId 幂等：同一调用不重复计（两种计数都生效）
      if (callId && rec?.callIds?.includes(callId)) return;
      const target = rec ?? { count: 0, alwaysCount: 0, lastUsedAt: null, sessions: [], callIds: [] };
      // count：会话去重（同一会话同一 skill 只计 1 次）
      if (!target.sessions.includes(sessionId)) {
        target.count += 1;
        target.sessions.push(sessionId);
      }
      // alwaysCount：每次都算（仅 callId 幂等）
      target.alwaysCount = (target.alwaysCount ?? 0) + 1;
      target.lastUsedAt = new Date().toISOString();
      target.callIds = target.callIds ?? [];
      if (callId) target.callIds.push(callId);
      data.skills[skillName] = target;
      try { await saveData(file, data); }
      catch (e) { console.log(`[skill-scoreboard] ⚠️ 写数据失败: ${String(e?.message ?? e).slice(0, 120)}`); }
    }).catch((e) => {
      console.log(`[skill-scoreboard] ⚠️ 记分失败: ${String(e?.message ?? e).slice(0, 120)}`);
    });
  });

  console.log(`[skill-scoreboard] ✅ 已启动，数据文件: ${file}，当前记录 ${Object.keys(data.skills).length} 个 skill（双计数：会话去重 + 每次都算）`);

  // v1.4.0 agent/pre-step 注入（与 dsh-git-push 相同时机与形态）：
  // 每个 agent 首次 step 注入一次记分榜 + skill 实际路径，供 AI 参考。
  // 异步 get 路径不影响主链路；失败时降级为不带路径的榜单。
  if (cfg.injectEnabled) {
    const injectedAgents = new WeakSet();
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next();
      if (decision.kind === 'reject') return decision;
      if (signal?.aborted) return decision;
      if (injectedAgents.has(agent)) return decision;
      injectedAgents.add(agent);
      try {
        const text = await buildScoreboardInjection({
          file,
          topN: cfg.injectTopN,
          skillsSvc: ctx.get('skills'),
        });
        if (!text) return decision;
        return {
          ...decision,
          messages: [
            ...decision.messages,
            createUserMessage({
              content: [{ type: 'text', text }],
              source: { kind: 'plugin', plugin: name, form: 'instructions' },
            }),
          ],
        };
      } catch (e) {
        console.log(`[skill-scoreboard] ⚠️ 注入失败: ${String(e?.message ?? e).slice(0, 120)}`);
        return decision;
      }
    });
  }

  // v1.2.0 设置页展示：GET /api/skill-scoreboard（只读，返回双计数按会话去重次数降序的记分表）
  // ⚠️ 注入回调必须同步（与 git-push 同构）：cordis 对 async inject 回调不调用，路由注册不生效（实测 401）
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
            .map(([name, rec]) => ({
              name,
              count: rec?.count || 0,
              alwaysCount: rec?.alwaysCount || 0,
              lastUsedAt: rec?.lastUsedAt || null,
            }))
            .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)))
            .slice(0, 200);
          const total = skills.reduce((s, x) => s + x.count, 0);
          const totalAlways = skills.reduce((s, x) => s + x.alwaysCount, 0);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            ok: true,
            total,
            totalAlways,
            recorded: skills.length,
            updatedAt: current.updatedAt || null,
            skills,
          }, null, 2));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
        }
      },
    });
    console.log('[skill-scoreboard] ✅ 已注册 GET /api/skill-scoreboard（设置页记分卡，双计数）');
  });
}