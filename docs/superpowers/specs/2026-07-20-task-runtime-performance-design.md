# Grok Build 任务运行时性能架构设计

日期：2026-07-20  
状态：用户已确认  
范围：新任务运行时、任务持久化、实时增量协议、历史恢复、富文本流式渲染、旧应用任务数据清理

## 1. 目标

在用户可感知的行为完全不变的前提下，替换当前按协议碎片驱动的任务链路，使 Grok Build 的 CPU、内存、数据库写入、WebSocket 传输和渲染成本与实际语义内容近似线性增长。

“体验完全不变”是最高约束，性能优化不能改变：

- 父任务回复、思考、工具调用和子代理过程的内容、顺序与层级；
- 逐字流式出现的视觉连续性；
- Gate、权限、问题、计划审核、Goal、队列和 Interject 的时机与操作能力；
- 媒体、路径、代码、HTML、图表、SPICE、本地运行与预览表现；
- 断线重连、应用重启、任务恢复、Fork、Rewind、删除、搜索和通知行为；
- 侧栏、任务页、上下文区和 Composer 的现有外观与交互。

本次不以旧的 901 MB 任务历史为兼容目标。旧任务数据和应用私有临时缓存将在新实现完成并验证后清理；Grok 原生会话、项目目录和真实生成文件全部保留。

## 2. 用户意图与设计原则

用户满意当前所有功能，问题只在运行成本。因此设计必须从现有功能为什么存在出发，而不是根据数据库结构反向定义产品：

1. 流式输出存在，是为了让用户及时看到模型正在形成的答案；它不是要求每个 token 都成为永久事件。
2. 工具和子代理过程存在，是为了让用户理解实际工作状态；它们需要准确的语义状态和顺序，不需要重复保存同一状态的每次协议重发。
3. 历史恢复存在，是为了重新打开后得到同一任务视图；它应从持久化投影直接恢复，而不是重新演算百万条传输碎片。
4. 原始协议证据只用于定位未知行为；正常运行不应让诊断数据成为主要产品数据库。
5. 每项能力只保留一个权威状态源、一条发布路径和一种持久化表示。
6. 新链路接管后移除旧事件重放、全量上下文扫描、完整消息广播和启动全表媒体扫描，不保留并行旁路。

## 3. 已验证的当前基线

只读审查确认：

- 156 个任务对应约 104 万条 `task_events`；
- `app.sqlite` 约 904 MB，其中事件表及索引占绝大部分；
- 约 76 万条父消息碎片的实际文字总量约 1.8 MB；
- 当前完整消息重复传递的保守估算约 1.94 GB，文字放大约 1056 倍；
- 单秒最多约 719 条消息碎片；
- 一个 37,303 事件任务的服务端恢复约 1.52 秒，并增加约 400 MB RSS；
- 冷启动媒体引用查询会扫描整个事件表；
- 空白任务页的空闲 CPU 接近零，因此主要问题来自活跃流式链路和历史恢复，而不是 Electron 空闲外壳；
- 当前三套 TypeScript 类型检查通过；
- 当前富文本分段测试 93 项全部通过。

根因是一个协议通知同时承担了四种职责：传输碎片、运行时状态变化、永久历史记录和 UI 刷新信号。每个碎片都触发同步 SQLite 事务、任务 revision 更新、全事件上下文重算、完整对象克隆、WebSocket 序列化和完整 Markdown 解析。

## 4. 方案比较与决策

### 4.1 方案一：仅限制刷新频率

在现有 `TaskClientEvents` 或 WebSocket 层增加 debounce。

优点是改动小；缺点是数据库仍按碎片增长，历史恢复仍依赖完整事件重算，上下文仍为 O(n²)，只是降低表面刷新频率。该方案不能形成长期基线，不采用。

### 4.2 方案二：语义投影、帧级发布、批量检查点

每个原始通知只进入一次实时语义投影。投影立即更新内存中的权威状态，再分别产生帧级 UI 增量和批量持久化检查点。

该方案保留所有现有可见语义，同时移除 token 级永久事件和完整对象广播，是本设计采用的方案。

### 4.3 方案三：压缩原始事件日志

将全部原始通知写入压缩日志，再异步建立投影。该方案能够保留完整底层重放，但仍承担高事件数量、日志维护、重放和双存储复杂度。用户不需要旧原始诊断历史，因此不采用。

## 5. 总体架构

```text
ACP / XAI 原始通知
        |
        v
TaskRuntimeProjection
  - 消息与协议身份
  - 工具 / 子代理 / Gate / Goal / 队列
  - 增量上下文
        |
        +----------------------+
        |                      |
        v                      v
TaskFramePublisher      TaskPersistenceCoordinator
  <= 每 16 ms 一帧         <= 每 100 ms 一个全局事务
  关键状态立即发布          边界状态立即落盘
        |                      |
        v                      v
WebSocket TaskPatch          TaskStore
        |
        v
Renderer TaskPatchReconciler
        |
        v
现有任务页面与组件
```

### 5.1 TaskRuntimeProjection

它是活跃任务唯一的内存权威状态。每个原始协议通知仍被同步分类和处理，保证没有语义丢失，但不再默认创建永久事件。

内部维护：

- `TaskSnapshot`；
- 按稳定协议身份索引的父消息和子消息；
- 稀疏时间线项目；
- 工具调用、子代理、Gate、Goal、队列和活动状态；
- 增量 `TaskOperationalContextSnapshot`；
- 媒体引用索引；
- 待发布和待持久化的脏字段。

文本碎片只执行字符串追加、游标更新和脏标记。工具更新根据稳定 `toolCallId` 更新同一时间线项目。子代理更新根据 `childSessionId` 和协议消息身份更新同一子投影。未知协议只累计方法、次数和截断摘要。

### 5.2 TaskFramePublisher

发布器将同一屏幕帧内的变化合并为一个 `TaskPatch`：

- 流式文字最多每 16 ms 发布一次；
- Gate、权限问题、完成、失败、连接中断和删除等可操作状态立即发布；
- 同一个消息在一帧内的多个碎片合并为一个 append；
- 同一个工具、子代理或队列项目在一帧内只保留最新状态；
- WebSocket 出现背压时继续合并未发送 patch，不排队旧快照；
- revision 不连续时，Renderer 通过现有 HTTP 详情接口重新获取完整投影。

完整任务详情继续使用现有 `TaskDetailProjection` 可见模型，避免任务页面和组件被迫理解持久化细节。实时协议改为增量 `TaskPatch`：

- `messageAppends`：仅包含新增文字、最新游标和 streaming 状态；
- `messageUpserts`：新消息或媒体、delivery、protocol 等非追加字段变化；
- `eventUpserts`：稀疏展示事件的新增或就地更新；
- `eventRemovals`：语义项目被撤销时使用；
- `snapshotPatch`：只替换发生变化的顶层状态字段；
- `context`：仅在工具、子代理、Goal、Gate 等语义上下文改变时发布；
- `notifications`：已去重的完成、打断和等待通知意图。

文本碎片不会携带完整 `TaskSnapshot`、完整消息或完整上下文。

### 5.3 TaskPersistenceCoordinator

所有任务共享一个持久化协调器，避免 16 个活跃任务各自建立高频 SQLite 事务。

- 普通流式脏数据最多每 100 ms 合并为一个全局事务；
- 用户提示提交、Gate 创建或解决、turn 结束、连接状态变化、Rewind、Fork、删除和正常退出立即 flush；
- 活跃消息通过更新同一行追加文本，不创建 token 事件行；
- 同一个语义时间线项目通过稳定 ID upsert；
- flush 失败时保留待写批次并有限重试，实时内存状态和 UI 发布不回滚；
- 正常退出必须等待最终 flush，再停止后端和子进程；
- 原生会话重放能够补齐异常退出前最后一个未提交批次，并通过协议身份去重。

## 6. 新任务数据库

新权威文件为 `app-v2.sqlite`。新私有缓存目录固定为 `media-cache-v2`、`runs-v2` 和 `preview-cache-v2`；旧 `app.sqlite` 与旧缓存目录不参与新任务读取。

### 6.1 非任务状态

首次创建 v2 数据库时，从旧数据库只读导入：

- `projects`；
- `project_defaults`；
- `ui_state`；
- `new_task_drafts`。

主题资产目录、Grok Home 配置和其他文件系统设置保持原位置。下列旧数据不导入：

- `tasks`；
- `task_events`；
- `task_drafts`；
- `plan_review_drafts`；
- 任务队列状态；
- `action_journal`；
- 旧诊断和旧任务搜索索引。

导入以一次性 marker 记录，后续启动不会再次读取旧数据库。

### 6.2 任务表

`tasks`

- 保存任务身份、项目、原生 session、标题、连接/turn 摘要、revision、pin、时间和完整 `snapshot_json` 检查点；
- 非活跃任务列表只读取该表，不恢复消息。

`task_messages`

- 每个父或子 `TaskMessageBlock` 一行；
- 主键由 task、scope、turn 和 block 构成；
- 保存 role、text、streaming、delivery、protocol、paths、composer document、media、first/last cursor 和稳定排序序号；
- 流式内容更新同一行。

`task_timeline_items`

- 保存工具、子代理生命周期、Gate、Goal、队列、turn settlement 和其他可见语义项目；
- 每个项目具有稳定 ID，可 upsert；
- 不保存 agent/thought 文字碎片和重复协议状态。

`task_media_refs`

- 明确记录 task、message、placement 和 media 的关系；
- 启动时直接读取该表，不扫描 JSON 文本。

`task_search`

- 保持现有标题和用户提示搜索行为；
- 用户提示落盘时更新，不从事件表重建。

`diagnostics`

- 聚合未知方法、严重性、计数、首次/最后时间和短摘要；
- 不保存原始工具输入、长输出或完整协议负载。

## 7. 功能等价处理

### 7.1 消息、思考和工具

现有 `TaskMessageProtocolIdentity` 继续决定 PromptExecution、NativeTurn、ModelPass 和 MessageBlock 的归属。文字只改变存储形态，不改变分组和排序。工具调用使用稳定 ID 更新时间线项目，保留当前开始、运行、完成、失败和内容展示。

### 7.2 子代理与上下文

子代理消息保存为带 child scope 的 `task_messages`。父任务上下文仅维护工作项、状态和摘要，打开子代理详情时直接查询相应 scope，不从全部事件中过滤和重算。

Operational Context 改成事件到来时 O(1) 或与当前活动项目数量相关的 reducer。历史工作项在状态转换时归档一次，不在每个文字碎片到来时重新排序。

### 7.3 Gate、Goal、队列与通知

这些状态是用户可操作状态，更新立即写入 runtime projection 和 UI patch。通知由明确的语义状态转换产生，并使用稳定通知 ID 去重，不再遍历 delta events 推断。

### 7.4 Rewind 与 Fork

消息和时间线项目保留 first/last protocol cursor 及原生 prompt index。

- Rewind 成功后，在一个事务中删除目标 prompt 边界及其后的消息和时间线项目，重建任务搜索文本并清空相关计划草稿；
- Renderer 继续收到 `task.retired` 的 rewind 原因并重新获取完整详情；
- Fork 继续由官方 Grok API 创建原生会话，新任务通过 session load 建立自己的 v2 投影；
- 不复制或复活旧 v1 事件。

### 7.5 长文本粘贴与路径权限

`TextClipAuthorityStore` 改为直接读取 `task_messages` 中用户消息的 paths 和 composer document，而不是查询 `task_events`。新任务草稿仍参与临时文本文件的引用保护，保证长文本粘贴和路径节点不会被提前清理。

### 7.6 Source Control 写锁

项目写锁直接读取任务 snapshot 和用户消息 delivery 状态。它不再通过 `restoreTaskDetail` 重放整个历史，因此仍能阻止运行中 turn、Gate、后台工作或 Goal 与 Git 写操作冲突。

### 7.7 媒体

本地项目文件只保存引用，绝不复制后再把副本当权威文件。ACP inline 和远程媒体仍使用应用私有缓存，并由 `task_media_refs` 判断是否可回收。

文字流式期间的媒体发现使用增量尾部扫描并保留跨 chunk 边界窗口；turn 结束时执行一次完整校验。任何无法证明稳定的 Markdown 边界都留在活动尾部，不能为了缓存而改变媒体锚点。

## 8. Renderer 与富文本

Renderer 的 `TaskPatchReconciler` 按 revision 应用 append 和 upsert。消息文本只在对应 block 上追加，其他消息对象保持引用稳定，避免整条时间线重建。

`TaskThread` 仅在消息结构或稀疏时间线项目变化时重建 turn timeline；纯文字 append 只更新当前消息。

富文本采用保守的流式缓存：

- 每屏幕帧最多解析一次；
- 只有解析器能够证明不会被后续 Markdown 改写的前缀才能缓存；
- 当前未闭合段、围栏、HTML 岛、引用定义或跨块 bundle 保持在活动尾部；
- 无法证明安全时退回完整解析，优先保证输出一致；
- turn 结束后执行一次现有完整 pipeline 解析，并以其结果为最终权威。

现有 93 项富文本分段测试是最低基线，并增加流式分块与一次性完整解析的 HAST 等价测试。

## 9. 错误与恢复

### 9.1 WebSocket

- patch 的 `baseRevision` 必须等于 Renderer 当前 revision；
- 不连续、首次连接或解析失败时，丢弃局部 patch 并请求完整详情；
- 完整详情 revision 不得回滚较新的 Renderer 状态；
- 背压期间只保留合并后的最新待发送变化。

### 9.2 SQLite

- 每个 flush 是单个事务；
- 事务失败不清除脏集合；
- 有限重试仍失败时记录聚合诊断，并在 UI 保持任务运行；
- turn settlement、Rewind、Fork 和删除接口只有在所需事务成功后才返回成功。

### 9.3 进程生命周期

本地运行、预览和任务启动的子进程必须登记到统一 owner：

- 正常完成时回收进程和临时资源；
- 任务删除时停止该任务拥有的运行；
- 应用退出时停止全部登记进程组；
- 启动时只审计应用私有运行目录，不对无法证明归属的全局进程执行删除或 kill。

## 10. 新起点与清理流程

清理必须发生在新版本安装并通过真实 UI 验证之后。

1. 正常退出 Grok Build，确认没有活跃任务和主进程。
2. 创建 `app-v2.sqlite` 及 v2 私有缓存目录。
3. 从旧数据库只读导入非任务状态，并核对项目、默认值、UI state 和新任务草稿数量。
4. 启动新版本，完成创建任务、流式、工具、子代理、Gate、重启恢复和历史打开验证。
5. 再次退出应用并确认 v2 WAL 已 checkpoint。
6. 将旧 `app.sqlite`、`app.sqlite-wal`、`app.sqlite-shm`、旧 `media-cache`、`runs` 和 `preview-cache` 移到用户废纸篓中的独立恢复目录。
7. 不修改或删除 `/Users/alexwhite/.grok`。
8. 不扫描、推断或删除任何项目目录、Desktop、Documents 或 Home 下的真实文件。

清理结果应明确报告删除范围、废纸篓恢复位置和回收空间。用户自行清空废纸篓前，旧应用数据仍可恢复。

## 11. 测试策略

### 11.1 当前体验特征测试

在清理旧数据库前，从当前实现和代表性任务建立去敏后的等价样本，覆盖：

- 普通父消息与 thought；
- 多 ModelPass 与 Interject；
- 工具开始、更新、完成和失败；
- 子代理消息与生命周期；
- Gate、权限、问题和计划审核；
- Goal、队列与通知；
- 媒体、路径和长文本粘贴；
- session replay、断线恢复；
- Rewind 与 Fork。

同一输入在旧投影与新投影上的可见 `TaskDetailProjection` 必须等价。允许不同的只有内部数据库行数、内部 patch 分组、非可见诊断和生成的内部 ID；消息文字、顺序、协议分组、cursor、状态、媒体锚点和用户操作能力不得不同。

### 11.2 TDD

每个新组件先写失败测试并观察预期失败，再实现最小代码：

- runtime projection 语义归并；
- frame publisher 帧级合并和紧急 flush；
- persistence coordinator 全局事务批处理；
- TaskStore 创建、恢复、Rewind 和删除；
- patch reconciler 缺口恢复；
- 增量 context reducer；
- media refs 和 TextClip authority；
- 流式富文本等价；
- 子进程 owner 回收。

### 11.3 性能门槛

固定合成输入为 100,000 个两字符 agent chunk，并包含工具与子代理状态变化：

- 不产生 100,000 条数据库事件；
- 任务相关数据库文件小于 5 MB；
- 普通持久化全局不超过约 10 个事务/秒，边界 flush 单独统计；
- 单任务流式发布不超过每 16 ms 一次；
- WebSocket 文字负载不超过实际新增文字的 2 倍加 64 KB 固定协议开销；
- 30,000 旧事件等价内容的 v2 完整读取在当前 Mac 热缓存下低于 100 ms；
- 单次完整读取额外 RSS 低于 50 MB；
- 冷启动不执行按消息 JSON 内容扫描的查询；
- 同一固定 workload 相比旧实现，CPU 时间、写入次数和序列化字节数均至少下降 10 倍。

墙钟和 RSS 门槛由独立性能脚本报告，语义正确性测试不能依赖易波动的时间断言。

### 11.4 完成验证

完成前必须执行：

- 三套 TypeScript typecheck；
- 所有新增单元与集成测试；
- Web 和 server/shell 完整构建；
- 架构边界、未使用代码和重复代码检查；
- 新旧固定 workload 对照；
- 安装包构建和替换；
- macOS 原生窗口中的真实任务流程验证；
- 冷启动、空闲、活跃流式和大型任务打开的进程采样；
- 应用退出后的 Grok Build 进程、端口和登记子进程归零检查。

## 12. 完成标准

只有同时满足以下条件才算完成：

1. 当前可见功能和体验没有退化；
2. 新任务不再写入 token 级永久事件；
3. 实时协议不再重复发送完整累计消息；
4. Operational Context 不再按文字碎片全量重算；
5. 历史任务从投影表直接恢复；
6. 冷启动不再扫描任务事件 JSON；
7. 新链路接管后旧实现、旧类型、旧查询和残留引用已清除；
8. 量化性能门槛通过；
9. 新安装包在真实 macOS 应用中验证；
10. 旧应用任务数据按确认范围移入废纸篓，原生 Grok 会话和真实项目文件保持不变。
