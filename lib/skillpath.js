/**
 * dsh-skill-scoreboard — skill 文件路径解析（host 半侧子模块）
 *
 * 2026-09-13 从 lib/index.js 拆出（单文件超 400 行阈值）：
 * 本模块只负责「skill 名 ↔ 实际文件路径」的双向解析，供记分主链路复用：
 *  - resolveSkillPath：优先问 skills 服务（get/list），失败再扫文件系统兜底
 *  - makeSkillPathIndex：懒构建 + TTL 的「路径 → skill 名」索引（read 工具直接读文件也记分）
 *
 * 依赖：仅 node 内置 + 同目录 util.js；不反向依赖 index.js。
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, resolve } from 'node:path';

function readPathFromArgs(args) {
  try {
    const parsed = typeof args === 'string' ? JSON.parse(args) : args;
    const raw = parsed?.file_path || parsed?.filePath || '';
    if (typeof raw !== 'string' || !raw.trim()) return '';
    return resolve(raw.trim());
  } catch {
    return '';
  }
}

/**
 * v1.8.2：构造「skill 文件路径 → skill 名」索引（read 直接读文件也记分）。
 * 懒构建 + TTL 刷新：首次/超时后异步重建（resolveSkillPath 涉及 skills 服务查询），
 * 构建完成前用旧索引匹配，避免阻塞 tools/result 主链路。
 *
 * @param getNames - () => string[] 已知 skill 名列表（当前记分数据的 keys）。
 * @param skillsSvc - skills 服务（可为 null，走文件系统扫描兜底）。
 * @returns {{ find: (absPath: string) => string, build: () => Promise<void> }}
 */
/**
 * 把单个 skill 的路径写进索引表（绝对路径 + basename 两种键都存）。
 * 解析失败只跳过该 skill，不影响其它条目。
 *
 * @param {Map<string, string>} next 索引表（原地写入）
 * @param {string} name skill 名
 * @param {object|null} skillsSvc 宿主 skills 服务
 * @returns {Promise<void>}
 */
async function addSkillToIndex(next, name, skillsSvc) {
  try {
    const p = await resolveSkillPath(name, skillsSvc);
    if (typeof p !== 'string' || !p) return;
    const abs = resolve(p);
    next.set(abs, name);
    const base = basename(abs);
    if (base) next.set(base, name); // basename 兜底（相对/不同前缀解析差异）
  } catch { /* 单个 skill 解析失败不阻断索引构建 */ }
}

export function makeSkillPathIndex(getNames, skillsSvc = null) {
  let index = new Map();
  let building = null;
  let builtAt = 0;
  const TTL_MS = 5 * 60_000;

  async function build() {
    const names = Array.isArray(getNames()) ? getNames() : [];
    const next = new Map();
    await Promise.all(names.map((name) => addSkillToIndex(next, name, skillsSvc)));
    index = next;
    builtAt = Date.now();
    building = null;
  }

  function find(absPath) {
    if (!absPath) return '';
    if (indexStale()) building = build().catch(() => { building = null; });
    return index.get(absPath) || index.get(basename(absPath)) || '';
  }

  /** 索引是否需重建：无重建在途，且从未建过或已过 TTL。 */
  function indexStale() {
    if (building) return false;
    return builtAt === 0 || Date.now() - builtAt > TTL_MS;
  }

  return { find, build };
}

/**
 * read 工具记分：file_path 命中已知 skill 文件路径 → 返回 skill 名。
 * @param args - 工具参数。
 * @param pathIndex - makeSkillPathIndex 产物（缺省时按参数名猜，不建索引）。
 * @returns {string} skill 名；未命中返回空串。
 */
export function skillNameFromReadArgs(args, pathIndex = null) {
  if (!pathIndex || typeof pathIndex.find !== 'function') return '';
  const abs = readPathFromArgs(args);
  if (!abs) return '';
  return pathIndex.find(abs);
}

function guessSkillFile(base, name) {
  if (!base) return '';
  const candidates = [join(base, `${name}.md`), join(base, name, 'SKILL.md'), join(base, name, `${name}.md`)];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return existsSync(base) ? base : '';
}

function pathFromSkillDef(def, name) {
  if (!def || typeof def !== 'object') return '';
  if (typeof def.path === 'string' && def.path) return def.path;
  const rb = def.resourceBase;
  if (rb && rb.kind === 'directory' && typeof rb.path === 'string' && rb.path) {
    return guessSkillFile(rb.path, name) || rb.path;
  }
  return '';
}

function scanSkillDirs(name) {
  for (const dir of candidateSkillDirs()) {
    const hit = guessSkillFile(dir, name);
    if (hit) return hit;
  }
  return '';
}

/**
 * 收集候选 skill 目录（固定几个已知位置 + 工作区下每个项目的 skills/）。
 * 固定位置：cwd 的技能仓库与 .dsh/skills、$DSH_HOME/.dsh/skills、用户家目录 .dsh/skills。
 * @returns {Array<string>} 候选目录（可能不存在，交由 guessSkillFile 逐个探测）
 */
function candidateSkillDirs() {
  const cwd = process.cwd();
  const home = homedir();
  const dshHome = process.env.DSH_HOME || home;
  const dirs = [
    join(cwd, '.dsh-home', '工作区', 'ai-work-archive', 'skills'),
    join(cwd, '.dsh-home', '.dsh', 'skills'),
    join(dshHome, '.dsh', 'skills'),
    join(home, '.dsh', 'skills'),
  ];
  const workspace = join(cwd, '.dsh-home', '工作区');
  if (!existsSync(workspace)) return dirs;
  try {
    for (const ent of readdirSync(workspace, { withFileTypes: true })) {
      if (ent.isDirectory()) dirs.push(join(workspace, ent.name, 'skills'));
    }
  } catch { /* 工作区不可读时只用固定位置，不阻断路径解析 */ }
  return dirs;
}

export async function resolveSkillPath(name, skillsSvc = null) {
  const fromGet = await trySkillServiceGet(skillsSvc, name);
  if (fromGet) return fromGet;
  const fromList = await trySkillServiceList(skillsSvc, name);
  if (fromList) return fromList;
  return scanSkillDirs(name);
}

/**
 * 试经 skills 服务的 get(name) 解析路径（服务缺失/失败返回空串）。
 * @param {object|null} skillsSvc 宿主 skills 服务
 * @param {string} name skill 名
 * @returns {Promise<string>} 路径；解析不出返回空串
 */
async function trySkillServiceGet(skillsSvc, name) {
  if (!skillsSvc || typeof skillsSvc.get !== 'function') return '';
  try {
    return pathFromSkillDef(await skillsSvc.get(name), name);
  } catch { /* 服务查询失败不阻断主流程（继续下一个来源） */ }
  return '';
}

/**
 * 试经 skills 服务的 list() 找到同名条目再解析路径（服务缺失/失败返回空串）。
 * @param {object|null} skillsSvc 宿主 skills 服务
 * @param {string} name skill 名
 * @returns {Promise<string>} 路径；解析不出返回空串
 */
async function trySkillServiceList(skillsSvc, name) {
  if (!skillsSvc || typeof skillsSvc.list !== 'function') return '';
  try {
    const list = await skillsSvc.list();
    const hit = Array.isArray(list) ? list.find((s) => s && s.name === name) : null;
    return pathFromSkillDef(hit, name);
  } catch { /* 服务查询失败不阻断主流程（继续下一个来源） */ }
  return '';
}

/**
 * v1.4.0：构建记分榜注入文本（纯函数，可单测）。
 * 读记分文件 → 按次数降序 → Top N 行，每行经 skills 服务 + 文件系统扫描解析实际路径。
 * @param {{ file: string, topN?: number, skillsSvc?: object }} opts
 * @returns {Promise<string>} 注入正文；无记录时返回空串
 */
