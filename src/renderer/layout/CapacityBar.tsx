import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { WorkspaceProjection } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { Control, Input, Meter, PopoverContent, PopoverRoot, PopoverTrigger } from "../../ui/components/index.js";
import { capacitySlots } from "./capacitySlots.js";
import styles from "./Sidebar.module.css";

export function CapacityBar({ workspace }: { workspace: WorkspaceProjection }) {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const client = useQueryClient();
  const supervisor = workspace.supervisor;
  const serverSettings = {
    softLimit: supervisor.softLimit,
    hardLimit: supervisor.hardLimit,
    maxAgents: supervisor.maxAgents,
    idleRetirementMinutes: supervisor.idleRetirementMinutes,
  };
  const [settings, setSettings] = useState(serverSettings);
  const settingsRef = useRef(serverSettings);
  const editing = useRef(false);
  const pendingSignature = useRef<string | null>(null);
  const committedSignature = useRef(settingsSignature(serverSettings));
  useEffect(() => {
    const serverSignature = settingsSignature(serverSettings);
    if (editing.current) return;
    if (pendingSignature.current && pendingSignature.current !== serverSignature) return;
    if (pendingSignature.current === serverSignature) pendingSignature.current = null;
    settingsRef.current = serverSettings;
    setSettings(serverSettings);
    committedSignature.current = serverSignature;
  }, [supervisor.softLimit, supervisor.hardLimit, supervisor.maxAgents, supervisor.idleRetirementMinutes]);
  const update = async (next: typeof settings) => {
    const signature = settingsSignature(next);
    if (signature === committedSignature.current) return;
    committedSignature.current = signature;
    pendingSignature.current = signature;
    try {
      client.setQueryData(["workspace"], await api.post<WorkspaceProjection>("/supervisor/settings", { requestId: crypto.randomUUID(), settings: next }));
    } catch {
      pendingSignature.current = null;
      committedSignature.current = settingsSignature(serverSettings);
      settingsRef.current = serverSettings;
      setSettings(serverSettings);
    }
  };
  const begin = () => { editing.current = true; };
  const change = (next: typeof settings) => { settingsRef.current = next; setSettings(next); };
  const commit = () => { editing.current = false; void update(settingsRef.current); };
  return <PopoverRoot>
    <PopoverTrigger asChild>
      <Control recipe="text" hover="none" shape="none" className={styles.capacity} aria-label={t("capacitySummary", { active: supervisor.activeAgents })}>
        <Meter className={styles.capacityMeter} slots={capacitySlots(supervisor).map((slot) => ({ id: slot.number, active: slot.active, enabled: slot.enabled, tone: slot.tone === "empty" ? "neutral" : slot.tone }))} />
        <span className={styles.capacityValue} aria-hidden>{supervisor.activeAgents}/16</span>
      </Control>
    </PopoverTrigger>
    <PopoverContent className={styles.capacityPopover} sideOffset={4} align="start">
      <header><strong>{t("capacityTitle")}</strong><small>{supervisor.activeAgents}/16</small></header>
      <Limit label={t("softLimit")} value={settings.softLimit} min={1} max={16} allowedMin={1} allowedMax={settings.hardLimit - 1} onBegin={begin} onChange={(value) => change({ ...settingsRef.current, softLimit: value })} onCommit={commit} />
      <Limit label={t("hardLimit")} value={settings.hardLimit} min={1} max={16} allowedMin={settings.softLimit + 1} allowedMax={settings.maxAgents - 1} onBegin={begin} onChange={(value) => change({ ...settingsRef.current, hardLimit: value })} onCommit={commit} />
      <Limit label={t("maxLimit")} value={settings.maxAgents} min={1} max={16} allowedMin={settings.hardLimit + 1} allowedMax={16} onBegin={begin} onChange={(value) => change({ ...settingsRef.current, maxAgents: value })} onCommit={commit} />
      <Limit label={t("idleLimit")} value={settings.idleRetirementMinutes} min={1} max={60} suffix="m" onBegin={begin} onChange={(value) => change({ ...settingsRef.current, idleRetirementMinutes: value })} onCommit={commit} />
    </PopoverContent>
  </PopoverRoot>;
}

function Limit({ label, value, min, max, allowedMin = min, allowedMax = max, suffix, onBegin, onChange, onCommit }: {
  label: string; value: number; min: number; max: number; allowedMin?: number; allowedMax?: number; suffix?: string; onBegin: () => void; onChange: (value: number) => void; onCommit: () => void;
}) {
  return <label className={styles.limit}>
    <span>{label}</span>
    <Input type="range" min={min} max={max} value={value} onPointerDown={onBegin} onFocus={onBegin} onChange={(event) => onChange(Math.max(allowedMin, Math.min(allowedMax, Number(event.target.value))))} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
    <strong>{value}{suffix}</strong>
  </label>;
}

function settingsSignature(settings: { softLimit: number; hardLimit: number; maxAgents: number; idleRetirementMinutes: number }): string {
  return `${settings.softLimit}:${settings.hardLimit}:${settings.maxAgents}:${settings.idleRetirementMinutes}`;
}
