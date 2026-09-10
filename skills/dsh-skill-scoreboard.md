---
name: dsh-skill-scoreboard
description: skill 使用记分板（插件 dsh-skill-scoreboard 的用法说明）：完全用代码自动记录 AI 实际用过哪些 skill，无需手动记分。同时记录两种次数：count=按会话去重，loads=每次成功加载；并记录会话维度（每个会话加载过哪些 skill、各几次）。设置页三选项卡：Skill 排行（按会话去重降序+分页）/ 会话榜（按去重 skill 数排序）/ 管理（导入导出）。数据存 DSH_HOME/.dsh/skill-scoreboard/skill-usage.json。处理「skill 用了多少次」「哪个 skill 用得多」「skill 使用统计」「记分板数据在哪」「哪个会话用过 skill」「手动记分 vs 自动记分」「导入导出记分」类场景时加载；与 skill-usage-session-log（会话留痕）、skill-cite-sources（固化必说依据）配套。
whenToUse: 需要查 skill 使用次数/热度排行、确认某 skill 是否被用过、查某会话加载过哪些 skill、了解记分板数据结构或导入导出记分数据时。
generatedBy: EIGHTfs 2026-09-02（由手动 skill-scoreboard.md 记分板升级为插件 dsh-skill-scoreboard 代码级自动记录）；2026-09-10 更新至 v1.8.0 三选项卡 + 会话榜，v1.8.1 去掉排行规则切换（固定去重降序）
---

# skill 使用记分板（dsh-skill-scoreboard 插件）

> 2026-09-02 由手动 `skill-scoreboard.md` 记分板升级为**插件代码级自动记录**；2026-09-10 v1.8.0 增加会话维度排行榜与三选项卡页面，v1.8.1 Skill 排行固定按会话去重降序。

> 核心一句话：**模型每实际加载一个 skill，插件自动记一笔**——无需 AI 手动维护。

## 一、工作原理

- **hооk 点**：监听 `tools/result`（skill 真正执行完、结果已冻结）
- **判定**：`exec.name === "skill"` 且结果非错误 → 取 `arguments.name`
- **两种次数（v1.6.0+）**：`count` 按会话去重（同会话同一 skill 只计 1，跨会话累加）；`loads` 每次成功加载都 +1。`callId` 防同一调用重复写
- **会话维度（v1.8.0+）**：顶层 `sessions` 表记录每个会话加载过哪些 skill、各几次（`loads` / `distinct` / `skills`），供会话排行榜使用
- **数据**：存 `$DSH_HOME/.dsh/skill-scoreboard/skill-usage.json`（v2 结构）
- **展示（v1.2.0+）**：只读接口 `GET /api/skill-scoreboard` 返回 skill 榜 + 会话榜 + 概览字段；浏览器半侧挂在 **设置 → 侧边栏 →「Skill 记分板」**（`settings.section` 独立页面），页面为**三选项卡**
- **导入导出（v1.5.0+）**：`GET /api/skill-scoreboard/export` 下载 JSON；`POST /api/skill-scoreboard/import?merge=true|false` 合并或整表替换（在「管理」选项卡内操作）
- **注入（v1.4.0+）**：`agent/pre-step` 与 dsh-git-push 相同时机，每个 agent 首次 step 注入一次「记分榜 Top N + 每个 skill 实际路径」（路径经 `skills` 服务解析与技能仓库/工作区扫描兜底，仅供 AI 参考；设置页 UI 不显示路径）。开关 `injectEnabled` / `injectTopN`
- **不扫会话日志**：`Session` 没有公开 `events` 字段，且 `agent/pre-step` 也发生在本步 skill 调用之前，因此记分只在 `tools/result` 发生

## 二、数据结构（v2）

```json
{
  "version": 2,
  "skills": {
    "analyze-then-confirm": { "count": 5, "loads": 8, "lastUsedAt": "2026-09-02T03:30:00.000Z", "sessions": ["session-abc", "session-def"], "callIds": ["call-1"] }
  },
  "sessions": {
    "session-abc": {
      "loads": 3,
      "distinct": 2,
      "skills": { "analyze-then-confirm": 2, "full-context-read": 1 },
      "firstUsedAt": "2026-09-02T03:00:00.000Z",
      "lastUsedAt": "2026-09-02T03:30:00.000Z"
    }
  },
  "updatedAt": "2026-09-02T03:30:00.000Z"
}
```

- `count`：按会话去重的累计次数（跨会话累加）
- `loads`：每次成功加载都 +1 的累计次数
- `sessions`（skill 记录内）：已计分的会话 id 列表（用于去重判定）
- `callIds`：已计分的工具调用 id（防同一调用重复写）
- `sessions`（顶层）：会话表；`distinct` = 该会话加载过的不同 skill 数（会话榜排序主键，越多越靠前），`skills` = 每个 skill 的加载次数
- `loadsEstimated`：v1 旧数据迁移标记（无法还原每次加载，`loads` 用 `distinct` 兜底估计）
- 旧 v1 数据在插件启动读取时自动迁移为 v2；导出/导入同样兼容 v1 体

## 三、页面（三选项卡）

设置 → 侧边栏 →「Skill 记分板」：

1. **Skill**：skill 排行，固定按会话去重次数降序；表格列 `# / skill / 去重次数 / 加载次数 / 最近使用`，去重列为高亮主列、加载列常显；列表分页（`« ‹ 页码… › »` + 每页 10/20/50 条 + 「共 N 条 · 第 p/x 页」）
2. **会话**：加载过 skill 的会话排行榜，**去重 skill 数越多越靠前**（并列按加载次数、再按最近活动）；显示会话标题（取不到则短 id）；点击标题打开该会话；`▸` 展开看该会话加载过哪些 skill；同样分页
3. **管理**：数据概览（skill 数 / 会话数 / 累计去重 / 累计加载 / 最近写入 / 数据文件路径 / v1 迁移估计提示）+ 导出 JSON + 导入 JSON（合并 / 覆盖）

## 四、使用方式

1. **查排行**：读 `skill-usage.json`，按 `count`（会话去重）降序即页面排行；想看总加载量就看同列的 `loads`，两者同时显示在同一行
2. **查会话**：设置页「会话」选项卡，或读数据文件的顶层 `sessions` 表按 `distinct` 降序
3. **AI 自动参考（v1.4.0）**：每个 agent 会话首次 step，插件自动注入「大家常用哪些 skill + 它们实际在哪」；要关掉用配置 `injectEnabled: false`，条数 `injectTopN`
4. **确认某 skill 是否用过**：查该 skill 的 `count` 是否 > 0
5. **手动维护**：正常无需手动改；如需调整（如删除误计），直接编辑数据文件对应项，或在「管理」选项卡导入一份修正后的 JSON

## 五、与旧记分板的关系

- 旧 `skill-scoreboard.md`（2026-08-24 手动记分）的 33 个 skill 分数已**迁移**进插件数据文件（历史上以 `sessions: ["__migrated__"]` 标注）
- 后续全部由插件自动累计，不再手动 +1

## 六、配套

- `skill-usage-session-log`：每个会话把加载的 skill 清单写入 `<会话id>.md`（手动留痕，与自动记分互补）
- `skill-cite-sources`：固化 skill 必说依据来源
- `any-md-is-skill`：md 即 skill 的通用规则

## 七、开发注意（踩过的坑）

- **顶层函数只能引用顶层常量**：`lib/client.js` 中 `createModule` 之外的顶层函数（如 `ensureCss`）不能引用 `createModule` 内的局部名（`name` / `ui` / `React`）。v1.8.0 重构时 `ensureCss` 引用了 `name`——在浏览器里 `name` 会落到 `window.name`（空串，**不抛错**），所以 `data-plugin-css` 被写成空串，`querySelector` 去重永不命中，每次渲染都重复插入 `<style>`（v1.8.1 修复：改用顶层常量 `NS`）；需要共享给顶层使用的 React 走模块级 `ReactRef`。
- **改前端必须做真实浏览器自检**：单测的 mock React 环境没有 `document`，会走 `ensureCss` 的提前 return 分支，测不到 DOM 注入路径（重复注入 bug 就是这样漏掉的）。做法：jsdom + 真实 react-dom 渲染出 DOM，再用 chromium `--dump-dom` 读 `getComputedStyle` 核对颜色/列高亮，并用 `--enable-logging=stderr` 抓 JS 异常。
- **jsdom 不能当作浏览器判据**：jsdom 没有 `window.name` 这类浏览器全局，同一段代码在 jsdom 抛 `ReferenceError`、在真实浏览器却照常执行——据此下"页面白屏"的结论是**误判**。凡是「浏览器里会怎样」的判断，必须在真实 chromium 里跑一遍再定论；jsdom 只用于渲染结构与样式断言。
- **宿主半侧改完要重启才生效**：`lib/index.js`（记分钩子、只读 API）的改动需重启 web profile；`lib/client.js` 可热更新。三份副本（源码仓 / `local-plugins/` / `node_modules/`）改完必须同步并用 `md5sum` 核对一致。
- **两种次数同时维护**：`count`（按会话去重）与 `loads`（每次加载）同时写入，改记分逻辑时不要只更新其中一个；`sessions` 会话表同样要同步累加。
