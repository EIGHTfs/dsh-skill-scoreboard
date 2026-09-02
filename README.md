# dsh-skill-scoreboard — skill 使用记分板（代码级自动记录）

> 完全用代码记录 AI 实际用过哪些 skill，替代手动 `skill-scoreboard.md` 记分板。

## 功能

- **自动记录**：监听 `tools/result`，命中 `skill` 工具且执行成功即计次
- **按会话去重**：同一会话内重复加载同一 skill 只计 1 次，跨会话累加（防刷分）
- **数据持久化**：`data/skill-usage.json`（版本化 + 最近生效时间 + 会话列表），随仓库 git 管理
- **迁移旧分**：2026-08-24 手动记分板 33 个 skill 的分数已迁入（`__migrated__` 标注）

## 安装（三步曲）

1. 源码进 `profiles/node_modules/dsh-skill-scoreboard`（软链 workspace 项目）
2. `profiles/web/package.json` 的 `dependencies` 声明 `dsh-skill-scoreboard: file:./node_modules/dsh-skill-scoreboard`
3. `profiles/web/cordis.patch.yml` 的 `insert` 挂载 `skill-scoreboard` 插件

## 数据结构

```json
{
  "version": 1,
  "skills": {
    "analyze-then-confirm": { "count": 5, "lastUsedAt": "...", "sessions": ["..."] }
  }
}
```

## 使用

- 查排行/确认使用：读 `data/skill-usage.json`，按 `count` 降序
- 无需手动记分，模型每次加载 skill 自动 +1

## 版本记录

- 1.0.0：首个版本，代码级自动记录 + 旧分迁移 + 配套 skill
- 1.1.0：改听 `tools/result`。不再读不存在的 `session.events`，skill 真正执行完才记分
