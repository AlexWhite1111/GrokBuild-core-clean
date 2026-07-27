# Session Projection Repair Progress

最后更新：2026-07-27

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
- [x] P12：统一代码解析与本地预览服务，删除 Renderer 第二运行时并隔离 Node/CommonJS。
- [x] P13：稳定代码预览高度与源码滚轮分区，删除 iframe 尺寸反馈环。
- [x] P14：统一 Git/工作区视觉；修正诊断能力证据；收口图片尺寸、手机灯箱与空 New Task 复用。
- [x] P15：修复流式输出滚动夺权；删除分散输入监听，按真实滚动方向脱离和恢复跟随。
- [x] P16：降低长回复投影与富文本重建开销；官方事件完整累积，界面刷新按可选帧窗口合并。
- [x] P17：把长流收敛为单一有序投影协议；限制富文本缓存与冷启动扫描，并完成正式 App 的 10 Hz、Session 顺序和完整渲染验收。
- [x] P18：修复 Mermaid 节点中的 LaTeX；保留严格生成链和直接 SVG 的原安全边界，并在正式 App 中验收。
- [x] P19：收口空白 Session 预配置、官方 interjection/隐藏提醒、空回合展示，并修复 Mermaid HTML 标签二次解析。
- [x] P20：把消息与结构变化收敛为统一增量投影，消除子 Agent 大 Session 的完整事件重传。
- [x] P21：集中新任务默认值，删除任务创建反写默认配置和无效 Work Mode 默认字段。
- [x] P22：过滤父任务中的子 Session 逐字噪声，稳定 Agent 排序，并把复杂 Markdown 收敛为可证明等价的增量 canonical 渲染。
- [x] P23：收口显式 LaTeX 定界符与数学密集流式渲染，删除复制、链接坐标的重复解析分支。
- [x] P24：按语义边界即时封存闭合 Mermaid 等静态块，只让未完成尾部流式，并消除结构等价时的结束态重挂载。

## 已确认不变量

- disk restore 与 live replay 必须等价。
- 后台工作不能阻止新的前台 Send。
- UI 可见动作必须能被后端执行。
- Goal/Plan/tool 历史不得用单槽位覆盖。
- 子会话不进入主列表，但必须能按 session id 打开。
- Goal 终态是独立的官方时间线事件，不按最新消息、时间或文本推断归属。
- tool update 只按官方 tool call identity 归并，不为每个更新生成本地伪回合。
- 性能优化不得丢弃、改序或概括官方 Session 事件；允许合并 UI 刷新并传输带版本和索引的确定性增量，失配时只能从同一官方 Task 重新同步。

## 当前状态

- 工作目录：`/Users/alexwhite/Desktop/GrokBuild-core-clean-20260725`
- 按确认的“只留当前版本”范围，历史源码、探针、压缩包和打包副本已清除；只保留正式 App 与当前 Git 源码。
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
- 围栏与隐式代码共用 `codeCapability`；HTML/CSS/JavaScript/TypeScript 只通过本地 Preview Service 运行，无服务时保留源码。
- Node/CommonJS 在代码块合并前即被排除，不进入浏览器 HTML bundle；相邻浏览器代码仍按原规则合并。
- Renderer `srcDoc` 预览运行时及其 import-map fallback 已删除，后端 `PreviewRuntimeService` 是唯一执行管线。
- 带样式的块级 HTML 进入隔离预览；行内 HTML 仍沿用原有安全净化，不放宽应用 DOM。
- 设置页 Rendering 分组可控制交互预览及四类 Web 语言；关闭只影响执行，不影响语法高亮与源码。
- 纯源码行高继续只取 `--font-code-line-height`；左 3/4 滚轮只移动对话，右 1/4 只移动代码框。
- 代码框使用一个非被动原生 wheel 监听，已删除合成 wheel、捕获/冒泡双路由和内部滚动目标遍历。
- Preview Runtime 只观察 body 的真实内容高度并去重；不再监听根节点尺寸与全 DOM mutation。
- 作者页面 body 不再附加外层 padding；默认占位内容单独留白，`100vh` 不再形成 iframe 高度正反馈。
- Git 状态、工作区选择和提示色只使用全局主题语义变量；深浅主题不再各模块自定义颜色。
- Diagnostics 只显示本次连接由 initialize 声明或版本/运行时验证的 x.ai 能力，并标明真实事件方向。
- 普通图片正文仍使用原生/舒适/取小/取大公式；设置变化直接重算已显示图片，不整页刷新。
- 图片灯箱只有一份视图状态；手机默认 cover、电脑默认 contain，Fit 返回各自初始模式。
- 图片双击将三个实际像素尺寸排序后循环；小于 `max(12px, 5%)` 的近似档位自动跳过。
- New Task 仅依据官方 Session 的 `num_messages`/用户历史复用当前 Project 的空 Session，不用标题或时间推断。
- 阅读宽度不再伪造全局 resize；选择控件的隐藏输入锚定自身，不再把 Terminal 内容层滚出视口。
- 对话滚动只使用虚拟列表的一套末端/锚点模型：真实位于底部时跟随新增内容，离开底部后按稳定消息 id + 行内偏移保持阅读位置；已删除 revision 强制到底、上一帧方向、`pinnedToBottom` 和独立跟随帧。
- 流式文字、Mermaid、LaTeX、图片和 Preview 改变当前阅读行高度时不改 `scrollTop`；只有完全位于视口上方的旧行重测才补偿，Composer 高度变化也只在原本位于底部时跟随。
- 源码、数据表、Notebook、运行输出、SPICE 与 Preview Console 共用一个 3/4—1/4 滚轮路由；内联 HTML、图片、图表、3D 与 Matplotlib 的普通滚轮回到对话，`Ctrl` 缩放和超过 10px 的明确拖拽才归渲染视图。
- Actor 仍逐条处理官方通知；WebSocket 完整投影采用首帧立即、连续流限频、尾帧必达的单计时器，默认 20 Hz。
- 渲染设置提供 10 / 15 / 20 / 30 / 60 Hz 五档，只保存 `streamingRefreshHz`，不参与 Session 状态判断。
- 真实 JSON 快照按官方结构事件内容缓存时间线；流式文本的 `lastEvent` 变化只更新现有消息，不再重建整个历史。
- Task 快照不再连带克隆全部消息与事件；Context Window 只在既有恢复/终态刷新点读取，不在每次 UI 投影同步读磁盘。
- WebSocket 只保留 `task.projection`：初次连接与显式重同步发送完整帧；其后消息、事件和子 Agent 状态统一发送带 epoch/revision/index/count 的增量帧。
- Renderer 只在版本、顺序、identity 与目标数量全部连续时原位合并增量；任一项失配便从同一官方 Task 端点重新同步，不增加第二事实源。
- 同一刷新窗口内的消息与结构变化合并为一个最新增量；官方 Session 通知仍逐条、原序进入 Actor，完整消息和事件继续由唯一投影保存。
- 普通增长文本使用与 canonical 结果一致的窄语法路径；Markdown、HTML、公式、媒体、代码和最终完成态始终进入同一 canonical 富文本管线。
- Renderer 与 Server 富文本缓存统一为按权重淘汰的 96 项 / 16 MiB 上限；超大结果照常渲染但不驻留。
- 冷启动只枚举官方 Session id，不再为媒体清理回放全部历史；官方 Session 的未解析媒体保守保留，任务打开后从该 Session 的真实消息与事件完成引用解析。
- Mermaid 仍由原生严格模式生成；其自身生成的 HTML/MathML 标签通过同一 SVG 净化器保留，不增加旁路渲染器。
- 只有严格 Mermaid 生成物可使用 `foreignObject` 的 HTML 命名空间切换；直接 SVG 与 Graphviz 继续禁止该能力，脚本、外部引用和危险 CSS 仍会移除。
- Mermaid 在同一净化后主链中按节点与分组的实际自定义底色选择可读标签色；普通文字、KaTeX 与 MathML 共用该结果，未增加第二次渲染。
- Mermaid 数学固定复用应用已加载的 KaTeX 字形；删除全图文字强制覆色，只保留 KaTeX 伸缩路径继承当前文字色，根号与横线不再被 Mermaid 的黑色规则覆盖。
- 生成图片与图表无论是否大于视口都可直接拖拽；几何约束仍保证至少保留可见区域。
- 首条用户消息前更换 System Prompt/Sandbox 时，新官方 Session 原位接替并归档旧空 Session；标题、Pin、草稿和临时文本引用随任务迁移，不创建可见 Fork。
- 首条用户消息后仍沿用正常 Fork；前台回合、Goal、Queue、Gate、未确认投递或后台工作存在时，前后端共用同一阻塞规则。
- 设置中的“新任务默认值”集中保存当前 Project 的模型、推理强度、Permission、Sandbox 与 System Prompt 预设；只在创建下一条官方 Session 时读取。
- 当前任务 Permission 仍只跟随自身官方 Session；任务创建不再把临时解析结果反写项目默认值，能力暂不可用时也不会把已保存的 YOLO 覆盖成 Ask。
- 新任务输入必须显式携带解析后的 Permission；已删除没有真实入口且从未被读取的 Project `workMode` 默认字段。
- 官方 `hideFromScrollback` 输入不进入正文；interjection 只显示官方 `<user_query>` 内容；没有 Grok 正文的回合折叠到最后一个真实过程段，不生成空气泡。
- Mermaid 生成成功后的 HTML 标签按 HTML DOM 净化后再序列化为 SVG，避免把合法 `<br>`/MathML 当作坏 XML；图类型仍全部交给 Mermaid 原生语法识别。
- 子 Session 的逐字 user/agent/thought chunk 只保留在其官方 Session 正文中，不再重复进入父任务 operational context、revision 和投影帧；结构化 spawned/progress/finished 事件仍完整投影。
- 活跃 Agent 按启动时间稳定排列，进度变化不再重排；运行行固定为单行，只有完成时发生一次符合语义的历史区迁移。
- 文本增量帧不再克隆或发送未变化的 Context；Renderer 沿用同一投影版本中最后接受的 Context，并在纯文本变化时复用右栏资源结果。
- 复杂 Markdown 在已完成块与当前尾部的组合结果经 canonical parser 证明等价后，固定已完成块并只重解析尾部；闭合 Mermaid 等静态围栏立即以非流式段渲染，未闭合围栏内部空行不会误切分。
- 完成态仍由原有 one-shot canonical parser 做唯一权威校验；结构精确一致时保留已挂载段及预览实例，便携树包含额外链接增强而结构不同时才由权威树接管。不显示源码、不增加 fallback 或第二渲染器。
- `\(...\)` / `\[...\]` 只做等长的显式定界符转换；不再猜测普通括号或方括号，复制与本地链接直接复用同一棵 canonical 语法树的原始坐标。
- 流式稳定边界识别会忽略数学内容中的 Markdown 符号；数学、Markdown、Mermaid 最终仍只进入原有 canonical 渲染主干。
- Web Search 查询词从同一官方 Session 的 `backend_tool_call` 按 tool call id 合并到 `updates.jsonl` 的工具状态；live 与重启恢复共用同一净化和时间线入口，空标题不再丢失查询内容。

## 最终验证

- `npm run typecheck`：通过。
- `npm run test:segmentation`：96 / 96 通过。
- `npm run test:task-runtime`：167 / 167 通过。
- `npm run build`：Web、Server、Electron Shell 通过。
- `npm run architecture`：0 个错误；仅保留 2 个既有测试孤立警告，Knip 无未使用代码，重复率 0.05%。
- `npm audit --omit=dev`：生产依赖 0 个漏洞。
- `git diff --check`：通过。
- Mermaid 数学与对比度回归：2 / 2 通过；覆盖统一 KaTeX 字形、严格模式、HTML/MathML 标签、深浅自定义底色和直接 SVG 不放宽。
- `threadScroll.test.ts` 与 `CodeScrollRegion.test.ts`：7 / 7 行为用例通过；覆盖真实底部、当前阅读行不补偿、稳定 id 恢复、滚轮单位及代码区 3/4—1/4 边界。
- Preview runtime 回归覆盖内联 HTML 与 Matplotlib iframe 的普通纵向滚轮回到对话、修饰键交互仍保留给渲染视图。
- Web Search live / restore 回归：查询词按同一官方 tool call id 投影，完成态与重启恢复一致。
- `taskThreadStructure.runtime.test.ts`：真实 JSON 克隆、1000 次文本追加和游标变化只构建 1 次时间线。
- 投影帧回归覆盖引用保留、旧帧/跨 epoch/identity 与数量分歧、首个完整帧、消息/事件连续合并和同一子 Agent 多次状态更新。
- 真实 10 子 Agent 历史基准：单次结构更新帧从 21,992,566 bytes 降至 194,927 bytes（112.8 倍）；序列化从 79.41 ms 降至 0.96 ms。
- 新任务默认值回归覆盖完整五项解析、权限能力暂缺不污染持久偏好、显式 Permission 输入和旧 `workMode` 字段清理。
- 富文本增长基准为 6,599 字符、150 次更新：增长阶段中位总耗时 10.67 ms，最终 canonical 解析 22.41 ms，增长阶段进入完整解析器的字符数为 0，最终结构精确一致。
- 复杂 Markdown 基准为 9,523 字符、150 次更新：累计解析从 717,634 字符（75.36 倍、约 1,731.6 ms）降至 30,040 字符（3.15 倍、约 224.5 ms）；解析量降低 23.9 倍，完成态结构仍精确等于 canonical。
- 多 Mermaid 当前基准为 10,071 字符、150 次更新：累计解析 28,913 字符（2.87 倍），增长阶段约 135.11 ms，最终 canonical 校验约 17.88 ms；结束前已有的 130 / 130 个语义段对象全部保留，最终结构精确等于 canonical。
- 数学密集回复基准为 9,556 字符、150 次更新：累计解析 29,941 字符（3.13 倍），完成态 canonical 解析 71.75 ms；覆盖用户截图中的 Rolle 与 Cauchy 公式及每个切分边界。
- 2,000 个 child `agent_message_chunk` 回归为父任务 0 个 operational event、0 次 context 重投影、0 次 revision/帧发布；结构化子 Agent 状态仍进入原统一增量帧。
- 媒体缓存回归覆盖未解析官方 Session 保留、孤儿清理和任务打开后的引用解析；正式 Grok Home 状态下后端 1,577 ms 进入 ready。

## 桌面 UI 验证

- 仅通过桌面 UI 建立 Goal；Goal 条和 live 子代理立即投影。
- busy Goal 的暂停、继续、编辑保存、删除均完成，未再卡在等待接收。
- 卸载任务恢复后可正常发送消息，Paused Goal、权限和子代理历史仍可见。
- 新建主会话生成官方子 Session 后，主会话显示 `PARENT_OK`，子会话独立显示 `CHILD_OK`。
- 重启开发壳并恢复该历史会话后，用户消息、主回复和子会话仍在；权限稳定为 `YOLO`，继续发送后收到 `RESTORE_OK`。
- UUIDv7 官方任务完成通知通过 Electron IPC，终端不再出现 `Invalid task id`。
- 仅通过加号建立 Plan；详情投影和“不批准”收尾正常。
- 重开官方历史 Session 后，首条 Goal 用户消息存在，完成条位于对应 Goal 回合之后，空白消息条为 0。
- 重启 Electron 并恢复官方代码测试 Session：浏览器 JavaScript 与样式 HTML 正常预览；相邻 Node 围栏独立保留源码且无运行入口。
- Electron 中由 Grok 生成四段无外部依赖的标准样例：完整内联 HTML、独立 CSS、TypeScript、TSX 均显示预期颜色；HTML 与 TypeScript 按钮分别实测变为 `HTML ACTIVE`、`TS ACTIVE`。
- 旧样例的 HTML 资源错误来自其显式引用但未提供的 `styles.css` / `main.ts`；不为不完整输入扩张预览协议或增加第二套合并逻辑。
- 多预览历史任务连续截图主内容零位移；静置后 Electron、Renderer 与 GPU 进程均为 0.0% CPU。
- Electron 连续点击两次“新任务”保持同一官方 task id，未再创建 Untitled Session。
- Electron 从保存的 `/new` 路由冷启动后直接进入既有官方空 Session，未创建第三个 Session。
- Electron 双向切换阅读宽度 Full 后外层滚动保持 `0`，设置页位置不跳动且无底部底色遮挡。
- 手机模拟视口 `390×844`：灯箱和视口均为全屏，图片 cover 为 `633×844`；Fit 仍返回 cover。
- 手机真实双击顺序实测 `633×844 → 864×1152 → 273×364 → 633×844`，按实际尺寸正确回环。
- 最新正式 App 已纯净替换并重启；`app.asar` SHA-256 为 `99b7d3bb69f5f149a63cc878ca193a25edd1f4295475eafa762ff3464abc9672`。
- 正式 App 已展开验收真实历史中的 9 条 Web Search，均显示同一官方 Session 内按 tool call id 对齐的实际查询词。
- 正式 App 已切换任务再返回验收：恢复到原稳定消息与行内位置，保持“回到最新”状态，不被历史重投影强制拉到底部；官方 Session 未改写。
- 正式 Electron 设置页已只读验收：“新任务默认值”集中显示模型、推理强度、Permission、Sandbox 与 System Prompt，并明确只作用于未来任务，不修改当前官方 Session 或创建 Fork。
- 新版本重启后的 15 秒普通使用样本：Renderer 平均 6.9%、峰值 23.5%，Server 平均 2.5%、峰值 17.4%；修改前 45 秒长流样本为 Renderer 平均 29.2%、峰值 179.6%。负载不同，不把该样本写成同负载结论。
- 正式 App 在 10 Hz 下完成 300 行纯文本同步采样：30.5 秒活跃窗口内应用平均 38.8% 的一个逻辑核心，P95 50.1%，峰值 59.5%；结束后回落到 0–0.3%。其中 Renderer 平均 16.5%、Server 13.6%、GPU 6.7%。
- 三个独立官方测试 Session 均逐行核对为 001–300：每个 300 行、0 缺失、0 重复；事件顺序均为 `user_message_chunk → agent_thought_chunk → agent_message_chunk → turn_completed`。
- 正式 App 真实窗口已验收标题、粗体/斜体、表格、行内代码、JavaScript、KaTeX、Mermaid 和完整 HTML/CSS/JS；交互计数器从 0 点击到 1。
- 在用户截图对应的官方 Session 中重新打开原消息：单节点显示 `E=mc²`，三节点显示 `E → mc² → E=mc²`；无字面 `$$`、无空节点，普通 Mermaid、独立 KaTeX 与 HTML 预览同时正常。
- 在用户最新官方 Session 中重新打开 12 段 Mermaid：前两段已恢复为真实图形，整轮 11 段原样渲染；唯一保留源码的是原文未给中文标题/类目加引号的 `xychart-beta`，属于 Mermaid 源语法错误。界面中不再出现官方 interjection 包装文本。
- 用户提供的深浅分组、黑白节点、多形状与长公式压力图已在正式 App 的昼夜主题验收：节点、分组标题与公式对比正常，公式字形与正文 KaTeX 一致，根号及上横线继承节点文字色。
- 用户使用“Mermaid 位于开头、后续 200 行继续生成”的正式 App prompt 完成手测，确认闭合图块无需等待整轮结束即可进入渲染主链。
- 完整预览验收后的静置状态下，核心 Electron 进程物理占用约 431 MB；三个已加载测试任务的 Grok 进程合计约 135 MB。进程 RSS 直接相加会重复计算共享页，不作为真实物理占用结论。
- 当前源码目录已清除 `node_modules`、`dist*` 和 `release` 等可再生内容，从约 1.3 GB 收敛到约 8.8 MB；系统下载缓存与官方 Session 数据未动。

## 维护入口

所有批次已完成。后续修改先补回归证据；不要引入 TaskPatch、第二事实源、Plan 影子持久化或无实证的大型重构。
