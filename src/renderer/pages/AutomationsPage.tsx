import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Play, ShieldAlert, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HeadlessRunSnapshot } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { LanSharePanel } from "../components/LanSharePanel.js";
import { Checkbox, Control, Field, Input, Notice, Spinner, StatusDot, Surface, Text, TextArea, ThemedSelect } from "../../ui/components/index.js";
import styles from "./AutomationsPage.module.css";

export function AutomationsPage() {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const client = useQueryClient();
  const run = useQuery({
    queryKey: ["management", "headless"],
    queryFn: () => api.get<{ job: HeadlessRunSnapshot | null }>("/management/headless"),
    refetchInterval: (query) => query.state.data?.job?.status === "running" ? 1200 : false,
  });
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [permission, setPermission] = useState<"default" | "bypassPermissions">("default");
  const [acknowledgeBypass, setAcknowledgeBypass] = useState(false);
  const [maxTurns, setMaxTurns] = useState(12);
  const [check, setCheck] = useState(true);
  const start = useMutation({
    mutationFn: () => api.post<{ job: HeadlessRunSnapshot }>("/management/headless/start", { requestId: crypto.randomUUID(), prompt, model: model || undefined, permissionMode: permission, acknowledgeBypass, maxTurns, check }),
    onSuccess: (value) => client.setQueryData(["management", "headless"], value),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post<{ job: HeadlessRunSnapshot }>("/management/headless/cancel", { requestId: crypto.randomUUID(), id }),
    onSuccess: (value) => client.setQueryData(["management", "headless"], value),
  });
  const job = run.data?.job;
  const blocked = !prompt.trim() || start.isPending || job?.status === "running" || permission === "bypassPermissions" && !acknowledgeBypass;

  return <main className={styles.page}>
    <header><div><Text as="h1" font="heading" size="title" weight="semibold">{t("automations")}</Text><Text as="p" tone="muted" size="label">{t("automationSubtitle")}</Text></div></header>
    <LanSharePanel />
    <div className={styles.layout}>
      <Surface as="section" appearance="surface" elevation="content" className={styles.builder}>
        <div className={styles.kind}><Text><Bot size={15} />{t("headless")}</Text><Text as="small" tone="muted" size="caption">{t("headlessOnlyVerified")}</Text></div>
        <div className={styles.form}>
          <Field label={"1 · " + t("promptLabel")}><TextArea appearance="surface" minLines={5} maxLines={12} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("automationTaskPlaceholder")} /></Field>
          <div className={styles.row}>
            <Field label={"2 · " + t("modelLabel")}><Input appearance="surface" value={model} onChange={(event) => setModel(event.target.value)} placeholder={t("defaultStatus")} /></Field>
            <Field label={t("permission")}><ThemedSelect ariaLabel={t("permission")} value={permission} options={[{ value: "default", label: "Ask / Default" }, { value: "bypassPermissions", label: "Always Approve" }]} onValueChange={(value) => { setPermission(value as typeof permission); setAcknowledgeBypass(false); }} /></Field>
            <Field label={t("maxTurns")}><Input appearance="surface" type="number" min="1" max="100" value={maxTurns} onChange={(event) => setMaxTurns(Number(event.target.value))} /></Field>
          </div>
          {permission === "bypassPermissions" && <Notice tone="warning"><ShieldAlert size={13} /><Checkbox checked={acknowledgeBypass} onChange={(event) => setAcknowledgeBypass(event.target.checked)} label={t("headlessBypassRisk")} /></Notice>}
          <Checkbox checked={check} onChange={(event) => setCheck(event.target.checked)} label={t("runOfficialCheck")} />
          <Surface appearance="muted" className={styles.preview}>
            <Text as="strong" size="caption" weight="semibold">{t("equivalentCli")}</Text>
            <Text as="code" tone="info" font="code" size="caption">grok --single &lt;prompt&gt; --verbatim --output-format streaming-json --max-turns {maxTurns}{permission !== "default" ? " --permission-mode " + permission : ""}{check ? " --check" : ""}</Text>
            <Text as="p" tone="muted" size="micro">{t("argvBoundary")}</Text>
          </Surface>
          <Control recipe="solid" disabled={blocked} onClick={() => start.mutate()}><Play size={14} />{t("runAutomation")}</Control>
          <Notice>{t("scheduleUnavailable")}</Notice>
        </div>
      </Surface>
      <Surface as="section" appearance="surface" elevation="content" className={styles.runs}>
        <Text as="h2" size="body" weight="semibold">{t("runs")}</Text>
        {job ? <article>
          <header>{job.status === "running" ? <Spinner size="compact" /> : <StatusDot tone={job.status === "completed" ? "success" : "warning"} />}<span><Text as="strong" size="label" weight="semibold">{job.status}</Text><Text as="small" tone="muted" size="micro">{new Date(job.startedAt).toLocaleString()}</Text></span>{job.status === "running" && <Control recipe="danger" density="compact" onClick={() => cancel.mutate(job.id)}><Square size={12} />{t("stop")}</Control>}</header>
          <dl><dt>{t("sessionLabel")}</dt><dd>{job.sessionId || t("pending")}</dd><dt>{t("exitCode")}</dt><dd>{job.exitCode ?? "—"}</dd><dt>{t("stopReason")}</dt><dd>{job.stopReason || "—"}</dd></dl>
          <Surface as="section" appearance="muted" className={styles.output}><pre>{job.events.map((event) => event.data).join("\n") || t("waitingOutput")}</pre></Surface>
        </article> : <Text tone="muted" size="label" className={styles.empty}>{t("noAutomationRuns")}</Text>}
      </Surface>
    </div>
  </main>;
}
