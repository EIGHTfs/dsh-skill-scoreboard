/**
 * dsh-skill-scoreboard — skill 使用记分板（代码级自动记录）
 *
 * 完全用代码记录 AI 实际用过哪些 skill，替代手动 skill-scoreboard.md 记分：
 *  - 监听 agent/pre-step，从 agent.session.events 提取 tool/call 事件（工具实际执行时 append 到 session）
 *  - 命中 name === "skill" 的工具调用 → 该 skill 使用次数 +1（按会话去重：同会话只计 1 次，跨会话累加）
 *  - 用事件 seq 做全局去重：已计过 seq 不重复计（防重启/多 step 重复）
 *  - 持久化到 data/skill-usage.json（版本化 + 最近生效时间 + 会话去重记录）
 *
 * 计分语义：与旧 skill-scoreboard.md 一致——"每次实际生效 +1"；一次会话内重复加载同一 skill 只计 1 次。
 */
import z from '@deepseek-ai/schemastery';
import { promises as fs } from 'node:fs';
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

/** 从 session 事件流提取模型实际调用的 skill 工具名（去重、保序） */
function invokedSkillsFromEvents(events = []) {
  const names = [];
  const seen = new Set();
  for (const event of events) {
    if (event?.type !== 'tool/call') continue;
    const data = event.data;
    if (data?.name !== 'skill') continue;
    let skillName = '';
    try {
      const args = typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments;
      skillName = args?.name ?? '';
    } catch { skillName = ''; }
    if (skillName && !seen.has(skillName)) { seen.add(skillName); names.push({ seq: event.seq, skillName }); }
  }
  return names;
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

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind === 'reject') return decision;
    const sessionId = agent?.session?.id || agent?.id || 'unknown';
    const events = agent?.session?.events ?? [];
    const hits = invokedSkillsFromEvents(events);
    if (hits.length === 0) return decision;

    const now = new Date().toISOString();
    let changed = false;
    for (const { seq, skillName } of hits) {
      const rec = data.skills[skillName];
      // 全局 seq 去重：已在 sessions 列表里记过的会话/事件不重复计
      if (rec && rec.seqs?.includes(seq)) continue;
      // 按会话去重：同会话已计过该 skill 则不重复计（但每次实际生效都应 +1 吗？不——按会话去重，会话内 +1 次）
      if (rec && rec.sessions?.includes(sessionId)) continue;
      const target = rec ?? { count: 0, lastUsedAt: null, sessions: [], seqs: [] };
      target.count += 1;
      target.lastUsedAt = now;
      if (!target.sessions.includes(sessionId)) target.sessions.push(sessionId);
      target.seqs = target.seqs ?? [];
      target.seqs.push(seq);
      data.skills[skillName] = target;
      changed = true;
    }
    if (changed) {
      try { await saveData(file, data); }
      catch (e) { console.log(`[skill-scoreboard] ⚠️ 写数据失败: ${String(e?.message ?? e).slice(0, 120)}`); }
    }
    return decision;
  });

  console.log(`[skill-scoreboard] ✅ 已启动，数据文件: ${file}，当前记录 ${Object.keys(data.skills).length} 个 skill`);
}
