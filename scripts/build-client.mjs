/**
 * 客户端分片构建（dsh-skill-scoreboard）
 *
 * 背景：`lib/client.js`（904 行）是 DSH 要求的**浏览器半侧单文件**，但直接维护单文件「改一处要读整份」。
 *   改为**分片源码 + 拼接构建**：源码在 `lib/client-parts/**`（git 维护），`lib/client.js` 是**产物**。
 *   做法与工具链来自 dsh-git-push 的同名脚本（C8 已在其仓库验证：产物与拆分前逐字节一致）。
 *
 * ⛔ 形态铁律（client-modules 聚合 bundle 兼容，见 client.js 头部注释）：
 *   1. `window.__ModuleLoader__.load` 必须是产物里的**第一条语句**（本文件顶层 IIFE 包裹）；
 *   2. 全部代码在 factory 函数体内，文件顶层【零声明】（防 combo 拼接撞名）；
 *   3. 内部命名统一 `dshsb_` 前缀（防与其他插件同名声明撞名）。
 *   ⇒ 分片是**片段**（fragment）：单片不是合法 JS（首片开工厂、尾片收尾），
 *     只有按 PART_ORDER 拼起来才是完整文件；因此语法检查只对**产物**做（见 scripts/check.mjs）。
 *
 * 产物**逐字节可复现**：分片是原文件的精确切片，零加工相接即原样还原（`--check` 可校验）。
 *
 * 用法：
 *   node scripts/build-client.mjs            # 校验产物与分片是否一致，不一致则写回
 *   node scripts/build-client.mjs --check    # 只校验（提交/CI 门禁用；不一致 exit 1）
 *   node scripts/build-client.mjs --print    # 只打印产物到 stdout（不落盘）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PARTS_DIR = join(ROOT, 'lib', 'client-parts');
export const OUT_FILE = join(ROOT, 'lib', 'client.js');

/**
 * 拼接顺序 = 依赖顺序（先定义后使用）。
 * 函数声明会提升、但 `const`/`let` 不会——顺序错会在**运行时**才炸（静态查不出），
 * 所以这里与 client.js 的分节注释一一对应；改分片必须同步改本表。
 * 新分片未登记进本表 ⇒ 构建直接报错（不静默丢失）。
 */
export const PART_ORDER = [
  '00-entry.js',   // 文件头 + 顶层 IIFE + createModule(require) + ReactRef/NS/name
  '01-apply.js',   // apply(ctx)：settings.section 注册
  '02-i18n.js',    // i18n：字典 + 订阅 + 拉取（方案A 外置字典）
  '03-styles.js',  // 组件级 CSS 注入 + locale/tr/fmtTime
  '04-utils.js',   // 通用小工具（纯函数）+ 翻页控件（pageSequence/Pager）
  '05-page.js',    // 记分板页面（三选项卡 + TabBar + 面板装配）
  '06-loader.js',  // useSnapshotLoader（数据加载/轮询）+ 导入导出 + 概览卡片
  '07-export.js',  // createScoreboardUi()：对外聚合导出（尾片）
];

/** 读出全部分片内容（缺片 / 未登记片直接报错，避免拼出半份产物当成功）。 */
export function readParts(order = PART_ORDER, dir = PARTS_DIR) {
  const missing = order.filter((f) => !existsSync(join(dir, f)));
  if (missing.length) throw new Error(`缺分片：${missing.join(' / ')}（先按 PART_ORDER 建齐，再构建）`);
  const extra = readdirSync(dir).filter((f) => f.endsWith('.js') && !order.includes(f));
  if (extra.length) throw new Error(`分片未登记进 PART_ORDER：${extra.join(' / ')}（未登记 = 不会进入产物，属静默丢失）`);
  return order.map((f) => readFileSync(join(dir, f), 'utf8'));
}

/** 拼接产物：**零加工**（不加头尾换行、不加分隔符）——分片自带行尾，相接即原文。 */
export function buildClient(order = PART_ORDER, dir = PARTS_DIR) {
  return readParts(order, dir).join('');
}

/** 形态铁律自检：产物第一条**语句**必须是 IIFE 或 __ModuleLoader__.load，且以调用闭合收尾。
 *  ⚠️ 首部可能连着多个块注释 + 行注释横幅（记分榜就是这样）⇒ 必须**循环剥掉所有前导注释**再判，
 *     只剥一个块注释会把行注释横幅误判成「首条语句不是入口」（2026-10-09 实测踩到）。 */
export function checkShape(code) {
  const errs = [];
  const stripped = code.replace(/^(?:\s*\/\*[\s\S]*?\*\/|\s*\/\/[^\n]*)*\s*/, '');
  if (!/^\(\(\)\s*=>\s*\{|^window\.__ModuleLoader__\.load\(/.test(stripped)) {
    errs.push('产物首条语句既不是 IIFE 包裹也不是 __ModuleLoader__.load(...)（形态铁律）');
  }
  if (!/__ModuleLoader__\.load\(/.test(code)) {
    errs.push('产物里找不到 window.__ModuleLoader__.load(...) —— 客户端入口缺失');
  }
  if (!/\)\s*;?\s*$/.test(code.trimEnd())) errs.push('产物末尾不像闭合的调用');
  return errs;
}

function main(argv = process.argv.slice(2)) {
  const checkOnly = argv.includes('--check');
  const printOnly = argv.includes('--print');
  let built;
  try {
    built = buildClient();
  } catch (e) {
    console.error(`❌ ${e.message}`);
    return 1;
  }
  const errs = checkShape(built);
  if (errs.length) {
    console.error('❌ 形态铁律自检失败：');
    for (const e of errs) console.error(`   · ${e}`);
    return 1;
  }
  if (printOnly) { process.stdout.write(built); return 0; }
  const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : '';
  if (current === built) {
    console.log(`✅ 产物与分片一致（${built.split('\n').length - 1} 行，${PART_ORDER.length} 个分片）`);
    return 0;
  }
  if (checkOnly) {
    const a = current.split('\n').length - 1;
    const b = built.split('\n').length - 1;
    console.error(`❌ 产物与分片不一致（现存 ${a} 行 / 应为 ${b} 行）——请跑 node scripts/build-client.mjs 重新生成`);
    return 1;
  }
  writeFileSync(OUT_FILE, built, 'utf8');
  console.log(`✅ 已生成 lib/client.js（${built.split('\n').length - 1} 行，${PART_ORDER.length} 个分片）`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
