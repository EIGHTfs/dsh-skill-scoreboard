# dsh-skill-scoreboard

> skill 使用记分板：模型真正加载 skill 工具后，按会话去重自动累计次数。替代手动 `skill-scoreboard.md`。运行时数据写在 `data/skill-usage.json`，默认 git 忽略。

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
- **去重**：同一会话同一 skill 只计 1 次；`callId` 防同一调用重复写。
- **持久化**：原子写 `data/skill-usage.json`（临时文件 + rename）。
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
data/skill-usage.json
```

## 文件目录结构及作用

| 路径 | 作用 |
|---|---|
| `lib/index.js` | 插件入口：`apply` 监听 `tools/result`，读写记分数据 |
| `cordis.patch.yml` | bundle patch：insert `id: skill-scoreboard` |
| `skills/dsh-skill-scoreboard.md` | 插件手册 skill |
| `data/skill-usage.json` | 运行时记分数据（git 忽略，不入库） |
| `package.json` | 包名 / 版本 / `dsh.bundle.patch` / `dsh.skills` |

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

# 5) 改 patch / 插件代码后重启 web profile 才会加载新 hook
```

启动成功时进程日志：

```
[skill-scoreboard] ✅ 已启动，数据文件: …/dsh-skill-scoreboard/data/skill-usage.json，当前记录 N 个 skill
```

## API 总览

本插件不注册 HTTP API，也不注册 agent 工具。记分在 `tools/result` 上自动发生。

| 入口 | 说明 |
|---|---|
| `tools/result` | 观察 skill 工具最终结果并记分 |
| `data/skill-usage.json` | 读排行：按 `count` 降序 |
| 配置 `enabled` | `false` 时不挂监听 |
| 配置 `dataFile` | 覆盖默认数据路径 |

数据结构：

```json
{
  "version": 1,
  "skills": {
    "dsh-restart-gate": {
      "count": 1,
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
| 1.1.1 | 按 git-push README 模板重写文档；GitHub About 改为插件一句话说明 |
| 1.1.0 | 改听 `tools/result`。不再读不存在的 `session.events`，skill 真正执行完才记分 |
| 1.0.0 | 代码级自动记录；旧手动记分板分数迁入；配套 skill；运行时数据 git 忽略 |

## 注意事项

- 运行时数据默认不入库（`.gitignore` 含 `data/skill-usage.json`）。公开仓库不要把记分文件提交进去。
- 软链到无 `node_modules` 的源码目录会导致 ESM 解析 `@deepseek-ai/schemastery` 失败，用真实目录拷贝。
- 改 `lib/index.js` 或 patch 后必须重启 web profile，当前进程不会热加载这段 hook。
- 只统计工具名 `skill` 的成功调用。失败的 skill 加载不计分。
- 同一会话重复加载同一 skill 只计 1 次。

## 开发计划 / 疑难杂症

- [ ] HTTP 只读接口：按 `count` 返回排行，不必直接读 JSON
- [ ] 数据文件放到 profile 数据目录，避免装在 `node_modules` 里被 `pnpm install` 清掉
- [x] 观察点从 `agent/pre-step` + `session.events` 改为 `tools/result`
