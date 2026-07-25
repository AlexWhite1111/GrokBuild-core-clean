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
- [x] P7：修复 Goal 实时漏投影、历史 Plan 误判和恢复权限锁定。
- [x] P8：修复 busy Goal 控制、桌面重启恢复、延迟消息分裂和 Goal 子代理漏投影。
- [x] P9：用首个官方 `goal_updated` 完成 Goal 提交回执，删除 15 秒无意义等待。
- [x] P10：删除 Goal 最新消息挂靠和 tool update 伪回合；恢复官方 Goal 首条用户消息。
- [x] P11：统一子 Agent 官方 Session 读取与复用链；恢复历史官方权限状态。

## 已确认不变量

- disk restore 与 live replay 必须等价。
- 后台工作不能阻止新的前台 Send。
- UI 可见动作必须能被后端执行。
- Goal/Plan/tool 历史不得用单槽位覆盖。
- 子会话不进入主列表，但必须能按 session id 打开。
- Goal 终态是独立的官方时间线事件，不按最新消息、时间或文本推断归属。
- tool update 只按官方 tool call identity 归并，不为每个更新生成本地伪回合。

## 当前状态

- 工作目录：`/Users/alexwhite/Desktop/GrokBuild-core-clean-20260725`
- 原始 ZIP 未修改。
- P11 已完成；只处理了已复现的投影、恢复和控制可达性问题。
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
- Goal 命令只从官方 session 更新补齐实时 Actor，不增加轮询或第二事实源。
- 历史 Plan 只认 `current_mode_update`/`session/load`；恢复权限按官方事件中的末次状态，通过结构化 x.ai 控制重新应用并读回确认。
- 卸载任务可显式恢复；已恢复的 Plan 可通过官方 `setMode(normal)` 退出。
- busy Goal 控制先取消当前官方执行再串行下发，不进入普通 prompt 队列；`infra_paused` 按官方状态显示暂停。
- 官方 prompt 终态按精确 prompt id 清理旧队列占位，Goal 编辑不会卡在等待接收。
- 桌面后端重启后复用既有版本检测并刷新页面，不保留永久转圈的旧连接。
- 延迟回复用官方 prompt identity 合并 chunk；实时 `x.ai/session_notification` 与磁盘 session update 共用子代理 Context projector。
- 待处理 Goal 命令收到匹配的官方 `goal_updated` 即确认已接收；Goal 内容和生命周期仍只来自官方 Session。
- 历史首条 Goal 用户消息直接取官方 `goal_updated.objective`；Goal 终态按官方事件游标显示。
- tool update 复用现有官方 tool call identity；已删除绕过该关联的逐事件 turn 覆盖。
- `subagent` 与 `subagent_resume` 都不进入主任务列表；子对话直接复用主 Session 投影器读取官方累计历史。
- 子 Agent 状态只由官方 `subagent_spawned/progress/finished` 改变；已删除 tool/prompt 指纹配对、队列终态推断和第二套 child transcript/timeline。
- 子 Agent 复用只读官方 `resumedFrom`，稳定保留一条会话并指向最新 child Session；`Not Refuted` 等输出原样来自官方完成事件。
- 历史权限从官方 `events.jsonl` 的 `turn_started.yolo_mode` / `yolo_toggled.enabled` 恢复，不再统一硬编码为 Ask。

## 最终验证

- `npm run typecheck`：通过。
- `npm run test:segmentation`：94 / 94 通过。
- `npm run test:task-runtime`：98 / 98 通过。
- `npm run build`：Web、Server、Electron Shell 通过。
- `npm run architecture`：通过；无未使用代码，重复率低于阈值。
- `npm audit --omit=dev`：生产依赖 0 个漏洞。

## 桌面 UI 验证

- 仅通过桌面 UI 建立 Goal；Goal 条和 live 子代理立即投影。
- busy Goal 的暂停、继续、编辑保存、删除均完成，未再卡在等待接收。
- 卸载任务恢复后可正常发送消息，Paused Goal、权限和子代理历史仍可见。
- 新建主会话生成官方子 Session 后，主会话显示 `PARENT_OK`，子会话独立显示 `CHILD_OK`。
- 重启开发壳并恢复该历史会话后，用户消息、主回复和子会话仍在；权限稳定为 `YOLO`，继续发送后收到 `RESTORE_OK`。
- UUIDv7 官方任务完成通知通过 Electron IPC，终端不再出现 `Invalid task id`。
- 仅通过加号建立 Plan；详情投影和“不批准”收尾正常。
- 重开官方历史 Session 后，首条 Goal 用户消息存在，完成条位于对应 Goal 回合之后，空白消息条为 0。

## 维护入口

所有批次已完成。后续修改先补回归证据；不要引入 TaskPatch、第二事实源、Plan 影子持久化或无实证的大型重构。
