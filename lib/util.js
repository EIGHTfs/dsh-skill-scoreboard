/**
 * dsh-skill-scoreboard 纯工具函数（2026-09-13 从 index.js 拆出：文件行数超标 + 纯函数独立便于复用）。
 * 全部为无副作用纯函数，不依赖 DSH 宿主 API。
 */

/** 对象判定：非 null 的 object 且非数组。 */
export function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 数值兜底：Number(v) 非有限数时取 0。 */
export function num0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 空 v2 记分结构（读失败/缺省态共用）。 */
export function emptyV2() {
  return { version: 2, skills: {}, sessions: {}, updatedAt: null };
}

/** 错误信息短截（日志统一用，避免堆栈刷屏）。 */
export function errMsg(e, max = 120) {
  return String(e?.message ?? e).slice(0, max);
}

/** 会话 id 短化：去 session- 前缀取前 8 字符（列表展示用）。 */
export function shortIdOf(id) {
  const s = String(id ?? '');
  const bare = s.startsWith('session-') ? s.slice('session-'.length) : s;
  return bare.slice(0, 8);
}

/** 时间短格式化：zh-CN 月日时分（空值 → '—'；非法日期回退原始串前 16 字符）。 */
export function fmtShortTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(iso).slice(0, 16).replace('T', ' ');
  }
}

/**
 * 并发限流信号量：限制同时执行的异步任务数（默认 2），
 * 防 N 份 zstd 日志同时解压驻留内存（dsh-session-conductor 曾因此打满堆）。
 */
export function createSemaphore(limit = 2) {
  let active = 0;
  const queue = [];
  const run = (fn) => new Promise((resolve, reject) => {
    const task = async () => {
      active += 1;
      try { resolve(await fn()); }
      catch (e) { reject(e); }
      finally {
        active -= 1;
        const next = queue.shift();
        if (next) next();
      }
    };
    if (active < limit) task();
    else queue.push(task);
  });
  return { run };
}
