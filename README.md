# dsh-skill-scoreboard

> skill 使用记分板：模型每真正加载一个 skill 就自动记分，无需手动维护 `skill-scoreboard.md`。运行时数据写在 `$DSH_HOME/.dsh/skill-scoreboard/skill-usage.json`，默认 git 忽略。v1.3.0 在**设置侧边栏**提供「Skill 记分板」页面；v1.4.0 起在 `agent/pre-step` 把记分榜与 skill 实际路径注入给 AI；v1.6.0 同时记录两种记分规则（按会话去重 / 每次加载）；v1.8.0 页面改为**三选项卡**（Skill 排行 / 会话榜 / 管理）并新增会话维度排行榜；v1.8.1 Skill 排行固定按会话去重降序（去重与加载两种次数同列显示，不再切换规则）；v1.8.2 会话榜显示**持久化会话标题**（历史会话也能解析出标题，取不到则显示短 id），记分扩展为 **read 工具直接读 skill 文件同样记分**；v1.8.3 代码质量重构（拆分长函数/降圈复杂度/提取重复字面量，行为不变）。

## 目录

- [架构设计](#架构设计)
- [文件目录结构及作用](#文件目录结构及作用)
- [启动脚本](#启动脚本)
- [API 总览](#api-总览)
- [数据结构](#数据结构)
- [页面结构（三选项卡）](#页面结构三选项卡)
- [版本列表](#版本列表)
- [注意事项](#注意事项)
- [开发计划 / 疑难杂症](#开发计划--疑难杂症)

## 架构设计

核心链路：监听 `tools/result` → skill 工具执行成功后记分 → 落盘 → 宿主只读 API → 设置页展示；另在 `agent/pre-step` 注入记分榜给 AI。

- **判定**：`exec.name === "skill"`，从 `arguments.name` 取 skill 名；结果带 `isError` 的不计分。
- **两种次数**：`count` 按会话去重（同会话同一 skill 只计 1，跨会话累加）；`loads` 每次成功加载都 +1；`callId` 防同一调用重复写。
- **会话表（v1.8.0）**：记分时同步写顶层 `sessions` 表（`{ [sessionId]: { loads, distinct, skills, firstUsedAt, lastUsedAt } }`），记录**该会话加载过哪些 skill、各几次**，供会话榜使用。
- **路径解析**：注入时经 `skills` 服务（`get()` / `list()` 的 `path` / `resourceBase`）解析 skill 实际文件路径，失败则扫描 `ai-work-archive/skills/`、插件 `skills/`、`.dsh/skills/` 等目录兜底；设置页 UI 不显示路径。
- **展示**：宿主端 `GET /api/skill-scoreboard` 只读接口（返回 skill 榜 + 会话榜 + 概览字段）+ 浏览器半侧挂 **设置 → 侧边栏 →「Skill 记分板」**（`settings.section` 独立页面，三个选项卡）。
- **注入（v1.4.0+）**：`agent/pre-step` 事件（与 dsh-git-push 相同时机），每个 agent 首次 step 注入一次：记分榜 Top N（含会话去重 / 加载两种次数）+ 每个 skill 的**实际文件路径**。开关 `injectEnabled`、条数 `injectTopN`。
- **不扫会话日志**：`Session` 没有公开 `events` 字段，且 `agent/pre-step` 发生在本步 `skill` 调用之前，扫日志会漏记——因此记分只在 `tools/result` 发生。

```
skill 工具执行成功
    ↓
tools/result 事件
    ↓
name === "skill" 且结果非错误
    ↓
skill-usage.json（skills 榜 + sessions 会话表）
    ←── GET /api/skill-scoreboard（宿主只读接口）
    ↓
设置侧边栏「Skill 记分板」三选项卡页面（浏览器）
    ↓
agent/pre-step（每个 agent 首次 step）
    ↓
记分榜 Top N + skill 实际路径 注入给 AI
```

## 文件目录结构及作用

| 路径 | 作用 |
|---|---|
| `lib/index.js` | 插件入口：`apply` 监听 `tools/result`，同时记 `count`（会话去重）、`loads`（每次加载）与 `sessions` 会话表；注册 `GET /api/skill-scoreboard`（含会话榜）与 export/import；`agent/pre-step` 注入记分榜 + skill 实际路径 |
| `lib/store.js` | 宿主半侧 · 数据层（1.0.2 从 `index.js` 拆出）：读 `saveData`（临时文件 + rename 原子写）/ 归一化 `normalizeScoreboardPayload` / 合并 `mergeScoreboard` / 记分 `recordSkillUse`·`recordSessionUse` |
| `lib/skillpath.js` | 宿主半侧 · 路径解析（1.0.2 拆出）：「skill 名 ↔ 实际文件路径」双向解析——`resolveSkillPath`（先问 skills 服务、失败扫文件系统兜底）与 `makeSkillPathIndex`（懒构建 + TTL 的路径索引，供 `read` 工具直接读 skill 文件记分） |
| `lib/titles.js` | 宿主半侧 · 会话标题（1.0.2 拆出）：四级取标题（活跃会话快照 → 折叠日志 `session/title` 事件 → cwd 目录名 → 短 id 兜底），限并发 + 落盘缓存 `session-titles.json` + `warm` 预热 |
| `lib/routes.js` | 宿主半侧 · HTTP 路由（1.0.1 拆出）：`GET /api/skill-scoreboard` 与 export/import 端点 |
| `lib/util.js` | 通用小工具（1.0.1 拆出）：`createSemaphore` / `shortIdOf` / `errMsg` 等零依赖助手 |
| `lib/client.js` | 浏览器半侧：注册 `settings.section` 侧边栏「Skill 记分板」+ 三选项卡页面（Skill 排行 / 会话榜 / 管理），排行分页、会话标题解析与打开会话、导入导出，中英双语 |
| `cordis.patch.yml` | bundle patch：insert `id: skill-scoreboard` |
| `skills/dsh-skill-scoreboard.md` | 插件手册 skill |
| `test/test-scoreboard.mjs` | 宿主半侧单测：记分去重 + 会话表 + v1→v2 迁移 + API/导入导出（mock ctx + 临时数据文件） |
| `test/test-client.mjs` | 前端冒烟测试：最小 React 替身渲染三选项卡、翻页、分页、会话展开、管理页 |
| `test/_hooks/host-resolver.mjs` | 测试期宿主依赖解析钩子（零依赖方案）：把 `@deepseek-ai/*` 裸导入解析到宿主已装的 node_modules，使单测能 import `lib/index.js`——仓库不需装依赖、不需软链接 |
| `$DSH_HOME/.dsh/skill-scoreboard/skill-usage.json` | 运行时记分数据（git 忽略，不入库） |
| `package.json` | 包名 / 版本 / `dsh.bundle.patch` / `dsh.skills` / `dsh.client` / `files`+`repository` 等 npm 发布元数据 |
| `.npmignore` | npm pack 排除规则：`*.bak` / `.trash/` / 锁文件（`npm pack --dry-run` 验证 6 文件入库） |

## 启动脚本

本插件随 DSH web profile 装载，没有独立进程，也没有 `start.sh`。

```bash
# 1) 源码进 profile（真实目录拷贝，不要软链到无 node_modules 的源码目录）
cp -a ./dsh-skill-scoreboard profiles/web/local-plugins/dsh-skill-scoreboard

# 2) package.json 声明 file: 依赖，并写入 dsh.profile.bundles
#    "dsh-skill-scoreboard": "file:./local-plugins/dsh-skill-scoreboard"

# 3) cordis.patch.yml insert
#    - insert:
#        - id: skill-scoreboard
#          name: dsh-skill-scoreboard
#          config:
#            enabled: true

# 4) dry-run：能 import，且导出 name / inject / apply
cd profiles/web
node --input-type=module -e 'import * as m from "dsh-skill-scoreboard"; console.log(m.name, m.inject, typeof m.apply)'

# 5) 自测（零依赖：宿主依赖经 test/_hooks/ 解析钩子注入，仓库内不装 node_modules）
node --import ./test/_hooks/host-resolver.mjs --test test/*.mjs   # 两套单测一起跑
node --import ./test/_hooks/host-resolver.mjs test/test-scoreboard.mjs   # 宿主半侧
node --import ./test/_hooks/host-resolver.mjs test/test-client.mjs       # 前端渲染冒烟

# 6) 改 patch / 插件代码（宿主半侧）后重启 web profile 才会加载新 hооk；
#    只改 lib/client.js 可用 clientModules.rebuilt('dsh-skill-scoreboard') 热刷新（免重启）
```

启动成功时进程日志：

```
[skill-scoreboard] ✅ 已启动，数据文件: …/.dsh/skill-scoreboard/skill-usage.json，当前记录 N 个 skill
[skill-scoreboard] ✅ 已注册 GET /api/skill-scoreboard + export/import
```

## API 总览

记分在 `tools/result` 上自动发生；v1.2.0 起提供只读查询 API 供设置页使用；v1.8.0 起返回体带会话榜。

| 入口 | 说明 |
|---|---|
| `tools/result` | 观察 skill 工具最终结果记分；**v1.8.2 起 read 工具直接读 skill 文件路径同样记分**（同步更新 skill 榜与会话表） |
| `GET /api/skill-scoreboard` | 只读：返回 `{ok, total, totalLoads, recorded, updatedAt, dataFile, skills:[…], sessions:[…]}`。`skills` 按 `count` 降序（最多 200 条），`sessions` 按 `distinct` 降序（并列按 `loads`、再按 `lastUsedAt`，最多 200 条）；v1.8.2 起每行带 `title`（宿主解析的持久化会话标题，兜底短 id） |
| `GET /api/skill-scoreboard/export` | 导出完整记分 JSON（`version:2 / skills / sessions / updatedAt / exportedAt`） |
| `POST /api/skill-scoreboard/import?merge=true\|false` | 导入记分 JSON；默认 merge 累加合并（含会话表），`merge=false` 整表替换。v1 旧格式（无 `sessions`）自动反推会话表 |
| 配置 `enabled` | `false` 时不挂监听 |
| 配置 `dataFile` | 覆盖默认数据路径（默认 `$DSH_HOME/.dsh/skill-scoreboard/skill-usage.json`） |
| 配置 `injectEnabled`（v1.4.0） | `false` 时不注入记分榜（默认 true） |
| 配置 `injectTopN`（v1.4.0） | 注入 Top N 个 skill 及路径（默认 25） |

## 数据结构

v1.8.0 起为 **v2**：在 v1 的 `skills` 之外新增顶层 `sessions` 会话表。

```json
{
  "version": 2,
  "skills": {
    "dsh-restart-gate": {
      "count": 2,
      "loads": 3,
      "lastUsedAt": "2026-09-10T08:57:00.000Z",
      "sessions": ["session-<uuid>"],
      "callIds": ["call-0296d410-70b8-4e49-896a-2ce906ea8993-174"]
    }
  },
  "sessions": {
    "session-<uuid>": {
      "loads": 3,
      "distinct": 2,
      "skills": { "dsh-restart-gate": 2, "full-context-read": 1 },
      "firstUsedAt": "2026-09-10T08:50:00.000Z",
      "lastUsedAt": "2026-09-10T08:57:00.000Z"
    }
  },
  "updatedAt": "2026-09-10T08:57:00.000Z"
}
```

- `skills[name].count`：按会话去重的累计次数（跨会话累加）
- `skills[name].loads`：每次成功加载都 +1 的累计次数
- `skills[name].sessions`：已计分的会话 id 列表（用于去重判定）
- `skills[name].callIds`：已计分的工具调用 id（防同一调用重复写）
- `sessions[id].loads`：该会话加载 skill 的总次数
- `sessions[id].distinct`：该会话加载过的**不同** skill 数（会话榜排序主键，越多越靠前）
- `sessions[id].skills`：该会话每个 skill 的加载次数（会话行展开时展示）
- `sessions[id].loadsEstimated`：v1 迁移估计标记（旧数据无法还原每次加载，`loads` 用 `distinct` 兜底）

> **v1 → v2 迁移**：读取旧文件时自动迁移（v1 只有 `skills[].sessions[]`，反推出会话表；`distinct` 准确、`loads` 为估计值并标记 `loadsEstimated`），下次写盘即为 v2。
>
> **注意**：数据文件默认路径为 `$DSH_HOME/.dsh/skill-scoreboard/skill-usage.json`（非插件源码目录下的 `data/skill-usage.json`）。可通过配置项 `dataFile` 覆盖路径。

查排行：

```bash
# 默认路径
python3 - <<'PY'
import json
from pathlib import Path
p = Path.home() / '.dsh' / 'skill-scoreboard' / 'skill-usage.json'
if not p.exists():
    p = Path('/vol2/1000/DeepSeek runtime/dsh-v0.1.2-alpha.4/.dsh-home/.dsh/skill-scoreboard/skill-usage.json')
d = json.loads(p.read_text())
rows = sorted(d.get("skills", {}).items(), key=lambda kv: kv[1].get("count", 0), reverse=True)
for name, rec in rows[:10]:
    print(rec.get("count", 0), rec.get("loads", 0), name, rec.get("lastUsedAt"))
# 会话榜
sess = sorted(d.get("sessions", {}).items(), key=lambda kv: kv[1].get("distinct", 0), reverse=True)
for sid, rec in sess[:10]:
    print(rec.get("distinct", 0), rec.get("loads", 0), sid)
PY
```

最小配置：

```yaml
- insert:
    - id: skill-scoreboard
      name: dsh-skill-scoreboard
      config:
        enabled: true
        # dataFile: /path/to/skill-usage.json
        # injectEnabled: true
        # injectTopN: 25
```

## 页面结构（三选项卡）

设置 → 侧边栏 →「Skill 记分板」，仿插件市场的顶部选项卡：

| 选项卡 | 内容 |
|---|---|
| **Skill** | skill 使用排行，固定按**会话去重**次数降序（并列按名称）。表格列 `# / skill / 去重次数 / 加载次数 / 最近使用`，去重列为高亮主列、加载列常显；列表分页（`« ‹ 页码… › »` + 每页 10/20/50 条 + 「共 N 条 · 第 p/x 页」） |
| **会话** | 加载过 skill 的会话排行榜。按 `distinct`（去重 skill 数）降序，**越多越靠前**，并列按 `loads`、再按最近活动；行显示会话标题（v1.8.2：宿主依次经活跃 `sessions` 快照 `displayTitle` → 持久化日志 `session/title` 事件 → 工作目录名 → 短 id 解析；历史会话也能出标题，不再一律「无标题」）与短 id、去重数、加载数、最近活动；点击标题可打开该会话；行首 `▸` 展开显示该会话加载过的 skill；同样分页 |
| **管理** | 数据概览（skill 数 / 会话数 / 累计去重 / 累计加载 / 最近写入 / 数据文件路径 / v1 迁移估计提示）+ 导出 JSON + 导入 JSON（合并 / 覆盖两种模式）+ 顶部刷新 |

## 版本列表

| 版本 | 内容 |
|------|------|
| 1.0.2 | **宿主半侧按职责拆分为独立模块**（`lib/index.js` 从 1100+ 行降到 347 行；行为不变、110 条断言全通过）：`lib/store.js`（数据层：原子写 / 归一化 / 合并 / 记分）、`lib/skillpath.js`（skill 名 ↔ 实际路径双向解析 + 懒构建 TTL 索引）、`lib/titles.js`（四级取会话标题 + 限并发 + 落盘缓存 + 预热）从入口拆出；入口只保留 `apply` 接线与注入。拆分后每个模块单一职责、均不反向依赖 `index.js`，README 结构表同步 |
| 1.0.1 | 重建历史为单提交：记分板插件全量审计 + 代码质量重构（行为不变）。**文案 i18n 化**（zh.json / en.json 两份 JSON 由 `lib/i18n/` 提供，客户端 `require` 读取，不再硬编码中文串）；**零依赖**（package.json 仅保留宿主提供的 schemastery / dsh-llm 作为 peer，移除 node_modules 实体，安装不留依赖树）；**结构拆分**（`lib/routes.js` HTTP 路由、`lib/util.js` 通用小工具从 `lib/index.js` 拆出）；改名去模糊（`data`→`payload`/`store`、`tmp`→`tmpFile`、`obj`→`parsed`/`cacheMap`）、重复字面量与超时/排序魔数提取为具名常量、空 `catch` 全部补说明注释；审计 **0 blocker / 0 warning 拦截项，91 分 A**（可读性 6 / 可维护性 12，其余八维满分）；新增 .test 测试豁免；README 措辞清理 |
| 1.8.4 | **测试归位 test/ 目录 + 审计跳过**：单测文件移入 `test/`（相对引用同步改为 `../lib/`），test 目录放 `.test` 空文件标记——内置 code_audit 扫描自动跳过该目录（`test/**` 的重复字面量/魔数等噪音不再计入评分，扫描 finding 从 272 降到 197）；README 测试路径同步更新 |
| 1.8.3 | **代码质量重构（行为不变）**：按 code_audit 全量扫描结论拆分长函数与高圈复杂度函数——`normalizeScoreboardPayload`（复杂度 12）与 `mergeScoreboard`（12）拆为子表函数（`normalizeSkillsTable` / `normalizeSessionsTable` / `mergeSkillTables` / `mergeSessionTables`），`makeTitleResolver`（41→31）拆出 `titleFromSessionSnapshot` / `titleFromInspect` / `cachedTitle`，`ScoreboardPage`（18→11）拆出 `snapshotToState` / `badgeFor` / `panelHeadRow` / `panelBody`；提取重复字面量为帮助函数 `isPlainObject` / `num0` / `emptyV2` / `errMsg`；全部 110 条断言（test-scoreboard 80 + test-client 30）通过，安全性/性能/测试覆盖三维保持满分 |
| 1.8.2 | **会话标题 + read 直接读文件记分**：会话榜此前全部显示「无标题会话」——根因是 client 侧 `sessions.list` 只含活跃会话、历史会话查不到标题。改为宿主半侧解析标题注入 API：①活跃会话快照 `displayTitle` → ②`sessionPersistence.inspect` 读日志折叠 `session/title` 事件（与 dsh-session-conductor 同法）→ ③`cwd` 目录名 → ④短 id 兜底；**性能修复**：标题解析限并发（同时最多 2 个 inspect）+ 结果落盘缓存 `session-titles.json` + apply 后后台预热，API 首响应从实测 8.8s 降到毫秒级（原实现对所有会话并发解压 zstd 日志）。**稳定性修复**：管理页曾引用其作用域外的 `skillRows`（ManagePanel 为顶层函数而非 ScoreboardPage 内部函数），数据未加载（`state.recorded=0`）时点「管理」tab 会求值该未定义变量 → ReferenceError → settings.section 无错误边界 → 整个设置面板消失；已移除该死引用，加载中点管理不再崩。记分扩展：`tools/result` 中 `read` 工具若 `file_path` 命中已知 skill 文件路径（懒构建路径索引，TTL 5min）同样记一次分——AI 直接读 skill 文件 = 加载。`buildSnapshot` 变异步注入 title；两套测试各补 read 记分 / 标题解析断言 |
| 1.8.1 | **Skill 排行去掉规则切换**：两种次数本就同列显示、切换选项只改高亮，故移除「按会话去重 / 按全部加载」二级选项及其描述，固定按会话去重降序；同步精简 `sortSkillRows` 与 subTab 样式。**修复样式重复注入**：`ensureCss` 在 v1.8.0 重构后引用了不在其作用域内的 `name`（浏览器里解析为 `window.name`，值为空串），于是 `data-plugin-css` 被写成空串、去重查询永不命中，每次渲染都往 `<head>` 重复插入一份 `<style>`；改用顶层常量 `NS` 后只注入一次。`test-client.mjs` 补该 DOM 注入路径的回归断言 |
| 1.8.0 | **三选项卡 + 会话榜**：页面改仿插件市场的顶部选项卡「Skill / 会话 / 管理」；Skill 内两种排行（去重 / 全部加载）改为二级翻页并支持分页；新增会话维度排行榜（按去重 skill 数降序，可展开看该会话加载过的 skill，可打开会话）；管理页收纳导入导出。数据升级 **v2**：新增顶层 `sessions` 会话表（记分时同步记录会话 id 与每个 skill 的加载次数），旧 v1 数据启动时自动迁移；API 返回会话榜与概览字段；新增 `test-client.mjs` 前端冒烟测试 |
| 1.7.0 | 设置页显示模式改为下拉列表选择（按会话去重 / 每次加载 / 全部），导入支持合并 / 覆盖模式选择 |
| 1.6.0 | **两种记分规则可切换**：同时记录 `count`（按会话去重）与 `loads`（每次成功加载）；设置页可切换展示。注入文本同时带两种次数，并扫描兜底解析 skill 实际文件路径（`skills.get().path` 为空时仍能给出路径） |
| 1.5.0 | **导入导出记分文件 + 自动建目录**：设置页「导出 / 导入」；`GET /api/skill-scoreboard/export` 下载 JSON；`POST /api/skill-scoreboard/import?merge=true\|false` 合并或整表替换。数据文件父目录不存在时 `mkdir` 再建，避免首次写失败 |
| 1.4.0 | **agent/pre-step 注入**：与 dsh-git-push 相同时机，每个 agent 首次 step 注入记分榜 Top N（次数降序）+ 每个 skill 的**实际文件路径**（经 `skills` 服务与技能仓库/工作区扫描解析，供 AI 参考；设置页 UI 不显示路径）；配置 `injectEnabled` / `injectTopN` |
| 1.3.0 | **设置侧边栏页面**：浏览器半侧改挂 `settings.section`（设置 → 侧边栏 →「Skill 记分板」独立页面：按次数降序、刷新、空态/错误态、中英双语跟随当前语言），不再占插件配置页卡片位 |
| 1.2.0 | **设置页记分卡**：新增 `GET /api/skill-scoreboard` 只读查询 API + `lib/client.js` 设置卡（设置 → 插件配置 →「Skill 记分榜」；dsh.client web bundle 注入） |
| 1.1.1 | 按 git-push README 模板重写文档；GitHub About 改为插件一句话说明 |
| 1.1.0 | 改听 `tools/result`。不再读不存在的 `session.events`，skill 真正执行完才记分 |
| 1.0.0 | 代码级自动记录；旧手动记分板分数迁入；配套 skill；运行时数据 git 忽略 |

## 注意事项

- 运行时数据默认不入库（`.gitignore` 含 `data/skill-usage.json`）。公开仓库不要把记分文件提交进去。
- 软链到无 `node_modules` 的源码目录会导致 ESM 解析 `@deepseek-ai/schemastery` 失败，用真实目录拷贝。
- 改 `lib/index.js` 或 patch 后必须重启 web profile，当前进程不会热加载这段 hооk；只改 `lib/client.js` 可用 `clientModules.rebuilt('dsh-skill-scoreboard')` 免重启热刷。
- 只统计工具名 `skill` 的成功调用。失败的 skill 加载不计分。
- 同一会话重复加载同一 skill：`count` 只计 1 次，`loads` 每次成功加载都 +1；会话表按每次加载累计。
- 会话榜的会话标题依赖宿主客户端 `sessions` 服务（`ctx.get('sessions')`）。服务不可用时只显示短 id，页面功能不受影响。
- v1 旧数据迁移出的会话 `loads` 是估计值（等于 `distinct`），管理页会提示；后续新记分即为真实值。

## 开发计划 / 疑难杂症

- [x] HTTP 只读接口：按 `count` 返回排行，不必直接读 JSON（v1.2.0 已实现为 GET /api/skill-scoreboard）
- [x] 设置侧边栏独立页面（v1.3.0：settings.section「Skill 记分板」，替代插件配置页卡片）
- [x] 会话维度排行榜（v1.8.0：顶层 `sessions` 表 + 会话选项卡）
- [x] 观察点从 `agent/pre-step` + `session.events` 改为 `tools/result`
- [ ] 数据文件放到 profile 数据目录，避免装在 `node_modules` 里被 `pnpm install` 清掉
- [ ] 会话榜按子代理会话（`agent.id` 兜底产生的裸 uuid）单独标注来源
