# Active Change Contract

## 目标

把 Session 投影收敛为一条可恢复、可验证的主链，并清理 Goal、Plan、状态检测和 UI 中的重复实现。

## 本次范围

- execution 与动作能力；
- Actor retire/resume 版本代际；
- disk/live context 一致性；
- child session 与 tool update 恢复；
- Goal 历史、计时和锁；
- Plan 官方恢复边界，不增加本地 Plan 事实源；
- Diagnostics、媒体引用和孤儿代码；
- child reverse request 闭环、turn 终态身份；
- Goal partial update 与无 objective 控制；
- 命令摘要按 request identity 防止旧完成覆盖新执行；
- Plan 草稿 Gate 隔离和完整内容 hash；
- 对应跨层回归测试。

## 保留

- 官方 ACP、Queue、Interject、Permission、Gate、fork、rewind；
- 现有主题、富文本、终端、预览和项目管理行为。

## 禁止

- 新增本地业务事实源；
- 用 UI 状态修补服务端错误；
- 用兼容分支保留已被替代的旧链；
- 未经测试宣称 live 与 restore 等价。
