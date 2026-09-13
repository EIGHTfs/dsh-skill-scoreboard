/**
 * dsh-skill-scoreboard web 路由模块（2026-09-13 从 index.js 拆出：文件行数超标）。
 * 三个设置页接口：GET 记分快照（含会话榜）、GET 导出、POST 导入。
 *
 * ⚠️ 回调必须同步（与 git-push 同构）：cordis 对 async inject 回调不调用，路由注册不生效（实测 401）。
 */

/** 单次 API 返回的最大行数（前端自己分页，这里只兜底防止极端数据量）。 */
const API_ROW_LIMIT = 200;

/** 统一 JSON 响应写法（所有只读接口共用）。 */
/** HTTP 405 响应体文案（非 GET 请求统一拒绝；提常量避免同字面量重复）。 */
const MSG_METHOD_NOT_ALLOWED = 'Method Not Allowed';
/** HTTP 405 状态码（所有只读接口共用）。 */
const HTTP_METHOD_NOT_ALLOWED = 405;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

/** 统一「只读接口拒绝非 GET」响应（405 + 固定文案）。 */
function sendMethodNotAllowed(res) {
  sendJson(res, HTTP_METHOD_NOT_ALLOWED, { ok: false, error: MSG_METHOD_NOT_ALLOWED });
}

/**
 * 组装 GET /api/skill-scoreboard 的返回体：skill 榜 + 会话榜 + 概览字段。
 *
 * @param file - 数据文件路径。
 * @param deps - { readCurrentData, skillRankRows, sessionRankRows }。
 * @returns 响应体对象。
 */
/**
 * 给会话榜行附上标题（并发解析；无解析器时原样返回）。
 * 每行标题解析失败只影响该行（降级为空标题），不阻断整体响应。
 *
 * @param {Array<object>} rows 会话榜行
 * @param {Function|object|null} titleResolver 标题解析器（函数或含 resolve 的对象）
 * @returns {Promise<Array<object>>} 带 title 字段的行
 */
async function attachTitles(rows, titleResolver) {
  if (!titleResolver || !rows.length) return rows;
  return Promise.all(rows.map(async (row) => ({ ...row, title: await resolveRowTitle(titleResolver, row.id) })));
}

/**
 * 解析单个会话标题（失败降级空串）。
 * @param {Function|object} titleResolver 标题解析器（函数或含 resolve 的对象）
 * @param {string} id 会话 id
 * @returns {Promise<string>} 标题；解析失败返回空串
 */
async function resolveRowTitle(titleResolver, id) {
  try {
    return await (typeof titleResolver === 'function' ? titleResolver(id) : titleResolver.resolve(id));
  } catch { return ''; }
}

async function buildSnapshot(file, titleResolver, deps) {
  const current = deps.readCurrentData(file);
  const skills = deps.skillRankRows(current).slice(0, API_ROW_LIMIT);
  const sessions = await attachTitles(deps.sessionRankRows(current).slice(0, API_ROW_LIMIT), titleResolver);
  const total = skills.reduce((sum, row) => sum + row.count, 0);
  const totalLoads = skills.reduce((sum, row) => sum + row.loads, 0);
  return {
    ok: true, total, totalLoads, recorded: skills.length,
    sessions, updatedAt: current.updatedAt || null, dataFile: file, skills,
  };
}

/**
 * 读请求体（导入用），超过 8MB 直接拒绝。
 *
 * @param req - HTTP 请求。
 * @returns 请求体文本。
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const sink = { chunks: [], size: 0 };
    req.on('data', (chunk) => collectChunk(req, sink, chunk, reject));
    req.on('end', () => resolve(Buffer.concat(sink.chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 导入请求体上限（8MB）：超过即拒绝，防超大 body 打满内存。 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * 收集请求体分片（readBody 的 data 事件处理）。
 * 超过上限立即 destroy 连接并 reject，防超大导入体打满内存。
 *
 * @param {object} req 请求对象（超限时需要 destroy）
 * @param {{chunks: Array, size: number}} sink 累积容器
 * @param {Buffer} chunk 本次分片
 * @param {Function} reject promise 的 reject
 * @returns {void}
 */
function collectChunk(req, sink, chunk, reject) {
  sink.size += chunk.length;
  if (sink.size <= MAX_BODY_BYTES) {
    sink.chunks.push(chunk);
    return;
  }
  reject(new Error('导入体过大'));
  req.destroy();
}

/**
 * 注册只读记分接口 GET /api/skill-scoreboard。
 *
 * @param webServer - 宿主 webServer 服务。
 * @param file - 数据文件路径。
 */
function registerSnapshotRoute(webServer, file, titleResolver, deps) {
  webServer.register({
    kind: 'exact',
    path: '/api/skill-scoreboard',
    handler: async (req, res) => {
      if ((req.method ?? 'GET') !== 'GET') {
        sendMethodNotAllowed(res);
        return;
      }
      try {
        const body = await buildSnapshot(file, titleResolver, deps);
        sendJson(res, 200, body);
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
      }
    },
  });
}

/**
 * 注册导出接口 GET /api/skill-scoreboard/export（下载完整 v2 记分 JSON）。
 *
 * @param webServer - 宿主 webServer 服务。
 * @param file - 数据文件路径。
 */
/**
 * 处理导出请求：拼装 v2 快照并作为 JSON 附件下发。
 *
 * @param {object} req 请求对象
 * @param {object} res 响应对象
 * @param {string} file 数据文件路径
 * @param {object} deps 数据依赖（readCurrentData 等）
 * @returns {void}
 */
function handleExport(req, res, file, deps) {
  if ((req.method ?? 'GET') !== 'GET') {
    sendMethodNotAllowed(res);
    return;
  }
  const current = deps.readCurrentData(file);
  const payload = {
    version: 2,
    skills: current.skills || {},
    sessions: current.sessions || {},
    updatedAt: current.updatedAt || null,
    exportedAt: new Date().toISOString(),
  };
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="skill-usage.json"',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function registerExportRoute(webServer, file, deps) {
  webServer.register({
    kind: 'exact',
    path: '/api/skill-scoreboard/export',
    handler: (req, res) => {
      try {
        handleExport(req, res, file, deps);
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
      }
    },
  });
}

/**
 * 注册导入接口 POST /api/skill-scoreboard/import?merge=true|false。
 *
 * @param webServer - 宿主 webServer 服务。
 * @param file - 数据文件路径。
 * @param deps - { normalizeScoreboardPayload, mergeScoreboard, readCurrentData, saveData }。
 */
function registerImportRoute(webServer, file, onImported, deps) {
  webServer.register({
    kind: 'exact',
    path: '/api/skill-scoreboard/import',
    handler: async (req, res) => {
      try {
        await handleImport(req, res, file, onImported, deps);
      } catch (e) {
        sendJson(res, 400, { ok: false, error: String(e?.message ?? e) });
      }
    },
  });
}

/**
 * 处理导入请求：读体 → 归一化 → 按 ?merge= 决定合并或覆盖 → 落盘 → 回执。
 *
 * @param {object} req 请求对象
 * @param {object} res 响应对象
 * @param {string} file 数据文件路径
 * @param {Function} onImported 导入完成回调（同步，用于刷新内存态）
 * @param {object} deps 数据依赖（normalizeScoreboardPayload/mergeScoreboard/readCurrentData/saveData）
 * @returns {Promise<void>}
 */
async function handleImport(req, res, file, onImported, deps) {
  if ((req.method ?? 'GET') !== 'POST') {
    sendMethodNotAllowed(res);
    return;
  }
  const raw = await readBody(req);
  const incoming = deps.normalizeScoreboardPayload(raw);
  const merge = readMergeFlag(req);
  const current = deps.readCurrentData(file);
  const next = merge ? deps.mergeScoreboard(current, incoming) : incoming;
  await deps.saveData(file, next);
  onImported(next);
  sendJson(res, 200, { ok: true, merge, recorded: Object.keys(next.skills || {}).length, updatedAt: next.updatedAt });
}

/**
 * 读取导入请求的合并开关（?merge=false 表示覆盖，缺省合并）。
 * @param {object} req 请求对象
 * @returns {boolean} true=合并，false=覆盖
 */
function readMergeFlag(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  return url.searchParams.get('merge') !== 'false';
}

/**
 * 注册设置页三个只读接口：记分快照（含会话榜）、导出、导入。
 *
 * @param ctx - 宿主插件上下文（提供 ctx.inject）。
 * @param options - { file, titleResolver, onImported }。
 * @param deps - 依赖函数（saveData/readCurrentData/skillRankRows/sessionRankRows/normalizeScoreboardPayload/mergeScoreboard）。
 */
export function registerWebRoutes(ctx, options, deps) {
  const file = options.file;
  ctx.inject(['webServer'], (wctx) => {
    const webServer = wctx.get('webServer');
    if (!webServer) return;
    registerSnapshotRoute(webServer, file, options.titleResolver, deps);
    registerExportRoute(webServer, file, deps);
    registerImportRoute(webServer, file, options.onImported, deps);
    console.log('[skill-scoreboard] ✅ 已注册 GET /api/skill-scoreboard（含会话榜）+ export/import');
  });
}
