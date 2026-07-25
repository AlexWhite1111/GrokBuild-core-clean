# GrokBuild Agent Rules

开始改动前阅读：

1. `docs/session-projection-rules.md`
2. `docs/active-change-contract.md`
3. `docs/repair-progress.md`

## 必守规则

- 官方 Grok Session 是对话与运行状态的唯一事实来源。
- 磁盘恢复与 live ACP 必须经过同一投影规则并得到等价结果。
- 原始规范化事件只追加，不用有损 upsert 代替历史。
- 前台回合、后台工作、Gate、Queue、Goal 必须分开表达。
- UI 只消费服务端给出的投影和动作能力，不自行推测业务状态。
- 修根因后删除旧分支、重复 reducer、空壳接口和失效测试。
- 不改无关功能，不增加兼容旁路或第二来源。
- 每批完成后更新 `docs/repair-progress.md`，压缩上下文后从该文件续接。

## 完成条件

- 新增跨层回归测试。
- `typecheck`、相关测试、完整构建、架构检查全部通过。
- 工作区无未使用文件、重复状态和已知空实现。
