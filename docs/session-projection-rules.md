# Session Projection Rules

## 权威边界

1. `summary.json`、`updates.jsonl` 与 live ACP/XAI 是唯一输入。
2. SessionProjection 是唯一业务投影。
3. Transcript、Context、Sidebar、Composer、Goal、Plan 都是该投影的只读视图。

## 不变量

- 同一事件序列：disk restore 与 live replay 结果相同。
- `epoch + revision` 唯一标识一次投影版本。
- `foreground.running` 不等于 `background.running > 0`。
- UI 动作来自 `allowedActions`，不得从 `busy` 反推。
- tool update 合并当前状态，但原始事件历史不丢失。
- Goal 转换具有稳定 identity，可跨重启恢复。
- Plan 只恢复官方 Session 中实际持久化的内容；live reverse request 不另建影子存储。
- child session 可按官方 session id 读取，不进入主任务列表。
- child reverse request 进入同一 Gate 队列，并携带 parent/child scope。
- turn 终态只绑定明确 identity；仅剩一个 active turn 时才允许回退。
- 单槽命令摘要只能由相同 request identity 的完成态更新。
- Plan 草稿 identity 为 task + gate + 完整原文 hash。
- inline media identity 必须能由官方更新确定性重建。
- active/paused Goal 在 Actor 卸载后仍锁定 Source Control。

## 禁止状态

- `activities` 与 `context.activeWork` 各自解析同一协议；
- revision 跨 epoch 裸比较；
- timeline 用单槽位覆盖 Goal/Plan 历史；
- Diagnostics 或恢复接口以固定空值冒充实现。
