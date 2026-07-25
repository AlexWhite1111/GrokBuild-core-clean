# Grok Build Task Runtime Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current Grok Build task experience exactly while replacing token-level persistence, full-detail realtime broadcasts, repeated history projection, and unbounded child-process ownership with a v2 semantic task runtime.

**Architecture:** ACP/XAI notifications update one in-memory task projection. A frame publisher emits bounded `TaskPatch` objects, while one global persistence coordinator commits semantic message/timeline changes to `app-v2.sqlite`. History, search, media references, source-control locks, Rewind, and text-clip authority read the same v2 projection tables. The renderer applies patches by revision and retains object identity for unaffected blocks.

**Tech Stack:** TypeScript, Node 22 `node:test`, `node:sqlite` `DatabaseSync`, XState, WebSocket, React 19, Vite, Electron, unified/remark/rehype rich-text pipeline.

**Global Constraints:**

- Preserve every user-visible task behavior, order, action, status, notification, media placement, rich-text result, and restart/reconnect outcome.
- Do not read old tasks from `app.sqlite`; import only projects, project defaults, UI state, and new-task drafts once.
- Do not delete or modify `/Users/alexwhite/.grok`, project directories, or real generated files.
- Do not move the old database or caches to Trash until the installed v2 app passes the real UI checklist.
- Every capability must end with one authoritative path. Remove `TaskDetailDelta`, `TaskDeltaBuffer`, token event persistence, JSON media scans, and restore-by-event-replay after their replacements are proven.
- Keep all existing unrelated worktree changes intact. Each implementation commit stages only files named by its task.
- Use co-located `*.test.ts` files and `node --import tsx --test`; do not restore the deleted Vitest harness.

---

## Task 1: Freeze the Current Visible Projection Contract

**Files:**

- Create: `src/server/tasks/taskProjection.characterization.test.ts`
- Create: `src/server/tasks/taskProjectionFixtures.ts`
- Create: `src/renderer/api/taskDetailContract.characterization.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a deterministic projection fixture**

Create `taskProjectionFixtures.ts` with:

~~~ts
export interface ProjectionFixtureStep {
  kind: "acp" | "xai" | "gate-add" | "gate-remove";
  turnId: string | null;
  method?: string;
  params: unknown;
}
~~~

Export `visibleProjectionFixture` with fixed task `task-fixture`, session `session-parent`, child `session-child`, request `request-1`, prompt `prompt-1`, tool `tool-1`, Gate `gate-1`, timestamps beginning `2026-07-20T00:00:00.000Z`, and monotonically increasing sequence values. Its exact ordered steps are: local user prompt, parent thought chunks, first agent model pass, tool start/update/complete, second agent model pass, child start/message/tool/completion, queue add/remove, Goal set/complete, permission Gate add/remove, image syntax split across two chunks, and turn completion. Copy every payload shape from the currently accepted branches in `TaskProjection.applyAcpNotification`, `TaskProjection.applyXaiNotification`, and `TaskProjection.addGate`; do not invent alternate event formats.

- [ ] **Step 2: Write the failing characterization test**

The test constructs a temporary `AppDatabase`, creates a current `TaskProjection`, applies every fixture step, and asserts a checked-in normalized object containing:

~~~ts
assert.deepEqual(normalizeVisibleDetail(projection.detail()), {
  messageOrder: [
    "user:prompt-1",
    "thought:parent-thought-1",
    "agent:parent-answer-1",
  ],
  parentAnswer: "完整的父任务答案",
  toolStates: [{ id: "tool-1", status: "completed" }],
  childSessions: [{ sessionId: "child-1", status: "completed" }],
  gateCount: 0,
  goalStatus: "complete",
  queueSize: 0,
});
~~~

Also assert stable `TaskMessageProtocolIdentity`, first/last cursor, media placement, child detail, and `TaskOperationalContextSnapshot`. The first run may expose missing fixture fields; fix only the fixture until it represents the current runtime.

- [ ] **Step 3: Characterize renderer detail immutability**

Write a pure test that freezes a `TaskDetailProjection`, clones it through the current serialization boundary, and verifies all fields used by `TaskThread`, `TaskContext`, Composer/Gates, sidebar status, and notifications survive unchanged.

- [ ] **Step 4: Add the task-runtime test script**

Add:

~~~json
"test:task-runtime": "node --import tsx --test 'src/**/*.characterization.test.ts' 'src/**/*.runtime.test.ts' 'src/**/*.store.test.ts' 'src/**/*.patch.test.ts'"
~~~

- [ ] **Step 5: Run the contract tests**

Run:

~~~bash
npm run test:task-runtime
npm run test:segmentation
~~~

Expected: characterization tests and all 93 segmentation tests pass before architecture changes.

- [ ] **Step 6: Commit the characterization baseline**

~~~bash
git add package.json src/server/tasks/taskProjection.characterization.test.ts src/server/tasks/taskProjectionFixtures.ts src/renderer/api/taskDetailContract.characterization.test.ts
git commit -m "test: freeze task projection experience"
~~~

## Task 2: Create the V2 Database and One-Time Non-Task Import

**Files:**

- Modify: `src/server/config.ts`
- Modify: `src/server/storage/AppDatabase.ts`
- Create: `src/server/storage/LegacyAppDataImporter.ts`
- Create: `src/server/storage/LegacyAppDataImporter.store.test.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write failing import tests**

Build a temporary legacy database with two projects, project defaults, two UI-state rows, two new-task drafts, one task, and three task events. Open an empty v2 database and run the importer twice.

Assert:

~~~ts
assert.equal(count(v2, "projects"), 2);
assert.equal(count(v2, "project_defaults"), 2);
assert.equal(count(v2, "ui_state"), 2);
assert.equal(count(v2, "new_task_drafts"), 2);
assert.equal(count(v2, "tasks"), 0);
assert.equal(count(v2, "task_messages"), 0);
assert.equal(importMarker(v2), "complete");
~~~

Also prove the second run is a no-op and a missing legacy file creates a complete marker without failure.

- [ ] **Step 2: Define explicit v1 and v2 paths**

In `config.ts` export:

~~~ts
export const LEGACY_DATABASE_FILE = path.join(APP_HOME, "app.sqlite");
export const V2_DATABASE_FILE = path.join(APP_HOME, "app-v2.sqlite");
// Removed at Task 8 when the server atomically switches to v2.
export const DATABASE_FILE = LEGACY_DATABASE_FILE;
export const LEGACY_MEDIA_CACHE_HOME = path.join(APP_HOME, "media-cache");
export const V2_MEDIA_CACHE_HOME = path.join(APP_HOME, "media-cache-v2");
export const MEDIA_CACHE_HOME = LEGACY_MEDIA_CACHE_HOME;
export const LEGACY_PREVIEW_CACHE_HOME = path.join(APP_HOME, "preview-cache");
export const V2_PREVIEW_CACHE_HOME = path.join(APP_HOME, "preview-cache-v2");
export const PREVIEW_CACHE_HOME = LEGACY_PREVIEW_CACHE_HOME;
export const LEGACY_RUNS_HOME = path.join(APP_HOME, "runs");
export const V2_RUNS_HOME = path.join(APP_HOME, "runs-v2");
export const RUNS_HOME = LEGACY_RUNS_HOME;
~~~

Environment overrides used by tests must remain authoritative. Task 8 switches the three live cache aliases to their v2 paths together with the task database; switching them earlier would make old task media appear missing in an intermediate build.

- [ ] **Step 3: Replace the empty-database task schema**

Refactor `AppDatabase` to accept a temporary explicit `schema: "legacy" | "v2"` construction option. Existing production construction remains `legacy` until the atomic server cutover in Task 8; tests and the importer construct `schema: "v2"`. Task 13 removes the legacy construction option. A new v2 file creates the non-task tables plus:

~~~sql
CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  session_id TEXT UNIQUE,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  grok_home_id TEXT NOT NULL DEFAULT 'native',
  config_json TEXT NOT NULL DEFAULT '{}',
  snapshot_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE task_messages (
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('parent', 'child')),
  scope_id TEXT NOT NULL,
  turn_id TEXT,
  role TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  block_json TEXT NOT NULL,
  first_epoch INTEGER,
  first_sequence INTEGER,
  last_epoch INTEGER,
  last_sequence INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(task_id, message_id)
) STRICT;

CREATE INDEX task_messages_order
  ON task_messages(task_id, scope_kind, scope_id, ordinal);

CREATE TABLE task_timeline_items (
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('parent', 'child')),
  scope_id TEXT NOT NULL,
  turn_id TEXT,
  ordinal INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  first_epoch INTEGER,
  first_sequence INTEGER,
  last_epoch INTEGER,
  last_sequence INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(task_id, item_id)
) STRICT;

CREATE TABLE task_media_refs (
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  placement_key TEXT NOT NULL,
  PRIMARY KEY(task_id, message_id, media_id, placement_key)
) STRICT;

CREATE TABLE legacy_imports (
  import_key TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  summary_json TEXT NOT NULL
) STRICT;
~~~

Keep the current FTS behavior, but make `task_search.prompt` update from user-message rows rather than `task_events`.

- [ ] **Step 4: Implement the importer**

`LegacyAppDataImporter.importOnce()` must:

1. return immediately when marker `legacy-v1-non-task` exists;
2. open the legacy file read-only;
3. copy only the four approved table groups in one v2 transaction;
4. validate imported counts;
5. insert the marker with the counts;
6. close the legacy connection in `finally`.

Never query or copy `tasks`, `task_events`, task drafts, plan drafts, action journal, diagnostics, or search rows.

- [ ] **Step 5: Wire startup order**

Add a tested `prepareV2Database(V2_DATABASE_FILE, LEGACY_DATABASE_FILE)` startup helper, but do not invoke it from the production server yet. Task 8 invokes it before repositories/supervisors are constructed at the same moment the runtime switches to `TaskStore`. The helper logs only counts and source path—never draft contents.

- [ ] **Step 6: Verify**

~~~bash
npm run test:task-runtime
npm run typecheck
~~~

Expected: import tests pass; the v2 file can be created independently; the live server still uses the unchanged v1 runtime until Task 8 so no intermediate commit can start with a half-migrated task chain.

- [ ] **Step 7: Commit**

~~~bash
git add src/server/config.ts src/server/storage/AppDatabase.ts src/server/storage/LegacyAppDataImporter.ts src/server/storage/LegacyAppDataImporter.store.test.ts src/server/index.ts
git commit -m "feat: establish v2 application database"
~~~

## Task 3: Make TaskStore the Sole Persistent Task Projection

**Files:**

- Create: `src/server/tasks/TaskStore.ts`
- Create: `src/server/tasks/TaskStore.store.test.ts`
- Modify: `src/server/storage/AppDatabase.ts`

- [ ] **Step 1: Write failing CRUD and append tests**

Use one task with a parent user block, an agent block, a child block, a tool item, and media refs. Perform 10,000 two-character appends to the same agent message.

Assert:

~~~ts
assert.equal(store.readDetail(taskId)?.messages[1].text.length, 20_000);
assert.equal(count(db, "task_messages"), 3);
assert.equal(count(db, "task_timeline_items"), 1);
assert.equal(store.hasUnresolvedUserDelivery(taskId), false);
assert.deepEqual(store.mediaIdsInUse(), ["media-1"]);
~~~

Then test search, pin, rename, delete, child-scope read, and missing-task behavior.

- [ ] **Step 2: Define the store contract**

~~~ts
export interface TaskStoreBatch {
  task: TaskSnapshot;
  context: TaskOperationalContextSnapshot;
  pinned: boolean;
  messageUpserts: readonly TaskMessageBlock[];
  messageAppends: readonly {
    messageId: string;
    text: string;
    streaming: boolean;
    lastCursor: TaskEventCursor | null;
    block: TaskMessageBlock;
  }[];
  timelineUpserts: readonly TaskEventEnvelope[];
  timelineRemovals: readonly string[];
  mediaRefsByMessage: ReadonlyMap<string, readonly TaskMediaPlacementRef[]>;
  searchPromptAppends: readonly string[];
}

export class TaskStore {
  writeBatch(batch: TaskStoreBatch): void;
  writeBatches(batches: readonly TaskStoreBatch[]): void;
  readDetail(taskId: string): TaskDetailProjection | null;
  readChildDetail(taskId: string, sessionId: string): TaskDetailProjection | null;
  list(query?: string): TaskListItem[];
  hasUnresolvedUserDelivery(taskId: string): boolean;
  rewindFrom(taskId: string, cursor: TaskEventCursor): void;
  deleteTask(taskId: string): void;
  mediaIdsInUse(): string[];
}
~~~

Use the exact cursor type already represented by `connectionEpoch` and `sequence`; do not introduce a second cursor vocabulary.

- [ ] **Step 3: Implement atomic writes**

`writeBatch` delegates to `writeBatches([batch])`; `writeBatches` performs exactly one `AppDatabase.transaction` for all supplied tasks. The global coordinator calls `writeBatches`, so 16 active tasks still share one transaction. Message append uses:

~~~sql
UPDATE task_messages
SET text = text || ?,
    block_json = ?,
    last_epoch = ?,
    last_sequence = ?,
    updated_at = ?
WHERE task_id = ? AND message_id = ?
~~~

If the row is missing, treat that as an invariant error and keep the coordinator batch dirty. Upserts serialize the full visible block only at persistence cadence, never per protocol chunk.

- [ ] **Step 4: Implement direct reads and Rewind**

`readDetail` loads one snapshot row, ordered parent message rows, ordered parent timeline rows, and `context_json`. It must not call `restoreTaskDetail`, `messagesFromEvents`, or `projectTaskOperationalContext`.

`rewindFrom` deletes rows whose first cursor is at or after the target and truncates a row whose first cursor precedes but last cursor crosses the target. Rebuild search text from surviving user rows in the same transaction.

- [ ] **Step 5: Verify row-count invariants**

~~~bash
npm run test:task-runtime
npm run typecheck
~~~

- [ ] **Step 6: Commit**

~~~bash
git add src/server/tasks/TaskStore.ts src/server/tasks/TaskStore.store.test.ts src/server/storage/AppDatabase.ts
git commit -m "feat: persist semantic task projections"
~~~

## Task 4: Define the Incremental TaskPatch Protocol

**Files:**

- Create: `src/shared/contracts/taskPatch.ts`
- Create: `src/server/tasks/TaskPatchBuffer.ts`
- Create: `src/server/tasks/TaskPatchBuffer.patch.test.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/shared/contracts/task.ts`

- [ ] **Step 1: Write failing patch merge tests**

Test that 1,000 appends to one message merge into one append, two updates to one tool keep the latest item, snapshot fields merge shallowly, removals cancel pending upserts, and notifications deduplicate by ID.

~~~ts
assert.deepEqual(buffer.drain(41, 42), {
  taskId: "task-1",
  baseRevision: 41,
  revision: 42,
  messageAppends: [{ messageId: "answer-1", text: "ab".repeat(1_000), streaming: true, lastCursor }],
  messageUpserts: [],
  eventUpserts: [completedTool],
  eventRemovals: [],
  snapshotPatch: { turn: "running" },
  notifications: [],
});
~~~

- [ ] **Step 2: Add serializable patch types and schemas**

~~~ts
export interface TaskPatch {
  taskId: string;
  baseRevision: number;
  revision: number;
  snapshotPatch: Partial<TaskSnapshot>;
  messageAppends: TaskMessageAppend[];
  messageUpserts: TaskMessageBlock[];
  eventUpserts: TaskEventEnvelope[];
  eventRemovals: string[];
  context?: TaskOperationalContextSnapshot;
  notifications: TaskNotificationIntent[];
}
~~~

Add a Zod schema at the WebSocket trust boundary. `Partial<TaskSnapshot>` is only a compile-time description; the schema must enumerate allowed top-level fields and reject `taskId`, `projectId`, `revision`, and `createdAt` inside `snapshotPatch`. The reconciler sets `snapshot.revision` from patch `revision`; `updatedAt` remains an allowed visible change.

- [ ] **Step 3: Implement TaskPatchBuffer**

Use maps keyed by message/event/notification identity. Appends concatenate in arrival order. A message upsert absorbs any earlier append for that message and later appends remain separate. `drain` returns `null` when empty and clears only after constructing a valid patch.

- [ ] **Step 4: Remove the public full-delta contract**

Delete `TaskDetailDelta` only after all compile errors are listed for Task 9. Until then, export `TaskPatch` alongside it and mark full delta internal with no new references.

- [ ] **Step 5: Verify**

~~~bash
npm run test:task-runtime
npm run typecheck
~~~

- [ ] **Step 6: Commit**

~~~bash
git add src/shared/contracts/taskPatch.ts src/shared/contracts.ts src/shared/contracts/task.ts src/server/tasks/TaskPatchBuffer.ts src/server/tasks/TaskPatchBuffer.patch.test.ts
git commit -m "feat: define bounded task patch protocol"
~~~

## Task 5: Add Frame-Level Publishing and Global Persistence Coordination

**Files:**

- Create: `src/server/tasks/TaskFramePublisher.ts`
- Create: `src/server/tasks/TaskFramePublisher.runtime.test.ts`
- Create: `src/server/tasks/TaskPersistenceCoordinator.ts`
- Create: `src/server/tasks/TaskPersistenceCoordinator.runtime.test.ts`
- Create: `src/server/tasks/RuntimeScheduler.ts`

- [ ] **Step 1: Write deterministic scheduler tests**

Use a manual scheduler. Queue 100 text changes in one 16 ms window; assert one patch. Queue a Gate immediately afterward; assert it publishes without advancing time. Queue changes for 16 tasks in one 100 ms persistence window; assert one database transaction.

~~~ts
assert.equal(frameSink.calls.length, 1);
assert.equal(frameSink.calls[0].messageAppends[0].text, "ab".repeat(100));
assert.equal(persistenceSink.transactions, 1);
assert.equal(persistenceSink.batches.length, 16);
~~~

Test retry: the first transaction throws, dirty work remains, the retry succeeds, and no append is duplicated.

- [ ] **Step 2: Implement injectable scheduling**

~~~ts
export interface RuntimeScheduler {
  now(): number;
  schedule(delayMs: number, callback: () => void): { cancel(): void };
}
~~~

Production uses `setTimeout` with `unref`; tests use an explicit `advanceBy`.

- [ ] **Step 3: Implement TaskFramePublisher**

One publisher belongs to one active task. Ordinary changes schedule the next 16 ms drain. `urgent()` drains synchronously. If the sink reports backpressure, merge the drained patch back into the buffer and retain only one scheduled retry.

- [ ] **Step 4: Implement TaskPersistenceCoordinator**

One coordinator belongs to `TaskSupervisor`, not each actor. `markDirty(taskId, changes)` merges task batches; `flushBoundary(taskId)` commits immediately; `flushAll()` commits every dirty task in one transaction. Retry delays are 100 ms, 250 ms, and 1,000 ms, then a diagnostic is aggregated while dirty state remains available for the next boundary/exit flush.

- [ ] **Step 5: Add counters**

Expose read-only counters for tests and diagnostics:

~~~ts
interface RuntimePerformanceCounters {
  frameFlushes: number;
  persistenceTransactions: number;
  patchBytes: number;
  appendedTextBytes: number;
  retryCount: number;
}
~~~

- [ ] **Step 6: Verify and commit**

~~~bash
npm run test:task-runtime
npm run typecheck
git add src/server/tasks/TaskFramePublisher.ts src/server/tasks/TaskFramePublisher.runtime.test.ts src/server/tasks/TaskPersistenceCoordinator.ts src/server/tasks/TaskPersistenceCoordinator.runtime.test.ts src/server/tasks/RuntimeScheduler.ts
git commit -m "feat: batch task frames and persistence"
~~~

## Task 6: Replace Full Context Reprojection with an Incremental Reducer

**Files:**

- Create: `src/server/tasks/TaskOperationalContextReducer.ts`
- Create: `src/server/tasks/TaskOperationalContextReducer.runtime.test.ts`
- Modify: `src/server/tasks/TaskProjection.ts`

- [ ] **Step 1: Write oracle-equivalence tests**

For each prefix of `visibleProjectionFixture`, compare the new reducer result with current `projectTaskOperationalContext(events)` after normalizing generated timestamps. Include tool reuse across fallback turns, child completion, Goal pause/resume/complete, Gate open/close, queued prompts, and connection interruption.

Then apply 100,000 agent text chunks and assert the reducer semantic-recompute counter does not change.

- [ ] **Step 2: Implement reducer state**

Index active and historical work by stable semantic IDs. Only these methods may mutate it:

- tool call start/update;
- child session lifecycle;
- Gate add/remove;
- Goal transition;
- queue change;
- turn settlement;
- connection state transition.

Agent/thought text append updates no context index. `snapshot()` sorts only when a semantic item changes and returns the previous object by reference otherwise.

- [ ] **Step 3: Integrate behind the existing projection output**

`TaskProjection.detail().context` returns the reducer snapshot. During this task, keep current event recording for the characterization oracle, but no longer invoke `projectTaskOperationalContext` on normal live changes.

- [ ] **Step 4: Verify**

~~~bash
npm run test:task-runtime
npm run typecheck
~~~

Expected: every semantic fixture prefix is equivalent; text-only workload causes zero context recomputes.

- [ ] **Step 5: Commit**

~~~bash
git add src/server/tasks/TaskOperationalContextReducer.ts src/server/tasks/TaskOperationalContextReducer.runtime.test.ts src/server/tasks/TaskProjection.ts
git commit -m "perf: project task context incrementally"
~~~

## Task 7: Build the V2 Runtime Projection Behind a Test-Only Seam

**Files:**

- Create: `src/server/tasks/TaskRuntimeProjection.ts`
- Create: `src/server/tasks/TaskRuntimeTranscript.ts`
- Create: `src/server/tasks/TaskRuntimeProjection.runtime.test.ts`

- [ ] **Step 1: Write a high-volume failing runtime test**

Feed 100,000 two-character parent-agent chunks, tool state changes, one child message, a Gate, and turn completion through the same public notification methods used by `TaskClientEvents`.

Assert:

~~~ts
assert.equal(projection.detail().messages.find(isAnswer)?.text.length, 200_000);
assert.equal(projection.rawEventCount, 0);
assert.ok(projection.pendingMessageRows <= 3);
assert.ok(counters.frameFlushes <= expectedFrames);
assert.ok(counters.persistenceTransactions <= expectedPersistenceWindows + boundaryFlushes);
~~~

Also deep-compare the final normalized detail with the Task 1 characterization result.

- [ ] **Step 2: Split transient appends from semantic mutations**

`TaskTranscript` owns stable message identity and returns one of:

~~~ts
type TranscriptMutation =
  | { kind: "append"; messageId: string; text: string; streaming: boolean; cursor: TaskEventCursor }
  | { kind: "upsert"; message: TaskMessageBlock }
  | { kind: "none" };
~~~

Text chunks mutate one in-memory block and enqueue append metadata. They do not call `record`, allocate `TaskEventEnvelope`, clone all messages, or serialize protocol payloads.

- [ ] **Step 3: Upsert semantic timeline items**

Tools, child lifecycle, Gate, Goal, queue, settlement, and connection events get stable `itemId` values derived from existing protocol IDs. The latest visible `TaskEventEnvelope` replaces the same item. Unknown methods update aggregate diagnostics only.

- [ ] **Step 4: Route every notification once**

Expose one `TaskRuntimeProjection.applyNotification` entrypoint that returns:

- patch mutations to enqueue;
- persistence mutations to mark dirty;
- `urgent` and `flushBoundary` flags for Gate/settlement/disconnect/delete/rewind boundaries;
- accepted request IDs and context-window refresh intent currently consumed by `TaskClientEvents`.

This component is exercised only by tests until Task 8. Do not route production notifications through it while TaskDetailReader and the supervisor still depend on v1 event history.

- [ ] **Step 5: Preserve replay deduplication**

`beginSessionReplay/endSessionReplay` compare stable protocol identity against stored messages/timeline items. Replay fills a missing final tail after an abnormal exit but never duplicates an already persisted block.

- [ ] **Step 6: Verify and commit**

~~~bash
npm run test:task-runtime
npm run test:segmentation
npm run typecheck
git add src/server/tasks/TaskRuntimeProjection.ts src/server/tasks/TaskRuntimeTranscript.ts src/server/tasks/TaskRuntimeProjection.runtime.test.ts
git commit -m "perf: project protocol changes once"
~~~

## Task 8: Move History, Search, Media, Locks, and Rewind to TaskStore

**Files:**

- Modify: `src/server/tasks/TaskDetailReader.ts`
- Modify: `src/server/tasks/TaskHistoryCoordinator.ts`
- Modify: `src/server/tasks/taskHistory.ts`
- Modify: `src/server/tasks/taskHistoryMutation.ts`
- Modify: `src/server/tasks/TaskActivationCoordinator.ts`
- Modify: `src/server/tasks/TaskActor.ts`
- Modify: `src/server/tasks/TaskClientEvents.ts`
- Modify: `src/server/tasks/TaskProjection.ts`
- Modify: `src/server/tasks/TaskTranscript.ts`
- Modify: `src/server/tasks/taskTypes.ts`
- Modify: `src/server/tasks/taskActorOptions.ts`
- Modify: `src/server/tasks/taskActorRuntimeContext.ts`
- Modify: `src/server/storage/TextClipAuthorityStore.ts`
- Modify: `src/server/tasks/ProjectSourceControlBarrier.ts`
- Modify: `src/server/media/MediaArtifactStore.ts`
- Modify: `src/server/media/taskMediaCacheReferences.ts`
- Modify: `src/server/tasks/TaskSupervisor.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/index.ts`
- Create: `src/server/tasks/TaskStoreConsumers.store.test.ts`

- [ ] **Step 1: Write consumer integration tests**

Persist a task whose event table is absent. Assert:

- task detail and child detail reopen identically;
- title and Chinese prompt search work;
- pending/unknown user delivery blocks source-control writes;
- accepted delivery allows them;
- text-clip references include message paths/composer documents and new-task drafts;
- media GC retains referenced private artifacts and releases unreferenced ones;
- Rewind removes the target prompt and all following content, clears the plan draft, updates search, and emits retirement/refetch intent;
- Fork still delegates to official Grok API and creates a fresh v2 task from session load.

- [ ] **Step 2: Replace restore and list reads**

`TaskDetailReader`, `TaskActivationCoordinator`, and `TaskHistoryCoordinator` call `TaskStore.readDetail/readChildDetail`. Task lists and search call `TaskStore.list`. No production read may select `task_events`.

At this step, atomically switch `DATABASE_FILE` to `V2_DATABASE_FILE`, invoke `prepareV2Database` before constructing services, and inject one `TaskStore`, `TaskPersistenceCoordinator`, and frame sink through `TaskSupervisor` into every `TaskActor`.

- [ ] **Step 3: Replace authority scans**

`TextClipAuthorityStore` queries user `task_messages.block_json` plus `new_task_drafts`. Source control uses snapshot rows and `TaskStore.hasUnresolvedUserDelivery`. Media startup reads `task_media_refs.media_id` directly.

- [ ] **Step 4: Replace history mutation**

After native Rewind succeeds, one v2 transaction calls `TaskStore.rewindFrom`, clears related drafts, bumps revision, and publishes task retirement. Fork never copies v1 rows.

- [ ] **Step 5: Remove event-history implementation**

Delete production `readTaskEvents`, `messagesFromEvents`, restore-only correlation functions, startup JSON media scans, and event-derived search rebuilding. Move the old equivalence oracle into `taskProjection.characterization.test.ts`; no old projector remains in production.

Replace `TaskProjection` and `TaskTranscript` exports with the v2 implementations, update `TaskClientEvents` to call the single `applyNotification` entrypoint, and remove the temporary `TaskRuntimeProjection`/transcript filenames after moving their implementation into the canonical files. New implementation takeover and old-path removal happen in this one task.

- [ ] **Step 6: Verify absence and behavior**

~~~bash
npm run test:task-runtime
npm run typecheck
rg -n "task_events|restoreTaskDetail|messagesFromEvents|projectTaskOperationalContext" src/server --glob '!**/*.test.ts'
~~~

Expected: no production task-history or authority path references `task_events`.

- [ ] **Step 7: Commit**

Stage only the listed source/test files and commit:

~~~bash
git commit -m "refactor: read task capabilities from semantic store"
~~~

## Task 9: Switch WebSocket and Renderer to TaskPatch

**Files:**

- Modify: `src/server/protocol/TaskSocketServer.ts`
- Modify: `src/server/tasks/TaskActor.ts`
- Modify: `src/server/tasks/TaskSupervisor.ts`
- Create: `src/renderer/api/taskPatchReconciler.ts`
- Create: `src/renderer/api/taskPatchReconciler.patch.test.ts`
- Modify: `src/renderer/api/ApiClient.ts`
- Modify: `src/renderer/api/BootstrapContext.tsx`
- Modify: `src/renderer/api/hooks.ts`
- Modify: `src/shared/contracts/task.ts`
- Delete: `src/renderer/api/taskDeltaReconciler.ts`

- [ ] **Step 1: Write patch reconciler tests**

Cover append, upsert, event replacement/removal, snapshot patch, context replacement, notification delivery, duplicate patch, stale patch, and revision gap.

~~~ts
assert.equal(applyTaskPatch(detail41, patch41to42).kind, "applied");
assert.equal(applyTaskPatch(detail41, patch43to44).kind, "refetch");
assert.equal(applyTaskPatch(detail42, patch41to42).kind, "ignored");
assert.strictEqual(applied.detail.messages[0], detail41.messages[0]);
assert.notStrictEqual(applied.detail.messages[1], detail41.messages[1]);
~~~

- [ ] **Step 2: Publish patches with backpressure awareness**

`TaskSocketServer` sends `task.patch`, checks `bufferedAmount`, and reports congestion to `TaskFramePublisher`. It never constructs or serializes full detail for a normal update. Initial subscribe and explicit refetch continue through the existing HTTP detail endpoint.

- [ ] **Step 3: Apply patches by revision**

`taskPatchReconciler` performs copy-on-write only for affected collections/objects. On a gap, malformed patch, missing target block, or task mismatch, it returns `refetch`. `BootstrapContext` serializes one refetch per task and refuses a detail response older than its current revision.

- [ ] **Step 4: Preserve notification semantics**

Deliver `patch.notifications` through current notification helpers exactly once by stable notification ID. Do not derive completion/waiting notifications by scanning `eventUpserts`.

- [ ] **Step 5: Remove full-delta path**

Delete `TaskDetailDelta`, `TaskDeltaBuffer`, the renderer delta reconciler, `task.delta` WebSocket handling, and all imports. There must be one realtime task path.

- [ ] **Step 6: Verify**

~~~bash
npm run test:task-runtime
npm run typecheck
rg -n "TaskDetailDelta|TaskDeltaBuffer|task\\.delta" src
~~~

Expected: tests pass and the final search has no results.

- [ ] **Step 7: Commit**

Stage only the Task 9 files and commit:

~~~bash
git commit -m "perf: stream bounded task patches"
~~~

## Task 10: Keep the Task Thread Structurally Stable During Streaming

**Files:**

- Modify: `src/renderer/thread/TaskThread.tsx`
- Modify: `src/renderer/thread/GrokTurnFlow.tsx`
- Modify: `src/renderer/thread/MessageBlock.tsx`
- Modify: `src/renderer/thread/RichText.tsx`
- Create: `src/renderer/thread/streamingRichText.ts`
- Create: `src/renderer/thread/streamingRichText.runtime.test.ts`
- Create: `src/renderer/thread/taskThreadStructure.runtime.test.ts`

- [ ] **Step 1: Write structure and rich-text equivalence tests**

For every split point of the 93 existing segmentation cases, feed prefix chunks through `streamingRichText`, finalize, and deep-compare final HAST to one-shot `richTextPipeline`.

Test unfinished fences, HTML islands, link definitions, tables, math, media bundles, paths, and code. Assert unsafe prefixes use `mode: "full"`, never a guessed cached prefix.

For thread structure, append text 1,000 times to the active block and assert timeline grouping runs once while the active `MessageBlock` updates.

- [ ] **Step 2: Implement a conservative prefix cache**

~~~ts
interface StreamingRichTextState {
  committedSource: string;
  committedTree: Root | null;
  activeSource: string;
  mode: "incremental" | "full";
}
~~~

Commit a prefix only after the existing parser proves a completed top-level block with no open fence/HTML island/reference dependency/media bundle. Any ambiguity uses full parsing. Finalization always runs the current one-shot pipeline and replaces cached output.

- [ ] **Step 3: Limit parsing to one animation frame**

`RichText` coalesces source updates with `requestAnimationFrame`. Urgent non-text UI is not delayed. Cancel scheduled work on unmount and on block identity change.

- [ ] **Step 4: Preserve collection identity**

`TaskThread` memoizes turn structure by ordered message IDs, event IDs, roles, turns, and structural protocol fields—not by message text. Pure append updates the existing block without rebuilding all turns.

- [ ] **Step 5: Verify**

~~~bash
npm run test:segmentation
npm run test:task-runtime
npm run typecheck
~~~

- [ ] **Step 6: Commit**

~~~bash
git add src/renderer/thread/TaskThread.tsx src/renderer/thread/GrokTurnFlow.tsx src/renderer/thread/MessageBlock.tsx src/renderer/thread/RichText.tsx src/renderer/thread/streamingRichText.ts src/renderer/thread/streamingRichText.runtime.test.ts src/renderer/thread/taskThreadStructure.runtime.test.ts
git commit -m "perf: stabilize streaming task rendering"
~~~

## Task 11: Bound Incremental Media Discovery

**Files:**

- Modify: `src/server/tasks/taskMediaProjection.ts`
- Modify: `src/server/media/MediaArtifactStore.ts`
- Create: `src/server/tasks/taskMediaProjection.runtime.test.ts`

- [ ] **Step 1: Write split-boundary tests**

Split valid media syntax at every character boundary, including local paths, ACP inline media, remote private media, Markdown images, HTML media, and adjacent bundles. Feed chunks and compare final placements with one-shot current discovery.

Assert a 200,000-character plain-text stream scans no more than appended length plus a fixed 8 KB tail per finalization, rather than rescanning the full accumulated string per chunk.

- [ ] **Step 2: Implement tail scanning**

Track per-message scan offset plus an unresolved tail capped at 8 KB. Do not finalize a candidate crossing the tail boundary. Turn completion runs one full validation and writes the authoritative `task_media_refs` set.

- [ ] **Step 3: Verify and commit**

~~~bash
npm run test:task-runtime
npm run typecheck
git add src/server/tasks/taskMediaProjection.ts src/server/media/MediaArtifactStore.ts src/server/tasks/taskMediaProjection.runtime.test.ts
git commit -m "perf: discover streaming media incrementally"
~~~

## Task 12: Establish Unified Owned-Process Shutdown

**Files:**

- Create: `src/server/runtime/OwnedProcessRegistry.ts`
- Create: `src/server/runtime/OwnedProcessRegistry.runtime.test.ts`
- Modify: `src/server/acp/OfficialAcpClient.ts`
- Modify: `src/server/cli/GrokRunner.ts`
- Modify: `src/server/runtime/HeadlessRunService.ts`
- Modify: `src/server/runtime/LocalRunService.ts`
- Modify: `src/server/tasks/TaskSupervisor.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write real subprocess tests**

Spawn a fixture process that spawns one child, register the proven process group, then test task stop and application stop. Assert every registered PID exits and an unregistered sibling process remains alive. Clean up the sibling in the test `finally`.

- [ ] **Step 2: Implement ownership records**

~~~ts
interface OwnedProcess {
  ownerKind: "task" | "run" | "preview" | "application";
  ownerId: string;
  pid: number;
  processGroupId: number | null;
  stop: (signal: NodeJS.Signals) => Promise<void>;
}
~~~

Register only processes created by this app instance. On macOS, signal a process group only when the child was spawned detached and its PGID is the registered PID. Otherwise signal the direct child and await its exit.

- [ ] **Step 3: Integrate lifecycle boundaries**

ACP clients unregister on exit. Task deletion stops task-owned processes. Local/preview run completion unregisters itself and removes only app-private temporary files. Application shutdown order is: reject new work, flush persistence, stop registered processes, close sockets/server, checkpoint/close database.

- [ ] **Step 4: Verify**

~~~bash
npm run test:task-runtime
npm run typecheck
~~~

Expected: owned descendants stop; the unrelated process survives; registry is empty after shutdown.

- [ ] **Step 5: Commit**

Stage only the process-lifecycle files and commit:

~~~bash
git commit -m "fix: own and reap application subprocesses"
~~~

## Task 13: Remove the Legacy Runtime and Add Safe Cleanup

**Files:**

- Modify: `src/server/storage/AppDatabase.ts`
- Delete: `src/server/tasks/TaskDeltaBuffer.ts`
- Delete: `src/server/tasks/TaskProjectionPersistence.ts`
- Delete: `src/server/tasks/taskHistory.ts` after its current list/search helpers have moved into `TaskStore`
- Delete: `src/server/media/taskMediaCacheReferences.ts` after its direct-reference logic has moved into `MediaArtifactStore`
- Create: `scripts/cleanup-legacy-task-data.mjs`
- Create: `scripts/cleanup-legacy-task-data.runtime.test.ts`
- Create: `src/server/tasks/taskRuntimeArchitecture.runtime.test.ts`
- Modify: `package.json`
- Modify: `knip.json`

- [ ] **Step 1: Add architecture guards**

Write a test that scans production `src` and fails on:

- `INSERT INTO task_events`;
- any production SQL statement containing both `SELECT` and `FROM task_events`;
- `TaskDetailDelta`, `TaskDeltaBuffer`, or `task.delta`;
- `restoreTaskDetail` in production;
- production config values `app.sqlite`, `media-cache`, `runs`, or `preview-cache` without a `LEGACY_` prefix.

- [ ] **Step 2: Remove v1 task schema from v2**

Fresh v2 databases must not create `task_events`, task-scoped legacy drafts, or the old action journal. Preserve only current non-task tables, semantic task tables, aggregated diagnostics, and the import marker.

- [ ] **Step 3: Implement a recoverable cleanup command**

The script supports `--dry-run` and `--execute`. It:

1. resolves the exact app-home path;
2. refuses broad/root/home/workspace targets;
3. confirms no Grok Build process is running;
4. confirms `app-v2.sqlite` exists and passes `PRAGMA integrity_check`;
5. checkpoints v2 WAL;
6. creates `/Users/alexwhite/.Trash/Grok-Build-legacy-YYYYMMDD-HHMMSS`;
7. moves only `app.sqlite`, `app.sqlite-wal`, `app.sqlite-shm`, `media-cache`, `runs`, and `preview-cache`;
8. prints original bytes, moved entries, and restore location.

It must reject any candidate whose resolved path escapes the exact app home. It must contain an explicit guard that rejects `/Users/alexwhite/.grok`.

- [ ] **Step 4: Test cleanup against a temporary app home**

Assert dry-run changes nothing; execute moves only the six approved targets; v2 files, themes, Grok Home fixture, and project fixture remain. Test refusal while a fake ownership lock/PID is live and refusal when v2 integrity fails.

- [ ] **Step 5: Add scripts**

~~~json
"test:architecture": "node --import tsx --test src/server/tasks/taskRuntimeArchitecture.runtime.test.ts",
"cleanup:legacy:dry-run": "node scripts/cleanup-legacy-task-data.mjs --dry-run",
"cleanup:legacy": "node scripts/cleanup-legacy-task-data.mjs --execute"
~~~

- [ ] **Step 6: Verify and commit**

~~~bash
npm run test:task-runtime
npm run test:architecture
npm run typecheck
git add package.json knip.json scripts/cleanup-legacy-task-data.mjs scripts/cleanup-legacy-task-data.runtime.test.ts src/server/storage/AppDatabase.ts src/server/tasks/taskRuntimeArchitecture.runtime.test.ts src/server/tasks/taskHistory.ts
git add -u src/server/tasks/TaskDeltaBuffer.ts src/server/tasks/TaskProjectionPersistence.ts src/server/media/taskMediaCacheReferences.ts
git commit -m "refactor: retire token event runtime"
~~~

Review `git diff --cached --name-status` before committing and confirm every staged path is listed above.

## Task 14: Add Fixed Performance Verification

**Files:**

- Create: `scripts/verify-task-runtime-performance.mjs`
- Create: `src/server/tasks/taskRuntimePerformance.runtime.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement the fixed workload**

The script runs both:

- a v2 semantic workload with 100,000 two-character chunks, tool updates, child state, Gate, and completion;
- a retained test-only model of the old per-event/full-message behavior using the same input without writing the user's legacy database.

Collect CPU time, wall time, peak RSS delta, SQLite transaction count, SQLite file+WAL bytes, patch count, serialized patch bytes, semantic rows, and restore time.

- [ ] **Step 2: Assert stable invariants in tests**

Unit/integration tests assert counts and byte formulas, not wall time:

~~~ts
assert.ok(result.semanticRows < 100);
assert.ok(result.transactions <= 15);
assert.ok(result.patchBytes <= result.appendedUtf8Bytes * 2 + 65_536);
assert.ok(result.databaseBytes < 5 * 1024 * 1024);
~~~

The standalone script reports environmental timing gates:

- hot restore under 100 ms;
- restore RSS delta under 50 MB;
- CPU, transactions, and serialized bytes each at least 10x lower than the test-only legacy model.

- [ ] **Step 3: Add the command**

~~~json
"verify:task-performance": "node scripts/verify-task-runtime-performance.mjs"
~~~

- [ ] **Step 4: Verify and commit**

~~~bash
npm run test:task-runtime
npm run verify:task-performance
npm run typecheck
git add package.json scripts/verify-task-runtime-performance.mjs src/server/tasks/taskRuntimePerformance.runtime.test.ts
git commit -m "test: enforce task runtime budgets"
~~~

## Task 15: Full Build, Installed-App Validation, and Approved Legacy Cleanup

**Files:**

- No planned source changes. Any failure returns to the task that owns that authority path, then the full gate restarts.

- [ ] **Step 1: Run the complete automated gate**

~~~bash
npm run test:segmentation
npm run test:task-runtime
npm run test:architecture
npm run verify:task-performance
npm run typecheck
npm run build
~~~

Capture exit status and performance output. Do not claim success from partial output.

- [ ] **Step 2: Audit the final authority paths**

~~~bash
rg -n "task_events|TaskDetailDelta|TaskDeltaBuffer|task\\.delta|restoreTaskDetail" src --glob '!**/*.test.ts'
rg -n "app\\.sqlite|media-cache|preview-cache|runs" src/server scripts
git diff --check
git status --short
~~~

Expected: only explicitly named `LEGACY_` importer/cleanup references remain; no whitespace errors; unrelated pre-existing changes are still present and unstaged.

- [ ] **Step 3: Build and replace the macOS app**

First confirm whether Grok Build is running. Ask it to quit normally if needed, then:

~~~bash
npm run mac:replace
~~~

Verify the installed bundle version/path and confirm exactly one backend/app instance owns the expected port.

- [ ] **Step 4: Validate the real UI without old tasks**

In the installed macOS window:

1. confirm project list/defaults/UI preferences/new-task draft imported;
2. confirm old task list is empty;
3. create a normal task and observe continuous streaming;
4. exercise tool output, child agent, Gate/question/permission, Goal, queue, Interject, media, code/HTML/chart/SPICE/local preview;
5. reload/reopen the task and compare the visible result;
6. restart the app and reopen it again;
7. exercise search, rename, pin, Rewind, Fork, and delete;
8. confirm text clips and source-control blocking still behave;
9. confirm no duplicate notifications or task blocks.

Any visible mismatch blocks cleanup and is fixed through the new authoritative path.

- [ ] **Step 5: Sample the real process**

Measure cold start, idle, active streaming, and large v2 task opening. Confirm frame rate, transaction rate, WebSocket bytes, CPU, RSS, and quit cleanup align with the budgets. After normal quit, confirm Grok Build processes, owned child processes, and owned ports are zero.

- [ ] **Step 6: Run cleanup dry-run and compare exact targets**

With the app stopped:

~~~bash
npm run cleanup:legacy:dry-run
~~~

Confirm the report contains only:

- `app.sqlite`
- `app.sqlite-wal`
- `app.sqlite-shm`
- `media-cache`
- `runs`
- `preview-cache`

Confirm it does not contain `.grok`, Desktop/Documents projects, `app-v2.sqlite`, themes, or v2 caches.

- [ ] **Step 7: Move approved legacy data to Trash**

Only after Steps 1–6 pass:

~~~bash
npm run cleanup:legacy
~~~

Record the Trash recovery directory and reclaimed source bytes. Do not empty Trash.

- [ ] **Step 8: Final restart and completion report**

Launch the installed app once more. Confirm projects/settings remain, the new v2 task reopens, old tasks remain absent, and the old paths are absent from app home. Report:

- visible-equivalence checklist result;
- performance comparison;
- new database/cache paths and sizes;
- old items moved and Trash recovery path;
- explicit confirmation that `/Users/alexwhite/.grok` and project/generated files were untouched.

- [ ] **Step 9: Commit only evidence-driven final fixes**

If verification required source changes, rerun the entire automated gate and commit only those changes:

~~~bash
git commit -m "fix: complete v2 task runtime verification"
~~~

Do not make a final “complete” claim until the installed UI and post-cleanup restart both pass.
