import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PlanReviewDraftSnapshot,
  PlanReviewPendingGate,
} from "../../shared/contracts.js";
import type { ApiClient } from "../api/ApiClient.js";
import { SerialWriteQueue } from "../api/SerialWriteQueue.js";

interface PlanDraftApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export function usePlanReviewDraft(options: {
  api?: Pick<ApiClient, "get" | "post"> | PlanDraftApi;
  taskId?: string;
  gate?: PlanReviewPendingGate;
  content: string;
}) {
  const payload = asRecord(options.gate?.payload);
  const baseHash = typeof payload.baseHash === "string"
    && /^[a-f0-9]{64}$/.test(payload.baseHash)
    ? payload.baseHash
    : null;
  const identity = useMemo(() => options.gate && options.taskId && baseHash
    ? {
      taskId: options.taskId,
      gateId: options.gate.gateId,
      baseHash,
      key: `${options.taskId}:${options.gate.gateId}:${baseHash}`,
    }
    : null, [baseHash, options.gate?.gateId, options.taskId]);
  const [draft, setDraftState] = useState(options.content);
  const [readyKey, setReadyKey] = useState<string | null>(identity ? null : "local");
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const identityRef = useRef(identity);
  const writes = useRef(new SerialWriteQueue());

  const setDraft = useCallback((value: string) => {
    draftRef.current = value;
    setDraftState(value);
  }, []);

  const persist = useCallback((value = draftRef.current) => {
    const current = identityRef.current;
    if (!current || !options.api) return Promise.resolve<PlanReviewDraftSnapshot>({ draft: null, updatedAt: null });
    return writes.current.enqueue(() => options.api!.post<PlanReviewDraftSnapshot>(
      `/tasks/${encodeURIComponent(current.taskId)}/plan-draft`,
      {
        requestId: crypto.randomUUID(),
        gateId: current.gateId,
        baseHash: current.baseHash,
        draft: value === options.content ? null : value,
      },
    ));
  }, [options.api, options.content]);

  useEffect(() => {
    let cancelled = false;
    identityRef.current = identity;
    setDraft(options.content);
    setReadyKey(identity ? null : "local");
    setRestoredKey(null);
    if (!identity || !options.api) return () => { cancelled = true; };
    const query = new URLSearchParams({ gateId: identity.gateId, baseHash: identity.baseHash });
    void options.api.get<PlanReviewDraftSnapshot>(
      `/tasks/${encodeURIComponent(identity.taskId)}/plan-draft?${query}`,
    ).then((snapshot) => {
      if (!cancelled && identityRef.current?.key === identity.key && snapshot.draft !== null) {
        setDraft(snapshot.draft);
        setRestoredKey(identity.key);
      }
    }).catch(() => undefined).finally(() => {
      if (!cancelled && identityRef.current?.key === identity.key) setReadyKey(identity.key);
    });
    return () => { cancelled = true; };
  }, [identity?.key, options.api, options.content, setDraft]);

  useEffect(() => {
    if (!identity || readyKey !== identity.key) return;
    const timer = window.setTimeout(() => { void persist().catch(() => undefined); }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, identity?.key, persist, readyKey]);

  useEffect(() => {
    const flush = () => {
      if (identityRef.current && readyKey === identityRef.current.key) {
        void persist().catch(() => undefined);
      }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [persist, readyKey]);

  return {
    draft,
    setDraft,
    ready: !identity || readyKey === identity.key,
    restored: Boolean(identity && restoredKey === identity.key),
    persisted: Boolean(identity),
    persist,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
