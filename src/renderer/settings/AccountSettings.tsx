import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, LogIn, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AuthJobSnapshot, AuthLogoutPreview } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { useAccount, useAccountStatus } from "../api/hooks.js";
import { accountViewState, effectiveAccount } from "../onboarding/accountState.js";
import { SemanticMutationDialog } from "../components/SemanticMutationDialog.js";
import styles from "./SettingsPanels.module.css";
import { CustomModelsPanel } from "./CustomModelsPanel.js";
import { Control, Notice, SettingCard, Spinner, Text } from "../../ui/components/index.js";

export function AccountSettings() {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const client = useQueryClient();
  const account = useAccount();
  const accountStatus = useAccountStatus();
  const auth = useQuery({ queryKey: ["management", "auth-job"], queryFn: () => api.get<{ job: AuthJobSnapshot | null }>("/management/auth-job"), refetchInterval: (query) => query.state.data?.job?.status === "running" ? 1500 : false });
  const login = useMutation({ mutationFn: (action: "login-oauth" | "login-device") => api.post<{ job: AuthJobSnapshot }>("/management/auth-job/start", { requestId: crypto.randomUUID(), action }), onSuccess: (value) => client.setQueryData(["management", "auth-job"], value) });
  const [logoutPreview, setLogoutPreview] = useState<AuthLogoutPreview | null>(null);
  useEffect(() => {
    if (!auth.data?.job || auth.data.job.status === "running") return;
    void refreshRuntime(api, client);
  }, [auth.data?.job?.id, auth.data?.job?.status, api, client]);
  const logout = useMutation({ mutationFn: () => api.post("/management/logout", { requestId: crypto.randomUUID(), confirmation: "logout" }), onSuccess: async () => { setLogoutPreview(null); await refreshRuntime(api, client, false); } });
  const snapshot = account.data;
  const viewState = accountViewState(accountStatus.data, snapshot, account.isPending, account.isError);
  const accountInfo = effectiveAccount(accountStatus.data, snapshot);
  return <div className={styles.stack}>
    <SettingCard title={t("grokAccount")} description={t("accountSecretBoundary")}>
      {viewState === "authenticated" && <div className={styles.accountRow}><Text tone="success"><CheckCircle2 size={14} />{t("signedIn")} · {accountInfo.label}</Text><Control recipe="quiet" onClick={() => void api.get<AuthLogoutPreview>("/management/logout-preview").then(setLogoutPreview)}><LogOut size={12} />{t("signOut")}</Control></div>}
      {viewState === "unauthenticated" && <div className={styles.actions}><Control recipe="solid" onClick={() => login.mutate("login-oauth")}><LogIn size={13} />{t("oauthLogin")}</Control><Control recipe="quiet" onClick={() => login.mutate("login-device")}><KeyRound size={13} />{t("deviceAuth")}</Control></div>}
      {viewState === "loading" && <Text tone="muted">{t("loading")}</Text>}
      {viewState === "error" && <Notice tone="danger" density="compact" role="alert">{account.error instanceof Error ? account.error.message : t("startupFailed")}</Notice>}
    </SettingCard>
    {auth.data?.job && <SettingCard title={t("authTask")} description={`${auth.data.job.action} · ${auth.data.job.status}`}>
      <div className={styles.job}>{auth.data.job.status === "running" && <Spinner size="compact" />}<pre>{auth.data.job.output.join("\n") || t("waitingOfficialCli")}</pre></div>
    </SettingCard>}
    <SettingCard title={t("modelsLabel")} description={t("modelListDescription")}>
      <div className={styles.list}>{snapshot?.models.available.map((model) => <div key={model.id} data-shape="control"><strong>{model.id}</strong><span>{model.isDefault ? t("defaultStatus") : t("availableStatus")}</span></div>) || <span>{t("loading")}</span>}</div>
    </SettingCard>
    <CustomModelsPanel />
    {logoutPreview && <SemanticMutationDialog open title={t("signOutTitle")} target="active Grok Home" changes={[{ field: "cached credentials", before: String(logoutPreview.credentialEntries), after: "0" }]} warnings={[logoutPreview.warning]} destructive pending={logout.isPending} onOpenChange={(open) => { if (!open) setLogoutPreview(null); }} onApply={() => logout.mutate()} />}
  </div>;
}

async function refreshRuntime(api: ReturnType<typeof useBootstrap>["api"], client: ReturnType<typeof useQueryClient>, probe = true): Promise<void> {
  if (probe) await api.post("/capabilities/refresh", { requestId: crypto.randomUUID() });
  await Promise.all([
    client.invalidateQueries({ queryKey: ["management", "account"] }),
    client.invalidateQueries({ queryKey: ["management", "account-status"] }),
    client.invalidateQueries({ queryKey: ["capabilities"] }),
    client.invalidateQueries({ queryKey: ["workspace"] }),
  ]);
}
