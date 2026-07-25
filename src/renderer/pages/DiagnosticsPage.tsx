import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RuntimeCliSnapshot } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { useCapabilities } from "../api/hooks.js";
import { Control, StatusDot, Surface, Text } from "../../ui/components/index.js";
import styles from "./DiagnosticsPage.module.css";

export function DiagnosticsPage() {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const capabilityQuery = useCapabilities();
  const capabilities = capabilityQuery.data;
  const runtime = useQuery({ queryKey: ["management", "runtime"], queryFn: () => api.get<RuntimeCliSnapshot>("/management/runtime") });
  const diagnostics = useQuery({ queryKey: ["diagnostics", "events"], queryFn: () => api.get<{ diagnostics: Diagnostic[] }>("/diagnostics/events") });
  const refresh = async () => { await api.post("/capabilities/refresh", { requestId: crypto.randomUUID() }); await capabilityQuery.refetch(); };
  const registeredXai = capabilities.acp.xai.filter((method) => method.availability !== "unavailable");
  const unannouncedXai = capabilities.acp.xai.length - registeredXai.length;
  return <main className={styles.page}><header><div><Text as="h1" font="heading" size="title" weight="semibold">{t("diagnosticsLabel")}</Text><Text as="p" tone="muted" size="label">{t("diagnosticsSubtitle")}</Text></div><div><Control recipe="quiet" onClick={() => void window.grokDesktop?.openTerminal()}><ExternalLink size={13} />{t("openTerminalProject")}</Control><Control recipe="quiet" onClick={() => void refresh()}><RefreshCw size={13} />{t("reprobe")}</Control></div></header>
    <section className={styles.summary}><Stat label="CLI" value={capabilities.cli.available ? capabilities.cli.version || "Ready" : "Unavailable"} good={capabilities.cli.available} /><Stat label="ACP" value={capabilities.acp.available ? `Protocol ${capabilities.acp.protocolVersion}` : "Unavailable"} good={capabilities.acp.available} /><Stat label="Sandbox" value={capabilities.platform.sandboxMechanism} good={capabilities.platform.nativeSandboxExpected} /><Stat label="Runtime" value={runtime.data?.version.current || "Loading"} good={Boolean(runtime.data)} /></section>
    <Surface as="section" appearance="surface" elevation="content" className={styles.panel}>
      <h2>{t("typedRegistry")}</h2>
      <div className={styles.table}>
        <div className={styles.tableHead}><span>{t("method")}</span><span>{t("kind")}</span><span>{t("sideEffect")}</span><span>{t("status")}</span></div>
        {registeredXai.map((method) => <div key={method.method}>
          <code>{method.method}</code>
          <span>{t(`xaiKind_${method.kind}`)}</span>
          <span>{t(`xaiSideEffect_${method.sideEffect}`)}</span>
          <Text tone={method.availability === "advertised" ? "success" : method.availability === "probed" ? "info" : "warning"} size="caption">
            {t(`xaiAvailability_${method.availability}`)}{method.reason ? ` · ${method.reason}` : ""}
          </Text>
        </div>)}
      </div>
      {unannouncedXai > 0 && <Text as="p" className={styles.registryNote} tone="muted" size="caption">{t("xaiUnannouncedOmitted", { count: unannouncedXai })}</Text>}
    </Surface>
    <Surface as="section" appearance="surface" elevation="content" className={styles.panel}><h2>{t("runtimeCommands")}</h2><p>{t("runtimeCommandReadOnly")}</p><div className={styles.diagnosticList}>{capabilities.acp.availableCommands.map((command) => <div key={command.name}><code>/{command.name}</code><span>{command.description || t("structuredCommand")}</span></div>)}{!capabilities.acp.availableCommands.length && <p>{t("commandsUnavailable")}</p>}</div></Surface>
    <Surface as="section" appearance="surface" elevation="content" className={styles.panel}><h2>{t("aggregatedDiagnostics")}</h2><div className={styles.diagnosticList}>{diagnostics.data?.diagnostics.map((item) => <div key={`${item.taskId}:${item.method}:${item.summary}`}><code>{item.method}</code><span>{item.summary}</span><b>{item.count}×</b><time>{new Date(item.lastSeenAt).toLocaleString()}</time></div>)}{!diagnostics.data?.diagnostics.length && <p>{t("noProtocolDiagnostics")}</p>}</div></Surface>
    <Surface as="section" appearance="surface" elevation="content" className={styles.panel}><h2>{t("securityBoundary")}</h2><div className={styles.security}><ShieldCheck size={17} /><p>{t("randomSecurityBoundary")}</p></div></Surface>
  </main>;
}

interface Diagnostic { taskId: string | null; method: string; severity: string; count: number; firstSeenAt: string; lastSeenAt: string; summary: string }

function Stat({ label, value, good }: { label: string; value: string; good: boolean }) { return <Surface appearance="surface" elevation="content"><StatusDot tone={good ? "success" : "danger"} /><Text as="small" tone="muted" size="caption">{label}</Text><Text as="strong" size="label" weight="semibold">{value}</Text></Surface>; }
