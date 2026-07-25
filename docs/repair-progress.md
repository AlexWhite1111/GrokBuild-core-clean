# Session Projection Repair Progress

最后更新：2026-07-25

## 恢复工作方式

上下文压缩或重新进入项目后：

1. 阅读 `AGENTS.md` 和 `docs/session-projection-rules.md`；
2. 从本文件第一个未完成批次继续；
3. 先运行该批次已列验证，再修改；
4. 完成后记录改动、测试和下一步。

## 批次

- [x] P0：完成全库审查和针对性复现。
- [x] P0：建立独立桌面工作副本与规范边界。
- [x] P1：拆分前台回合/后台工作动作能力。
- [x] P1：增加 projection epoch，修复 retire/resume revision。
- [x] P2：统一 disk/live context，修复 child session 与 tool update。
- [x] P3：修复 Goal 历史、计时、Plan 官方边界和源码锁。
- [x] P4：接通 Diagnostics/媒体引用，删除孤儿和空壳。
- [x] P5：完成 parity 回归、全量测试、构建和架构检查。
- [x] P6：补齐 child reverse request、turn identity、Goal 边界、Plan 草稿身份和 inline media 恢复。

## 已确认不变量

- disk restore 与 live replay 必须等价。
- 后台工作不能阻止新的前台 Send。
- UI 可见动作必须能被后端执行。
- Goal/Plan/tool 历史不得用单槽位覆盖。
- 子会话不进入主列表，但必须能按 session id 打开。

## 当前状态

- 工作目录：`/Users/alexwhite/Desktop/GrokBuild-core-clean-20260725`
- 原始 ZIP 未修改。
- P6 已完成；只处理了已确认会导致死锁、错绑或恢复丢失的小型正确性问题。
- 已删除重复的 `TaskActivityTracker`，工作计数和 Context 共用 `projectTaskWorkState`。
- disk restore 直接使用共享 Context projector；child session 和 partial tool update 回归通过。
- Goal append-only、计时和 stored Goal 源码锁已完成；Plan 只修官方可恢复路径，不增加影子存储。
- Diagnostics 改为从现有投影按需聚合；媒体引用从现有消息/事件恢复。
- 已删除 `RuntimeScheduler.ts`、`hasUnresolvedUserDelivery`、`mediaIdsInUse`、`rewindFrom` 空壳。
- Plan reverse request 不增加本地影子存储；只有官方 Session 已持久化的 Plan 信息参与恢复。
- child permission/question/Plan reverse request 共用现有 Gate 队列，并保留 parent/child scope。
- turn 终态只按 request/prompt/turn identity 关闭；多活跃回合且无身份时不猜测。
- Goal 支持显式空 objective、首个原生 goal id 和 elapsed 重启边界；无 objective 的 active/paused Goal 仍可控制。
- 较早命令的完成态不会覆盖仍在运行的较新命令摘要。
- Plan 草稿按 task + gate + 完整内容 hash 隔离；inline media 可从官方更新恢复稳定 identity。

## 最终验证

- `npm run typecheck`：通过。
- `npm run test:segmentation`：94 / 94 通过。
- `npm run test:task-runtime`：81 / 81 通过。
- `npm run build`：Web、Server、Electron Shell 通过。
- `npm run architecture`：通过；无未使用代码，重复率 0.11%。
- `npm audit --omit=dev`：生产依赖 0 个漏洞。

## 维护入口

所有批次已完成。后续修改先补回归证据；不要引入 TaskPatch、第二事实源、Plan 影子持久化或无实证的大型重构。
