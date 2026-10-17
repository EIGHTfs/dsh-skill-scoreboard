/**
 * 内嵌 i18n 兜底字典同步（dsh-skill-scoreboard）
 *
 * 背景（2026-10-17 实测缺陷）：
 *   客户端字典走外置 fetch（`GET /api/skill-scoreboard/i18n`），源码只内嵌 `settings.title` /
 *   `settings.desc` 两个键作同步兜底。一旦 fetch 失败——反代 302 重定向到登录页导致 json() 解析
 *   抛错、网络抖动、认证过期——`loadDict()` 的 catch 静默吞掉，`L` 只剩这两个键，
 *   其余 49 个键全部退化为**原始键名**显示（`settings.totalBadge` / `settings.refresh` /
 *   `settings.tabSkill` …）。实测三种场景：fetch 正常 → 0 个原始键；302→HTML → 11 个；
 *   网络失败 → 11 个。故必须把**完整字典**内嵌为兜底。
 *
 * 单一权威仍是 `lib/i18n/{zh,en}.json`：
 *   本脚本从两份 JSON 生成 `lib/client-parts/entry.js` 里 `L = {...}` 的完整兜底块，
 *   生成区用标记包裹，幂等替换；`--check` 校验内嵌与 JSON 是否一致（提交/CI 门禁）。
 *   ⚠️ 改字典只改 JSON，然后跑本脚本；**不要手改内嵌块**（会被下次生成覆盖）。
 *
 * 用法：
 *   node scripts/sync-i18n-fallback.mjs           # 生成（不一致则写回 entry.js）
 *   node scripts/sync-i18n-fallback.mjs --check   # 只校验（不一致 exit 1）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ENTRY_FILE = join(ROOT, 'lib', 'client-parts', 'entry.js');
export const I18N_DIR = join(ROOT, 'lib', 'i18n');

/** 生成区标记：整块由本脚本维护，幂等替换。 */
export const START_MARK = '// <i18n-fallback-start>';
export const END_MARK = '// <i18n-fallback-end>';

/**
 * 把字典对象渲染成缩进对齐的 JS 字面量。
 * 键用单引号（与既有风格一致），值用 JSON.stringify 保证转义正确。
 * @param {Record<string,string>} dict 单语言字典
 * @param {string} indent 外层缩进
 * @returns {string} 形如 `    'k': "v",\n` 的多行文本
 */
function renderDict(dict, indent) {
  return Object.entries(dict)
    .map(([k, v]) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n');
}

/**
 * 由两份 JSON 生成 `L = {...}` 完整块。
 * @returns {string} 可直接替换 `L = {` … `}` 的整块文本
 */
export function renderFallbackBlock() {
  const zh = JSON.parse(readFileSync(join(I18N_DIR, 'zh.json'), 'utf8'));
  const en = JSON.parse(readFileSync(join(I18N_DIR, 'en.json'), 'utf8'));
  return [
    'L = {',
    `${START_MARK} 由 scripts/sync-i18n-fallback.mjs 从 lib/i18n/{zh,en}.json 生成，勿手改`,
    '  // 完整字典内嵌为同步兜底：外置 fetch 失败时页面仍显示正确文案，不退化出原始键名。',
    '  zh: {',
    renderDict(zh, '    '),
    '  },',
    '  en: {',
    renderDict(en, '    '),
    '  },',
    END_MARK,
    '}',
  ].join('\n');
}

/**
 * 用生成块替换源码里的 `L = {...}`（从 `L = {` 到其后第一个独立 `}`）。
 * @param {string} src entry.js 全文
 * @returns {string} 替换后的全文
 */
export function applyBlock(src) {
  const lines = src.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith('L = {'));
  if (startIdx < 0) throw new Error('entry.js 里找不到 `L = {` 起始行');
  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (lines[i] === '}') { endIdx = i; break; }
  }
  if (endIdx < 0) throw new Error('entry.js 里找不到 `L = {` 的闭合 `}`');
  const head = lines.slice(0, startIdx);
  const tail = lines.slice(endIdx + 1);
  return [...head, ...renderFallbackBlock().split('\n'), ...tail].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const checkOnly = argv.includes('--check');
  if (!existsSync(ENTRY_FILE)) {
    console.error(`❌ 找不到 ${ENTRY_FILE}`);
    return 1;
  }
  const current = readFileSync(ENTRY_FILE, 'utf8');
  let next;
  try {
    next = applyBlock(current);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    return 1;
  }
  if (current === next) {
    const n = JSON.parse(readFileSync(join(I18N_DIR, 'zh.json'), 'utf8'));
    console.log(`✅ 内嵌兜底与 lib/i18n 一致（zh ${Object.keys(n).length} 键）`);
    return 0;
  }
  if (checkOnly) {
    console.error('❌ 内嵌 i18n 兜底与 lib/i18n/{zh,en}.json 不一致——请跑 node scripts/sync-i18n-fallback.mjs 重新生成');
    return 1;
  }
  writeFileSync(ENTRY_FILE, next, 'utf8');
  const zh = JSON.parse(readFileSync(join(I18N_DIR, 'zh.json'), 'utf8'));
  const en = JSON.parse(readFileSync(join(I18N_DIR, 'en.json'), 'utf8'));
  console.log(`✅ 已同步内嵌兜底字典（zh ${Object.keys(zh).length} 键 / en ${Object.keys(en).length} 键）`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
