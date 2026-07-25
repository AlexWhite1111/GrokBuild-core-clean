import { useCallback, useEffect, useState } from "react";
import type { LocalRunLanguage, LocalRunSnapshot } from "../../shared/contracts.js";
import type { ApiClient } from "../api/ApiClient.js";

export function useLocalRun(api: ApiClient | null, code: string, workingDirectory: "isolated" | "project", language: LocalRunLanguage = "python") {
  const [snapshot, setSnapshot] = useState<LocalRunSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!api || !snapshot || snapshot.completedAt !== null) return;
    let active = true;
    const poll = async () => {
      try {
        const next = await api.get<LocalRunSnapshot>(`/local-runs/${snapshot.runId}`);
        if (active) setSnapshot(next);
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    const timer = window.setInterval(() => void poll(), 350);
    void poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [api, snapshot?.runId, snapshot?.status]);
  const run = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      setSnapshot(await api.post<LocalRunSnapshot>("/local-runs/start", { requestId: crypto.randomUUID(), language, code, workingDirectory }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, [api, code, language, workingDirectory]);
  const stop = useCallback(async () => {
    if (!api || !snapshot) return;
    try {
      setSnapshot(await api.post<LocalRunSnapshot>("/local-runs/cancel", { requestId: crypto.randomUUID(), runId: snapshot.runId }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, [api, snapshot]);
  return { snapshot, error, run, stop };
}
