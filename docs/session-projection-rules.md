# Session Projection Rules

## 权威边界

1. `summary.json`、`chat_history.jsonl`、`updates.jsonl` 与 live ACP/XAI 都来自同一个官方 Session，是唯一输入。
2. SessionProjection 是唯一业务投影。
3. Transcript、Context、Sidebar、Composer、Goal、Plan 都是该投影的只读视图。

## 不变量

- 同一事件序列：disk restore 与 live replay 结果相同。
- `epoch + revision` 唯一标识一次投影版本。
- Actor 必须逐条、原序应用全部官方 Session 事件；显示调度器最多只保留一个“最新待显示帧”，不得排队重放中间 UI 帧或把它提升为第二事实源。
- 连续正文的显示间隔可在 17–1000 ms 内调节；完成、报错、Queue、权限、Gate 与其他结构变化必须在下一帧立即发布，不得等待正文节流窗口。
- UI 增量只传输该版本中变化的消息与时间线行；版本、顺序、identity 或数量失配时，必须从同一官方 Task 端点重新同步。
- 已存在消息的文本增量只能携带精确 append、前序文本长度与同一消息 identity；Renderer 拼接后仍只是官方 Session 正文的传输形式，不得把累计文本或 append 队列提升为第二数据源。
- `foreground.running` 不等于 `background.running > 0`。
- UI 动作来自 `allowedActions`，不得从 `busy` 反推。
- tool update 合并当前状态，但原始事件历史不丢失。
- live ACP/XAI 热路径不得为补字段枚举或重放磁盘 Session；需要兼容旧格式时只能在 restore 边界读取当前同一 Session。
- 相同 `available_commands_update` 是投影视图 no-op；官方 Session 事件文件保持原样，live 与 restore 使用同一净化后等价判断。
- Web Search 的动作与查询词按官方 tool call id 合并；live 优先读取官方完成更新自身的查询词，旧格式恢复再读取同一 Session 的 backend tool call，不从 UI 或旁路猜测。
- Goal 转换具有稳定 identity，可跨重启恢复。
- Plan 只恢复官方 Session 中实际持久化的内容；live reverse request 不另建影子存储。
- child session 可按官方 session id 读取，不进入主任务列表。
- child transcript 的逐字 chunk 只属于其官方 child Session，不进入父任务 operational context；父任务只投影结构化 child lifecycle。
- child reverse request 进入同一 Gate 队列，并携带 parent/child scope。
- turn 终态只绑定明确 identity；仅剩一个 active turn 时才允许回退。
- Queue 只按官方 request identity 关联本地待确认 prompt；显式但未知的官方 identity 不得占用无 identity 的本地条目，已显式匹配的条目也不得再次参与顺序回退。
- 单槽命令摘要只能由相同 request identity 的完成态更新。
- Plan 草稿 identity 为 task + gate + 完整原文 hash。
- inline media identity 必须能由官方更新确定性重建。
- active/paused Goal 在 Actor 卸载后仍锁定 Source Control。
- `hideFromScrollback: true` 的官方 user chunk 是内部输入，不生成用户消息；官方 interjection wrapper 只展示其中的 `user_query` 正文。
- 空白 Session 在首条用户消息前更换 System Prompt 或 Sandbox 时，由一个新官方 Session 原位接替；旧空 Session 归档，不生成可见 Fork。
- Session 已有用户消息后再更换固定设置，必须保留源 Session 并创建普通官方 Fork；Goal、Queue、Gate、未确认投递或后台工作未结束时禁止改写历史。
- Project 新任务默认值是非对话配置，只能在创建新官方 Session 时读取；任务创建和当前 Session 的权限切换都不得反写默认值。
- 文本 delta 可省略未变化的 Context；Renderer 只能沿用同一官方投影链最后接受的 Context，不得从旁路重建。
- 纯文本 delta 可进一步只携带 task identity、epoch、revision 与时间戳；任何语义、结构或 Context 变化必须自动升级为完整 delta snapshot。
- 流式富文本只可缓存经 canonical 组合等价验证的完成块；闭合的静态围栏立即成为非流式段，只有未完成尾部继续流式。边界判断必须复用 canonical 节点识别已闭合链接，真正未解析的引用仍留在活动尾部；富块后的窄语法纯文本继续走同一零解析快速路径。结束时仍由同一个 one-shot canonical parser 建立最终树；组合结构精确一致时保留已挂载段，权威链接增强不一致时由最终树接管。不得退回源码或增加第二渲染链。
- 对话滚动只保存一个阅读意图和一个稳定 item 锚点：内容增长不得关闭跟随，用户向上阅读不得被新投影拉走；达到真实末尾或显式“回到最新”才恢复跟随。代码、iframe、图表和媒体不得另建外层滚动状态。
- `followLatest: true` 的像素坐标没有恢复语义，必须持久化为同一个 canonical 锚点；Renderer 与状态存储均跳过等价值。
- 用户、助手和恢复历史中的相对媒体别名只能在当前官方 Session scope 内确定性解析；不得改写消息原文、搜索兄弟 Session 或允许目录穿越。
- Markdown 复制必须复用 canonical 语法树的原始源坐标：普通文字保持字符级选区，语法结构复制完整原始 Markdown；显式代码块按钮复制作者原围栏，无围栏代码不得凭空生成围栏或语言。

## 禁止状态

- `activities` 与 `context.activeWork` 各自解析同一协议；
- revision 跨 epoch 裸比较；
- timeline 用单槽位覆盖 Goal/Plan 历史；
- Diagnostics 或恢复接口以固定空值冒充实现。
