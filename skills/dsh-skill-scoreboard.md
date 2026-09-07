---
name: dsh-skill-scoreboard
description: skill 使用记分板（插件 dsh-skill-scoreboard 的用法说明）：完全用代码自动记录 AI 实际用过哪些 skill，无需手动记分——模型每次加载 skill 工具，插件自动累计（双计数：会话去重 count + 每次都算 alwaysCount，页面顶部切换显示），数据存插件 data/skill-usage.json。处理「skill 用了多少次」「哪个 skill 用得多」「skill 使用统计」「记分板数据在哪」「手动记分 vs 自动记分」类场景时加载；与 skill-usage-session-log（会话 skill 留痕）、skill-cite-sources（固化必说依据）配套。
whenToUse: 需要查 skill 使用次数/热度排行、确认某 skill 是否被用过、了解记分板数据来源与更新方式时。
generatedBy: EIGHTfs 2026-09-02（由手动 skill-scoreboard.md 记分板升级为插件 dsh-skill-scoreboard 代码级自动记录）
---

# skill 使用记分板（dsh-skill-scoreboard 插件）

> 2026-09-02 由手动 `skill-scoreboard.md` 记分板升级为**插件代码级自动记录**。
> 核心一句话：**模型每实际加载一个 skill，插件自动 +1——不用 AI 手动记分。**

## 一、自动记录机制

- **hook 点**：监听 `tools/result`（skill 工具真正执行完、结果已冻结）
- **判定**：`exec.name === "skill"` 且结果非错误 → 取 `arguments.name` 记 1 次
- **双计数（v1.5.0）**：`count`=会话去重（同一会话内重复加载同一 skill 只计 1 次，跨会话累加）；`alwaysCount`=每次都算（每次加载都 +1）；两种计数**同时记录**，页面顶部切换显示；`callId` 幂等防同一调用重复写
- **数据**：存插件 `data/skill-usage.json`，随仓库 git 版本管理可提交
- **展示（v1.2.0+）**：只读接口 `GET /api/skill-scoreboard` 返回按次数降序的双计数记分表；浏览器半侧 v1.3.0 起挂在 **设置 → 侧边栏 →「Skill 记分板」** 独立页面（`settings.section`），v1.5.0 起页面顶部可切换「会话去重 / 每次都算」显示
- **注入（v1.4.0）**：`agent/pre-step` 与 dsh-git-push 相同时机，每个 agent 首次 step 注入一次「记分榜 Top N + skill 实际路径」（路径经 `skills` 服务解析并兜底扫描技能仓库/工作区，仅供 AI 参考；设置页 UI 不显示路径）；配置 `injectEnabled` / `injectTopN`
- **不要扫 `session.events`**：Session 没有公开 `events` 字段；`agent/pre-step` 也发生在本步 skill 调用之前

## 二、数据结构

```json
{
  "version": 1,
  "skills": {
    "analyze-then-confirm": { "count": 5, "alwaysCount": 8, "lastUsedAt": "2026-09-02T03:30:00.000Z", "sessions": ["session-abc", "session-def"] }
  }
}
```

- `count`：累计使用次数（会话去重，跨会话累加）
- `alwaysCount`：每次都算次数（每次加载都 +1，v1.5.0）
- `lastUsedAt`：最近生效时间（ISO）
- `sessions`：已计分的会话 id 列表（用于去重判定）
- `callIds`：已计分的工具调用 id（防同一调用重复写）

## 三、使用方式

1. **查排行**：读插件 `data/skill-usage.json`，按 `count`（会话去重）或 `alwaysCount`（每次都算）降序即热度排行；设置侧边栏「Skill 记分板」页面顶部可切换显示
2. **AI 自动参考（v1.4.0）**：每个 agent 会话首次 step，插件自动注入「大家常用哪些 skill + 它们实际在哪」，无需手动查；要关掉用配置 `injectEnabled: false`，条数 `injectTopN`
3. **确认某 skill 是否用过**：查该 skill 的 `count` 是否 > 0
4. **手动维护**：正常无需手动改；如需调整（如删除误计），直接编辑数据文件对应项

## 四、与旧记分板的关系

- 旧 `skill-scoreboard.md`（2026-08-24 手动记分）的 33 个 skill 分数已**迁移**进插件数据文件（`sessions: ["__migrated__"]` 标注）
- 后续全部由插件自动累计，不再手动 +1

## 五、配套

- `skill-usage-session-log`：每个会话把加载的 skill 清单写入 `<会话id>.md`（手动留痕，与自动记分互补）
- `skill-cite-sources`：固化 skill 必说依据来源
- `any-md-is-skill`：md 即 skill 的通用规则
