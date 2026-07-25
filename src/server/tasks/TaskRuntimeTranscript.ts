import type {
  TaskEventCursor,
  TaskEventEnvelope,
  TaskMediaAttachment,
  TaskMessageBlock,
  TaskSnapshot,
} from "../../shared/contracts.js";
import { mergeMedia } from "../media/MediaArtifactStore.js";
import type { PromptEchoIdentity } from "./PromptEchoQueue.js";
import { TaskCommandProjection } from "./TaskCommandProjection.js";
import { asRecord, readMeta, string } from "./taskEventSanitizers.js";
import {
  createMediaHintScanState,
  scanAppendedMediaHints,
  type MediaHintScanState,
  type ProjectionMediaContext,
} from "./taskMediaProjection.js";
import { visibleRemoteUserText } from "./taskVisibleUserText.js";
import {
  mergeTaskMessageProtocol,
  taskMessageProtocol,
  taskMessageProtocolPassKey,
  taskMessageProtocolSegmentKey,
} from "./taskMessageProtocol.js";

interface OpenMessageSegment {
  role: "assistant" | "thought";
  sourceBlockId: string;
  blockId: string;
}

/**
 * Mutable transcript projection of the official session stream.
 */
export class TaskRuntimeTranscript {
  readonly messages: TaskMessageBlock[];
  readonly #messageIndex = new Map<string, TaskMessageBlock>();
  readonly #requestIds = new Set<string>();
  readonly #dedupedUserEchoTurns = new Set<string>();
  readonly #openMessageSegments = new Map<string, OpenMessageSegment>();
  readonly #mediaScans = new Map<string, MediaHintScanState>();
  #sessionReplay = false;
  #completeOfficialHistory = false;
  #suppressReplayTranscript = false;
  #skipExistingReplayUser = false;
  #replayTurnId: string | null = null;

  constructor(
    private readonly snapshot: TaskSnapshot,
    private readonly commands: TaskCommandProjection,
    private readonly media?: ProjectionMediaContext,
    restored: TaskMessageBlock[] = [],
  ) {
    this.messages = restored;
    for (const message of restored) {
      this.#messageIndex.set(messageKey(message.turnId, message.blockId), message);
      if (message.requestId) this.#requestIds.add(message.requestId);
      if (message.role === "user" && message.blockId.startsWith("user:")) {
        this.#dedupedUserEchoTurns.add(message.turnId);
      }
      this.#mediaScans.set(messageKey(message.turnId, message.blockId), createMediaHintScanState(message.text));
    }
  }

  get rowCount(): number {
    return this.messages.length;
  }

  get mediaHintScanCharacters(): number {
    return [...this.#mediaScans.values()].reduce((total, state) => total + state.scannedCharacters, 0);
  }

  beginSessionReplay(completeOfficialHistory = false): void {
    this.#sessionReplay = true;
    this.#completeOfficialHistory = completeOfficialHistory;
    this.#suppressReplayTranscript = this.messages.some((message) => message.role === "assistant" || message.role === "thought");
    this.#skipExistingReplayUser = !this.#suppressReplayTranscript && this.messages.some((message) => message.role === "user");
    this.#replayTurnId = null;
  }

  endSessionReplay(): void {
    this.#sessionReplay = false;
    this.#completeOfficialHistory = false;
    this.#suppressReplayTranscript = false;
    this.#skipExistingReplayUser = false;
    this.#replayTurnId = null;
  }

  suppressesReplayUpdate(
    updateType: string,
    officialHistoryUpdates: ReadonlySet<string>,
    transcriptUpdates: ReadonlySet<string>,
  ): boolean {
    if (!this.#sessionReplay) return false;
    if (this.#completeOfficialHistory) return officialHistoryUpdates.has(updateType);
    return this.#suppressReplayTranscript && transcriptUpdates.has(updateType);
  }

  isReplayUpdate(updateType: string, transcriptUpdates: ReadonlySet<string>): boolean {
    return this.#sessionReplay && transcriptUpdates.has(updateType);
  }

  turnForReplay(updateType: string, connectionEpoch: number, payload: Record<string, unknown>): string {
    if (updateType === "user_message_chunk") {
      const promptIndex = typeof payload.promptIndex === "number" && Number.isSafeInteger(payload.promptIndex)
        ? payload.promptIndex
        : null;
      if (promptIndex != null || !this.#replayTurnId) {
        this.#replayTurnId = replayExecutionId(connectionEpoch, payload);
      } else {
        payload.interjection = true;
      }
    }
    this.#replayTurnId ||= replayExecutionId(connectionEpoch, payload);
    return this.#replayTurnId;
  }

  closeSegment(turnId: string): void {
    const open = this.#openMessageSegments.get(turnId);
    this.#openMessageSegments.delete(turnId);
    if (!open) return;
    const message = this.#messageIndex.get(messageKey(turnId, open.blockId));
    if (message) this.#finalizeMessage(message);
  }

  addLocalUser(
    text: string,
    turnId: string,
    requestId: string,
    paths: NonNullable<TaskMessageBlock["paths"]>,
    event: TaskEventEnvelope,
    composerDocument?: TaskMessageBlock["composerDocument"],
    interjection = false,
  ): void {
    const media = this.media ? mergeMedia(
      this.media.store.registerPathReferences(this.snapshot.taskId, this.media.projectPath, paths),
      this.#discoverMedia(text),
    ) : undefined;
    const cursor = eventCursor(event);
    const message: TaskMessageBlock = {
      blockId: `user:${requestId}`,
      role: "user",
      text,
      turnId,
      requestId,
      delivery: "pending",
      streaming: false,
      createdAt: event.occurredAt,
      firstEvent: cursor,
      lastEvent: cursor,
      paths,
      composerDocument,
      media,
      protocol: taskMessageProtocol("user", event, turnId, undefined, interjection),
    };
    this.messages.push(message);
    this.#messageIndex.set(messageKey(turnId, message.blockId), message);
    this.#requestIds.add(requestId);
    this.#dedupedUserEchoTurns.add(turnId);
    this.#mediaScans.set(messageKey(turnId, message.blockId), createMediaHintScanState(text));
  }

  appendAgent(
    role: "assistant" | "thought",
    update: Record<string, unknown>,
    turnId: string,
    streaming: boolean,
    event: TaskEventEnvelope,
    structuredMedia: TaskMediaAttachment[] = [],
    commandTurnId = turnId,
  ): void {
    if (this.#sessionReplay) this.#skipExistingReplayUser = false;
    const content = asRecord(update.content);
    const text = string(content.text) || "";
    const meta = readMeta(update);
    const advertisedBlockId = string(update.messageId) || string(meta.blockId) || string(meta.contentBlockId);
    const protocol = taskMessageProtocol(role, event, turnId, advertisedBlockId);
    const sourceBlockId = advertisedBlockId
      ? taskMessageProtocolSegmentKey(role, protocol)
      : taskMessageProtocolPassKey(role, protocol);
    const open = this.#openMessageSegments.get(turnId);
    const continuing = open?.role === role && open.sourceBlockId === sourceBlockId;
    let blockId = continuing ? open.blockId : protocol.messageId;
    if ((!open || open.blockId !== blockId) && this.#messageIndex.has(messageKey(turnId, blockId))) {
      blockId = `${blockId}@${event.connectionEpoch}:${event.sequence}`;
    }
    if (!continuing) this.closeSegment(turnId);
    this.#openMessageSegments.set(turnId, { role, sourceBlockId, blockId });
    if (this.commands.observeMessage(commandTurnId, role, blockId, text) || (!text && !structuredMedia.length)) {
      return;
    }
    const key = messageKey(turnId, blockId);
    const existing = this.#messageIndex.get(key);
    if (existing) {
      existing.text += text;
      const discovered = role === "assistant" && this.media && this.#shouldDiscoverMedia(key, text)
        ? this.#discoverMedia(existing.text)
        : [];
      existing.media = mergeMedia(existing.media?.filter((item) => !item.anchor), [...structuredMedia, ...discovered]);
      existing.streaming = streaming;
      existing.lastEvent = eventCursor(event);
      existing.protocol = mergeTaskMessageProtocol(existing.protocol, advertisedBlockId
        ? protocol
        : { ...protocol, messageId: existing.protocol?.messageId || protocol.messageId });
      return;
    }
    const discovered = role === "assistant" && this.media ? this.#discoverMedia(text) : [];
    const message: TaskMessageBlock = {
      blockId,
      ...(advertisedBlockId ? { sourceBlockId: advertisedBlockId } : {}),
      role,
      text,
      turnId,
      streaming,
      createdAt: event.occurredAt,
      firstEvent: eventCursor(event),
      lastEvent: eventCursor(event),
      media: mergeMedia(undefined, [...structuredMedia, ...discovered]),
      protocol,
    };
    this.messages.push(message);
    this.#messageIndex.set(key, message);
    this.#mediaScans.set(key, createMediaHintScanState(text));
  }

  appendRemoteUser(
    update: Record<string, unknown>,
    turnId: string,
    streaming: boolean,
    event: TaskEventEnvelope,
    userEcho?: PromptEchoIdentity,
    correlationTurnId = turnId,
  ): void {
    if (this.#sessionReplay && this.#skipExistingReplayUser) return;
    const content = asRecord(update.content);
    const sourceText = userEcho?.displayText || string(content.text);
    const text = userEcho ? sourceText : sourceText ? visibleRemoteUserText(sourceText) || undefined : undefined;
    if (!text) return;
    const meta = readMeta(update);
    const requestId = userEcho?.requestId || string(meta.requestId) || string(meta.clientRequestId);
    const advertisedBlockId = string(update.messageId) || string(meta.blockId);
    const protocol = taskMessageProtocol("user", event, userEcho?.turnId || turnId, advertisedBlockId);
    if (userEcho?.localMessage) {
      this.#dedupedUserEchoTurns.add(userEcho.turnId);
      this.#dedupedUserEchoTurns.add(correlationTurnId);
      const local = this.messages.find((message) => message.role === "user" && message.requestId === userEcho.requestId);
      if (local) {
        local.protocol = mergeTaskMessageProtocol(local.protocol, protocol);
        local.lastEvent = eventCursor(event);
      }
    }
    if (this.#dedupedUserEchoTurns.has(correlationTurnId) || (requestId && this.#requestIds.has(requestId))) {
      return;
    }
    const blockId = protocol.messageId;
    const media = this.media ? mergeMedia(
      this.media.store.registerPathReferences(this.snapshot.taskId, this.media.projectPath, userEcho?.paths || []),
      this.#discoverMedia(text),
    ) : undefined;
    const key = messageKey(turnId, blockId);
    const existing = this.#messageIndex.get(key);
    if (existing) {
      existing.text += text;
      existing.lastEvent = eventCursor(event);
      existing.protocol = mergeTaskMessageProtocol(existing.protocol, protocol);
    } else {
      const cursor = eventCursor(event);
      const message: TaskMessageBlock = {
        blockId,
        ...(advertisedBlockId ? { sourceBlockId: advertisedBlockId } : {}),
        role: "user",
        text,
        turnId,
        requestId,
        delivery: "accepted",
        streaming,
        createdAt: event.occurredAt,
        firstEvent: cursor,
        lastEvent: cursor,
        paths: userEcho?.paths,
        composerDocument: userEcho?.composerDocument,
        media,
        protocol,
      };
      this.messages.push(message);
      this.#messageIndex.set(key, message);
      this.#mediaScans.set(key, createMediaHintScanState(text));
    }
    if (requestId) this.#requestIds.add(requestId);
  }

  messageForRequest(requestId: string): TaskMessageBlock | undefined {
    return this.messages.find((message) => message.role === "user" && message.requestId === requestId);
  }

  closeTurn(turnId: string): void {
    this.#openMessageSegments.delete(turnId);
    for (const message of this.messages) {
      if (message.turnId !== turnId) continue;
      this.#finalizeMessage(message);
    }
  }

  #shouldDiscoverMedia(key: string, appended: string): boolean {
    const result = scanAppendedMediaHints(this.#mediaScans.get(key) || createMediaHintScanState(), appended);
    this.#mediaScans.set(key, result.state);
    return result.completed;
  }

  #finalizeMessage(message: TaskMessageBlock): void {
    if (message.role !== "thought" && this.media && message.text) {
      const retained = message.media?.filter((item) => !item.anchor);
      message.media = mergeMedia(retained, this.#discoverMedia(message.text));
    }
    message.streaming = false;
    const key = messageKey(message.turnId, message.blockId);
    this.#mediaScans.set(key, createMediaHintScanState(message.text));
  }

  #discoverMedia(text: string): TaskMediaAttachment[] {
    if (!this.media) return [];
    return this.media.store.discoverInText(
      this.snapshot.taskId,
      this.media.projectPath,
      text,
      { grokHome: this.media.grokHome, sessionId: this.snapshot.sessionId },
    );
  }
}

function messageKey(turnId: string, blockId: string): string {
  return `${turnId}:${blockId}`;
}

function eventCursor(event: TaskEventEnvelope): TaskEventCursor {
  return { connectionEpoch: event.connectionEpoch, sequence: event.sequence };
}

function replayExecutionId(connectionEpoch: number, payload: Record<string, unknown>): string {
  const promptIndex = typeof payload.promptIndex === "number" && Number.isSafeInteger(payload.promptIndex) && payload.promptIndex >= 0
    ? payload.promptIndex
    : null;
  if (promptIndex != null) return `replay:${connectionEpoch}:prompt:${promptIndex}`;
  const promptId = string(payload.promptId);
  const turnStartMs = typeof payload.turnStartMs === "number" && Number.isSafeInteger(payload.turnStartMs) ? payload.turnStartMs : null;
  return promptId && turnStartMs != null
    ? `replay:${connectionEpoch}:native:${promptId}:${turnStartMs}`
    : `replay:${connectionEpoch}:event:${string(payload.eventId) || "unscoped"}`;
}
