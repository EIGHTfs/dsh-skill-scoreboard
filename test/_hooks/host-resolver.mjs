/**
 * 测试期宿主依赖解析钩子（零依赖插件的测试方案）。
 *
 * 为什么需要：本插件是**零依赖**的 DSH 插件——`@deepseek-ai/schemastery`（配置 schema）
 * 与 `@deepseek-ai/dsh-llm`（消息构造）均由宿主运行时提供，插件仓库里不装、不链接
 * node_modules（插件仓库禁止软链接，见 no-symlink-in-plugin）。但单测直接 import
 * `lib/index.js` 时，Node 的 ESM 解析器找不到这两个包 → ERR_MODULE_NOT_FOUND。
 *
 * 做法：只在**测试进程**里注册一个解析钩子，把 `@deepseek-ai/*` 解析到宿主已安装的
 * node_modules（探测顺序：$DSH_HOST_MODULES → $DSH_HOME 下各 profile 的 node_modules →
 * 本仓上级目录）。业务代码零改动、仓库零软链接、运行时仍由宿主提供。
 *
 * 用法：node --import ./test/_hooks/host-resolver.mjs --test test/*.mjs
 */
import { register } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

/** 探测宿主 node_modules（含 @deepseek-ai 的那一层）。 */
function findHostModules() {
  const candidates = [];
  if (process.env.DSH_HOST_MODULES) candidates.push(process.env.DSH_HOST_MODULES);
  const home = process.env.DSH_HOME || join(REPO, '..', '..', '.dsh');
  for (const p of ['profiles/web/node_modules', 'profiles/node_modules', 'node_modules']) {
    candidates.push(join(home, p));
  }
  candidates.push(join(REPO, '..', '..', 'node_modules'));
  return candidates.find((p) => existsSync(join(p, '@deepseek-ai'))) || null;
}

const hostModules = findHostModules();
if (!hostModules) {
  console.warn('[host-resolver] 未找到宿主 node_modules（@deepseek-ai/*）；如无宿主依赖可忽略');
} else {
  // 钩子本体放在 test/_hooks/（不匹配 test/*.mjs，避免被 --test 当测试文件收集）。
register(pathToFileURL(join(HERE, 'host-resolver-hooks.mjs')), import.meta.url, { data: { hostModules } });
}
