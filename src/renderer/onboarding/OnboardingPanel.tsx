import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, FolderOpen, KeyRound, TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccountModelSnapshot, AuthJobSnapshot, CapabilitySnapshot, ProjectSummary } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { Badge, Control, Spinner, Surface, Text } from "../../ui/components/index.js";
import styles from "./OnboardingPanel.module.css";

interface OnboardingPanelProps {
  account: AccountModelSnapshot["account"];
  capabilities: CapabilitySnapshot;
  project: ProjectSummary | undefined;
}

export function OnboardingPanel({ account, capabilities, project }: OnboardingPanelProps) {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const queryClient = useQueryClient();
  const auth = useQuery({
    queryKey: ["management", "auth-job"],
    queryFn: () => api.get<{ job: AuthJobSnapshot | null }>("/management/auth-job"),
    refetchInterval: (query) => query.state.data?.job?.status === "running" ? 1_250 : false,
  });
  const login = useMutation({
    mutationFn: (action: "login-oauth" | "login-device") => api.post<{ job: AuthJobSnapshot }>("/management/auth-job/start", { requestId: crypto.randomUUID(), action }),
    onSuccess: (value) => queryClient.setQueryData(["management", "auth-job"], value),
  });
  const job = auth.data?.job;
  const signedIn = account.authenticated;
  useEffect(() => {
    if (!job || job.status === "running") return;
    void (async () => {
      await api.post("/capabilities/refresh", { requestId: crypto.randomUUID() });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["management", "account"] }),
        queryClient.invalidateQueries({ queryKey: ["management", "account-status"] }),
        queryClient.invalidateQueries({ queryKey: ["capabilities"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      ]);
    })();
  }, [job?.id, job?.status, api, queryClient]);

  return <Surface as="section" appearance="raised" elevation="content" shape="dialog" className={styles.panel} aria-label="Grok Build onboarding">
    <header><Badge tone="accent" variant="solid" className={styles.mark}>G</Badge><div><Text as="h1" font="heading" size="title" weight="semibold">{t("setupGrokBuild")}</Text><Text as="p" tone="muted" size="body">{t("isolatedHomeDescription")}</Text></div></header>
    <div className={styles.steps}>
      <Step done={capabilities.cli.available} icon={<TerminalSquare size={16} />} title={t("detectCli")} detail={capabilities.cli.available ? `Grok ${capabilities.cli.version}` : capabilities.cli.error || t("cliNotFound")} />
      <Step done={signedIn} active={!signedIn} icon={<KeyRound size={16} />} title={t("signInIsolated")} detail={signedIn ? account.label || "Authenticated" : "OAuth / Device Auth"} />
      <Step done={Boolean(project)} active={signedIn && !project} icon={<FolderOpen size={16} />} title={t("chooseProject")} detail={project?.displayPath || t("directoryNotSelected")} />
      <Step done={signedIn && Boolean(project)} icon={<Check size={16} />} title={t("applySafeDefaults")} detail={t("safeDefaultsDetail")} />
    </div>
    {!signedIn && <div className={styles.actions}>
      <Control recipe="solid" onClick={() => login.mutate("login-oauth")} disabled={job?.status === "running"}>{t("oauthLogin")}</Control>
      <Control recipe="quiet" onClick={() => login.mutate("login-device")} disabled={job?.status === "running"}>{t("deviceAuth")}</Control>
    </div>}
    {signedIn && !project && <Control recipe="solid" onClick={() => void window.grokDesktop?.chooseProject()}>{t("chooseProject")}</Control>}
    {job && <Surface appearance="muted" className={styles.job}><Text as="strong" weight="semibold">{job.status === "running" && <Spinner size="compact" />}{job.action} · {job.status}</Text><pre>{job.output.join("\n") || t("waitingCli")}</pre></Surface>}
  </Surface>;
}

function Step({ done, active, icon, title, detail }: { done: boolean; active?: boolean; icon: React.ReactNode; title: string; detail: string }) {
  return <Surface appearance={active ? "surface" : "plain"} className={styles.step}>
    <Badge tone={done ? "success" : active ? "accent" : "neutral"} variant="outline" shape="round" iconOnly>{done ? <Check size={15} /> : active ? icon : <Circle size={12} />}</Badge>
    <span><Text as="strong" tone={active || done ? "primary" : "muted"} size="body" weight="semibold">{title}</Text><Text as="small" tone="muted" size="caption">{detail}</Text></span>
  </Surface>;
}
