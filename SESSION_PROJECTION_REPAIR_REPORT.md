# Session 投影专项修复报告

日期：2026-07-25

## 结论

本次没有重造架构，也没有改动稳定 UI。修复沿现有 Grok Session 主链完成：收敛重复状态解析，补齐 disk/live 一致性、投影代际、Goal 历史和卸载状态，并删除无法产生真实功能的空壳。

## 已完成

- 将前台回合与后台工作拆开，UI 动作直接消费服务端动作能力。
- 增加 `projectionEpoch + revision`，避免 Actor retire/resume 后旧 revision 覆盖新投影。
- disk restore 与 live replay 共用 Context/Work 投影规则。
- tool update 保留原始事件历史；child session 可按官方 session id 读取但不进入主列表。
- Goal 转换改为稳定 identity 和追加历史，修复计时与 Actor 卸载后的源码锁。
- Plan 只恢复官方 Session 已持久化内容，不增加本地影子事实源。
- Diagnostics 与媒体引用从现有投影按需得出，不维护第二份状态。
- 删除重复 `TaskActivityTracker`、未接线 `RuntimeScheduler` 和三个固定空实现。
- child permission/question/Plan reverse request 全部进入已有 Gate 队列，不再静默丢弃。
- turn completed/failed 按 request、prompt 或 turn identity 精确结算；多回合歧义时不猜测。
- Goal 修复显式空 objective、原生 goal id/elapsed 重启边界及无 objective 控制入口。
- 命令完成按 request identity 更新摘要，旧命令不会覆盖仍在运行的新命令。
- Plan 草稿按 Gate 隔离并对完整原文取 hash；inline media 可跨重启恢复稳定引用。

## 保留边界

- 未增加新产品功能、安全层或兼容旁路。
- 未改变现有主题、布局、富文本、终端、预览和项目管理 UI。
- ACP、Queue、Interject、Permission、Gate、fork、rewind 保持原有能力。

## 验证

- `npm run typecheck`：通过。
- `npm run test:segmentation`：94 / 94 通过。
- `npm run test:task-runtime`：81 / 81 通过。
- `npm run build`：Web、Server、Electron Shell 通过。
- `npm run architecture`：通过；未使用代码检查通过，重复率 0.11%。
- `npm audit --omit=dev`：生产依赖 0 个漏洞。

## 代码量

以原始解压源码和当前清洁副本的 `src/` 为准：

- 生产代码：新增 501 行，删除 364 行，净增 137 行。
- 回归测试：新增 491 行，删除 3 行，净增 488 行。
- 合计：新增 992 行，删除 367 行，净增 625 行。
- 完整删除两个无效实现：`TaskActivityTracker.ts` 176 行、`RuntimeScheduler.ts` 46 行。

新增量主要是把原先缺失的恢复、identity 和回归证据补齐；没有为追求净减行而合并已验证的业务边界。

## 刻意未扩大的边界

- 不引入 TaskPatch 或改写 WebSocket 协议；这是独立性能架构，不是本轮正确性修剪。
- 不改变 `updates.jsonl` 的 64 MB 保护上限和超长 Plan 的 500,000 字符展示上限。
- 不把进程内的 permission/Plan 调度意图持久化成第二事实源。
- 不为官方 Session 未持久化的 Plan reverse payload 发明本地影子历史。

## 继续维护

先阅读 `AGENTS.md`、`docs/session-projection-rules.md` 与 `docs/repair-progress.md`。任何新修复都应延续一条事实源、一条投影链和最少状态的原则。
