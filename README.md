# dsh-skill-scoreboard

> skill 使用记分板：模型真正加载 skill 工具后自动累计次数。替代手动 `skill-scoreboard.md`。运行时数据写在 `data/skill-usage.json`，默认 git 忽略。v1.3.0 在**设置侧边栏**提供「Skill 记分板」页面；v1.4.0 起在 `agent/pre-step` 把记分榜与 skill 实际路径注入给 AI；v1.6.0 同时记录两种记分规则（按会话去重 / 每次加载），设置页可切换。

## 目录

- [架构设计](#架构设计)
- [文件目录结构及作用](#文件目录结构及作用)
- [启动脚本](#启动脚本)
- [API 总览](#API-总览)
- [版本列表](#版本列表)
- [注意事项](#注意事项)
- [开发计划 / 疑难杂症](#开发计划--疑难杂症)

## 架构设计

- **观察点**：`tools/result`。skill 工具执行成功、结果冻结后再记分。
- **判定**：`exec.name === "skill"`，从 `arguments.name` 取 skill 名。
- **两种记分（v1.6.0）**：`count` 按会话去重（同会话同一 skill 只计 1，跨会话累加）；`loads` 每次成功加载都 +1。`callId` 防同一调用重复写。
- **持久化**：原子写 `data/skill-usage.json`（临时文件 + rename）。
- **展示**：宿主端 `GET /api/skill-scoreboard` 只读接口 + 浏览器半侧挂 **设置 → 侧边栏 →「Skill 记分板」**（`settings.section` 独立页面，可切换两种记分规则）。
- **注入（v1.4.0+）**：`agent/pre-step` 事件（与 dsh-git-push 相同时机），每个 agent 首次 step 注入一次：记分榜 Top N（含会话去重/加载两种次数）+ 每个 skill 的**实际文件路径**（优先 `skills` 服务 `get()` 的 `path`/`resourceBase`，其次扫描技能仓库 `ai-work-archive/skills/`、工作区各项目 `skills/`、用户级 `.dsh/skills/`；路径只注入给 AI，设置页 UI 不显示）。开关 `injectEnabled`、条数 `injectTopN`。
- **不扫会话日志**：`Session` 没有公开 `events` 字段。`agent/pre-step` 发生在本步 `skill` 调用之前，会漏记。

```
skill 工具执行
    ↓
tools/result（冻结结果）
    ↓
name === "skill" 且非错误
    ↓
按 sessionId / callId 去重
    ↓
data/skill-usage.json  ←── GET /api/skill-scoreboard（宿主）
    │                       ↓
    │             设置侧边栏「Skill 记分板」页面（浏览器）
    ↓
agent/pre-step（每个 agent 首次 step）
    ↓
记分榜 Top N + skill 实际路径 注入给 AI（v1.4.0）
```

## 文件目录结构及作用

| 路径 | 作用 |
|---|---|
| `lib/index.js` | 插件入口：`apply` 监听 `tools/result`，同时记 `count`（会话去重）与 `loads`（每次加载）；注册 `GET /api/skill-scoreboard`；`agent/pre-step` 注入记分榜 + skill 实际路径 |
| `lib/client.js` | 浏览器半侧：注册 `settings.section` 侧边栏「Skill 记分板」+ 独立页面（v1.6.0 可切换两种记分规则；刷新、空态/错误态、中英双语） |
| `cordis.patch.yml` | bundle patch：insert `id: skill-scoreboard` |
| `skills/dsh-skill-scoreboard.md` | 插件手册 skill |
| `test-scoreboard.mjs` | 单测：记分去重 + API 输出（mock ctx + 临时数据文件） |
| `data/skill-usage.json` | 运行时记分数据（git 忽略，不入库） |
| `package.json` | 包名 / 版本 / `dsh.bundle.patch` / `dsh.skills` / `dsh.client` |

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

# 5) 改 patch / 插件代码（宿主半侧）后重启 web profile 才会加载新 hook；
#    只改 lib/client.js 可用 clientModules.rebuilt('dsh-skill-scoreboard') 热刷新（免重启）
```

启动成功时进程日志：

```
[skill-scoreboard] ✅ 已启动，数据文件: …/dsh-skill-scoreboard/data/skill-usage.json，当前记录 N 个 skill
[skill-scoreboard] ✅ 已注册 GET /api/skill-scoreboard（设置页记分卡）
```

## API 总览

记分在 `tools/result` 上自动发生；v1.2.0 起提供只读查询 API 供设置页使用。

| 入口 | 说明 |
|---|---|
| `tools/result` | 观察 skill 工具最终结果并记分 |
| `GET /api/skill-scoreboard` | 只读：按 `count` 降序返回 `{ok, total, totalLoads, recorded, updatedAt, skills:[{name,count,loads,lastUsedAt}]}`（最多 200 条）；供设置页切换两种记分规则 |
| `GET /api/skill-scoreboard/export` | 导出完整记分 JSON（`version/skills/updatedAt/exportedAt`） |
| `POST /api/skill-scoreboard/import?merge=true\|false` | 导入记分 JSON；默认 merge 累加，`merge=false` 整表替换 |
| `data/skill-usage.json` | 读排行：按 `count` 降序 |
| 配置 `enabled` | `false` 时不挂监听 |
| 配置 `dataFile` | 覆盖默认数据路径 |
| 配置 `injectEnabled`（v1.4.0） | `false` 时不注入记分榜（默认 true） |
| 配置 `injectTopN`（v1.4.0） | 注入 Top N 个 skill 及路径（默认 25） |

数据结构：

```json
{
  "version": 1,
  "skills": {
    "dsh-restart-gate": {
      "count": 1,
      "loads": 1,
      "lastUsedAt": "2026-09-02T23:54:54.764Z",
      "sessions": ["session-3e38b192-cca9-4181-bc8d-96a750635347"],
      "callIds": ["call-0296d410-70b8-4e49-896a-2ce906ea8993-174"]
    }
  }
}
```

查排行：

```bash
python3 - <<'PY'
import json
from pathlib import Path
p = Path("data/skill-usage.json")
d = json.loads(p.read_text())
rows = sorted(d.get("skills", {}).items(), key=lambda kv: kv[1].get("count", 0), reverse=True)
for name, rec in rows[:10]:
    print(rec.get("count", 0), name, rec.get("lastUsedAt"))
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
```

## 版本列表

| 版本 | 内容 |
|------|------|
| 1.6.0 | **两种记分规则可切换**：同时记录 `count`（按会话去重）与 `loads`（每次成功加载）；设置页「按会话去重 / 每次加载」切换展示。注入文本同时带两种次数，并扫描兜底解析 skill 实际文件路径（`skills.get().path` 为空时仍能给出路径） |
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
- 改 `lib/index.js` 或 patch 后必须重启 web profile，当前进程不会热加载这段 hook；只改 `lib/client.js` 可用 `clientModules.rebuilt('dsh-skill-scoreboard')` 免重启热刷。
- 只统计工具名 `skill` 的成功调用。失败的 skill 加载不计分。
- 同一会话重复加载同一 skill：`count` 只计 1 次，`loads` 每次成功加载都 +1。设置页可切换展示。

## 开发计划 / 疑难杂症

- [x] HTTP 只读接口：按 `count` 返回排行，不必直接读 JSON（v1.2.0 已实现为 GET /api/skill-scoreboard）
- [x] 设置侧边栏独立页面（v1.3.0：settings.section「Skill 记分板」，替代插件配置页卡片）
- [ ] 数据文件放到 profile 数据目录，避免装在 `node_modules` 里被 `pnpm install` 清掉
- [x] 观察点从 `agent/pre-step` + `session.events` 改为 `tools/result`