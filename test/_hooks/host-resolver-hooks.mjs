/**
 * 宿主依赖解析钩子本体（由 test/host-resolver.mjs 经 module.register 加载）。
 *
 * 只处理 `@deepseek-ai/*` 前缀的裸导入：把它解析到宿主 node_modules 里的同名包
 * （读该包 package.json 的 exports/main，交给 Node 默认解析继续处理子路径）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 由 host-resolver.mjs 经 initialize(data) 注入的宿主 node_modules 绝对路径。 */
let hostModules = null;

export function initialize(data) {
  hostModules = data?.hostModules || null;
}

/** 读包入口（exports['.'] → module → main），fallback index.js。 */
function entryOf(pkgDir) {
  const pj = join(pkgDir, 'package.json');
  if (!existsSync(pj)) return join(pkgDir, 'index.js');
  try {
    const pkg = JSON.parse(readFileSync(pj, 'utf8'));
    const dot = pkg.exports && (typeof pkg.exports === 'string' ? pkg.exports : pkg.exports['.']);
    const pick = (v) => (typeof v === 'string' ? v : (v && (v.import || v.default || v.require)));
    const rel = pick(dot) || pick(pkg.exports) || pkg.module || pkg.main || 'index.js';
    return join(pkgDir, rel);
  } catch {
    return join(pkgDir, 'index.js');
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (hostModules && specifier.startsWith('@deepseek-ai/')) {
    const pkgDir = join(hostModules, specifier);
    if (existsSync(pkgDir)) return { url: pathToFileURL(entryOf(pkgDir)).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
