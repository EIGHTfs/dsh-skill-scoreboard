/**
 * dsh-skill-scoreboard — 记分数据存取与合并（host 半侧子模块）
 *
 * 2026-09-13 从 lib/index.js 拆出（单文件超 400 行阈值）：
 * 本模块是记分数据的唯一读写层，集中处理 v2 结构（skills + sessions 两张表）：
 *  - 读：ensureDataDir/loadData（缺省空结构，v1 旧数据自动迁移）
 *  - 写：saveData（临时文件 + rename 原子写，防写一半）
 *  - 归一化：normalizeScoreboardPayload（导入前清洗，脏值丢弃）
 *  - 合并：mergeScoreboard（导入合并模式：同名累加、会话并集）
 *  - 记分：recordSkillUse/recordSessionUse（每次成功加载 +1，按会话去重单独记）
 *
 * 依赖：node 内置 + 同目录 util.js；不反向依赖 index.js。
 */
import { readFileSync, writeFileSync, promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { isPlainObject, num0, emptyV2 } from './util.js';

export async function ensureDataDir(file) {
  await fs.mkdir(dirname(file), { recursive: true });
}

export async function loadData(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return migrateToV2(JSON.parse(raw));
  } catch {
    return { version: 2, skills: {}, sessions: {}, updatedAt: null };
  }
}

/**
 * v1.8.0 数据迁移：把任意旧格式统一成 v2 结构。
 * v2 = { version: 2, skills: {...}, sessions: { [sessionId]: { loads, distinct, skills, firstUsedAt, lastUsedAt } } }
 *
 * v1 只有 skills[].sessions[]（会话去重列表），无法还原每个会话的加载次数：
 * 反推时每 skill 每会话记 1 次，distinct 准确、loads 为估计值并标记 loadsEstimated。
 *
 * @param skills - v1 的 skills 表。
 * @returns 反推出的 sessions 表。
 */
export function deriveSessionsFromSkills(skills) {
  const sessions = {};
  const now = new Date().toISOString();
  for (const [skillName, record] of Object.entries(skills || {})) {
    // v1 的 sessions 是去重列表（同会话同一 skill 只 push 一次）；
    // 这里再 Set 一次，防手改文件里出现重复会话 id 时把 loads 计大。
    const raw = Array.isArray(record?.sessions) ? record.sessions : [];
    for (const sessionId of new Set(raw.map(String))) {
      if (!sessionId) continue;
      const entry = sessions[sessionId] || (sessions[sessionId] = emptySessionEntry());
      entry.skills[skillName] = num0(entry.skills[skillName]) + 1;
      entry.loads += 1;
      stretchUsageWindow(entry, record?.lastUsedAt || now);
    }
  }
  for (const entry of Object.values(sessions)) entry.distinct = Object.keys(entry.skills).length;
  return sessions;
}

/** 会话表条目初值（deriveSessionsFromSkills / 迁移共用）。 */
function emptySessionEntry() {
  return { loads: 0, distinct: 0, skills: {}, firstUsedAt: null, lastUsedAt: null, loadsEstimated: true };
}

/**
 * 用新的使用时间撑开会话的使用窗口（首用取最早、末用取最晚）。
 * @param {object} entry 会话表条目（原地修改）
 * @param {string} usedAt 本次使用时间（ISO 串）
 */
function stretchUsageWindow(entry, usedAt) {
  if (!entry.firstUsedAt || usedAt < entry.firstUsedAt) entry.firstUsedAt = usedAt;
  if (!entry.lastUsedAt || usedAt > entry.lastUsedAt) entry.lastUsedAt = usedAt;
}

/**
 * 统一入口：v2 原样返回；v1/未知格式迁移为 v2（幂等）。
 *
 * @param data - 任意版本的记分数据。
 * @returns v2 结构（version/skills/sessions/updatedAt）。
 */
export function migrateToV2(data) {
  if (!isPlainObject(data)) {
    return { version: 2, skills: {}, sessions: {}, updatedAt: null };
  }
  const skills = isPlainObject(data.skills) ? data.skills : {};
  if (data.version === 2) {
    return { version: 2, skills, sessions: isPlainObject(data.sessions) ? data.sessions : {}, updatedAt: data.updatedAt || null };
  }
  return {
    version: 2,
    skills,
    sessions: deriveSessionsFromSkills(skills),
    updatedAt: data.updatedAt || new Date().toISOString(),
  };
}

/** 原子写（临时文件 + rename，避免写一半）；路径不存在先 mkdir。 */
export async function saveData(file, data) {
  await ensureDataDir(file);
  const tmpFile = `${file}.tmp`;
  const payload = { ...data, updatedAt: data.updatedAt || new Date().toISOString() };
  await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(tmpFile, file);
}

/** 归一化单条 skill 记录（缺字段补默认，数字字段转数值）。 */
function normalizeSkillEntry(record) {
  const count = num0(record?.count);
  return {
    count,
    loads: num0(record?.loads) || count,
    lastUsedAt: record?.lastUsedAt || null,
    sessions: Array.isArray(record?.sessions) ? record.sessions.map(String) : [],
    callIds: Array.isArray(record?.callIds) ? record.callIds.map(String) : [],
  };
}

/**
 * 统计会话记录里的 skill 子表：只保留正数次数，并求和。
 * @param {object} rawSkills 原始 skills 子表（可能非对象/含脏值）
 * @returns {{skillCounts: object, summedLoads: number}} 清洗后的计数表与总数
 */
function countPositiveSkills(rawSkills) {
  const skillCounts = {};
  let summedLoads = 0;
  if (!rawSkills || typeof rawSkills !== 'object' || Array.isArray(rawSkills)) return { skillCounts, summedLoads };
  for (const [skillName, rawCount] of Object.entries(rawSkills)) {
    const skillLoads = num0(rawCount);
    if (skillLoads <= 0) continue;
    skillCounts[skillName] = skillLoads;
    summedLoads += skillLoads;
  }
  return { skillCounts, summedLoads };
}

/** 归一化单条会话记录：skills 子表只保留正数次数，distinct 由子表重算。 */
function normalizeSessionEntry(record) {
  const { skillCounts, summedLoads } = countPositiveSkills(record?.skills);
  const entry = {
    loads: num0(record?.loads) || summedLoads,
    distinct: Object.keys(skillCounts).length,
    skills: skillCounts,
    firstUsedAt: record?.firstUsedAt || null,
    lastUsedAt: record?.lastUsedAt || null,
  };
  if (record?.loadsEstimated) entry.loadsEstimated = true;
  return entry;
}

/** 归一化 skills 子表：按名 trim 后逐条规范化，空名跳过。 */
function normalizeSkillsTable(skillsIn) {
  const skills = {};
  for (const [name, record] of Object.entries(skillsIn)) {
    const skillName = String(name || '').trim();
    if (!skillName) continue;
    skills[skillName] = normalizeSkillEntry(record);
  }
  return skills;
}

/** 归一化 sessions 子表：按 id trim 后逐条规范化，空 id 跳过。 */
function normalizeSessionsTable(sessionsIn) {
  const sessions = {};
  for (const [rawId, record] of Object.entries(sessionsIn)) {
    const sessionId = String(rawId || '').trim();
    if (!sessionId) continue;
    sessions[sessionId] = normalizeSessionEntry(record);
  }
  return sessions;
}

/**
 * 校验并归一化导入体：{ version, skills, sessions? }。
 * v1 体（无 sessions）自动从 skills[].sessions 反推会话表。
 *
 * @param raw - JSON 文本或对象。
 * @returns v2 结构。
 */
export function normalizeScoreboardPayload(raw) {
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!isPlainObject(payload)) {
    throw new Error('记分文件必须是 JSON 对象');
  }
  const skillsIn = isPlainObject(payload.skills) ? payload.skills : null;
  if (!skillsIn) throw new Error('记分文件缺少 skills 对象');
  const skills = normalizeSkillsTable(skillsIn);
  const sessionsIn = isPlainObject(payload.sessions) ? payload.sessions : null;
  const sessions = sessionsIn ? normalizeSessionsTable(sessionsIn) : deriveSessionsFromSkills(skills);
  return {
    version: 2,
    skills,
    sessions,
    updatedAt: payload.updatedAt || new Date().toISOString(),
  };
}

/** 合并两条 skill 记录：次数累加、会话与调用 id 取并集、最近时间取较晚者。 */
function mergeSkillEntries(previous, incoming) {
  const sessions = [...new Set([...(previous.sessions || []), ...(incoming.sessions || [])])];
  const callIds = [...new Set([...(previous.callIds || []), ...(incoming.callIds || [])])];
  const previousLoads = num0(previous.loads) || num0(previous.count);
  const incomingLoads = num0(incoming.loads) || num0(incoming.count);
  const lastUsedAt = (incoming.lastUsedAt || '') > (previous.lastUsedAt || '')
    ? incoming.lastUsedAt
    : previous.lastUsedAt;
  return {
    count: num0(previous.count) + num0(incoming.count),
    loads: previousLoads + incomingLoads,
    lastUsedAt,
    sessions,
    callIds,
  };
}

/** 合并两条会话记录：loads 相加、skills 子表按名累加、distinct 重算、时间取最早/最晚。 */
function mergeSessionEntries(baseEntry, extraEntry) {
  const skillCounts = mergeSkillCounts(baseEntry.skills, extraEntry.skills);
  const entry = {
    loads: num0(baseEntry.loads) + num0(extraEntry.loads),
    distinct: Object.keys(skillCounts).length,
    skills: skillCounts,
    firstUsedAt: earliestOf([baseEntry.firstUsedAt, extraEntry.firstUsedAt]),
    lastUsedAt: latestOf([extraEntry.lastUsedAt, baseEntry.lastUsedAt]),
  };
  if (baseEntry.loadsEstimated || extraEntry.loadsEstimated) entry.loadsEstimated = true;
  return entry;
}

/**
 * 合并两张「skill → 次数」计数表（同名累加，忽略非正数）。
 * @param {object} baseCounts 基准表
 * @param {object} extraCounts 追加表
 * @returns {object} 新表（不改动入参）
 */
function mergeSkillCounts(baseCounts, extraCounts) {
  const out = { ...(baseCounts || {}) };
  for (const [skillName, rawCount] of Object.entries(extraCounts || {})) {
    const count = num0(rawCount);
    if (count > 0) out[skillName] = (Number(out[skillName]) || 0) + count;
  }
  return out;
}

/**
 * 取一组时间里的最早值（忽略空值）。
 * @param {Array<string|null>} times ISO 时间串列表
 * @returns {string|null} 最早时间；全空返回 null
 */
function earliestOf(times) {
  const valid = times.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((a, b) => (a < b ? a : b));
}

/**
 * 取一组时间里的最晚值（忽略空值）。
 * @param {Array<string|null>} times ISO 时间串列表
 * @returns {string|null} 最晚时间；全空返回 null
 */
function latestOf(times) {
  const valid = times.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((a, b) => (a > b ? a : b));
}

/** 合并两张 skills 表：同名累加（mergeSkillEntries），新名直接并入。 */
function mergeSkillTables(baseSkills, extraSkills) {
  const skills = { ...baseSkills };
  for (const [skillName, record] of Object.entries(extraSkills)) {
    const previous = skills[skillName];
    skills[skillName] = previous ? mergeSkillEntries(previous, record) : { ...record };
  }
  return skills;
}

/** 合并两张 sessions 表：按会话 id 并集，逐条 mergeSessionEntries。 */
function mergeSessionTables(baseSessions, extraSessions) {
  const sessions = {};
  const emptySession = { loads: 0, skills: {}, firstUsedAt: null, lastUsedAt: null };
  for (const sessionId of new Set([...Object.keys(baseSessions), ...Object.keys(extraSessions)])) {
    sessions[sessionId] = mergeSessionEntries(
      baseSessions[sessionId] || emptySession,
      extraSessions[sessionId] || emptySession,
    );
  }
  return sessions;
}

/**
 * merge=true 时按 skill 名累加次数、合并会话/callId；会话题同样按会话 id 合并。
 *
 * @param current - 现有数据（可为 v1）。
 * @param incoming - 导入数据（v2）。
 * @returns 合并后的 v2 数据。
 */
export function mergeScoreboard(current, incoming) {
  const baseSkills = isPlainObject(current?.skills) ? current.skills : {};
  const extraSkills = isPlainObject(incoming?.skills) ? incoming.skills : {};
  const baseSessions = isPlainObject(current?.sessions) ? current.sessions : {};
  const extraSessions = isPlainObject(incoming?.sessions) ? incoming.sessions : {};
  return {
    version: 2,
    skills: mergeSkillTables(baseSkills, extraSkills),
    sessions: mergeSessionTables(baseSessions, extraSessions),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 记一次 skill 使用：count 按会话去重，loads 每次 +1，callId 防重复。
 *
 * @param data - 内存态记分数据（原地修改）。
 * @param skillName - skill 名。
 * @param sessionId - 会话 id（用于去重判定）。
 * @param callId - 工具调用 id，可为空。
 */
export function recordSkillUse(data, skillName, sessionId, callId) {
  const previous = data.skills[skillName];
  const target = previous ?? { count: 0, loads: 0, lastUsedAt: null, sessions: [], callIds: [] };
  if (typeof target.loads !== 'number') target.loads = target.count || 0;
  target.loads += 1;
  const seenInSession = !!(previous && previous.sessions?.includes(sessionId));
  if (!seenInSession) {
    target.count += 1;
    target.sessions = target.sessions || [];
    if (!target.sessions.includes(sessionId)) target.sessions.push(sessionId);
  }
  target.lastUsedAt = new Date().toISOString();
  target.callIds = target.callIds ?? [];
  if (callId) target.callIds.push(callId);
  data.skills[skillName] = target;
}

/**
 * v1.8.0：记一次会话维度的使用（该会话加载过哪些 skill、各几次），供会话榜使用。
 * sessionId 为 'unknown'（取不到会话）时不记。
 *
 * @param data - 内存态记分数据（原地修改）。
 * @param sessionId - 会话 id。
 * @param skillName - skill 名。
 */
export function recordSessionUse(data, sessionId, skillName) {
  if (!sessionId || sessionId === 'unknown') return;
  const now = new Date().toISOString();
  const entry = data.sessions[sessionId]
    || { loads: 0, distinct: 0, skills: {}, firstUsedAt: null, lastUsedAt: null };
  entry.skills[skillName] = (entry.skills[skillName] || 0) + 1;
  entry.loads += 1;
  entry.distinct = Object.keys(entry.skills).length;
  entry.firstUsedAt = entry.firstUsedAt || now;
  entry.lastUsedAt = now;
  delete entry.loadsEstimated; // 已有真实数据，不再标估计
  data.sessions[sessionId] = entry;
}
