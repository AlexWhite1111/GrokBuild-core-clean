import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Paintbrush, Save } from "lucide-react";
import type { ThemeLibrarySnapshot, ThemeManifestV1 } from "../../shared/contracts.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { useThemes } from "../api/hooks.js";
import { Control, Modal, ModalClose, Notice, Text } from "../../ui/components/index.js";
import styles from "./ThemeCandidateAction.module.css";

export function ThemeCandidateAction({ theme }: { theme: ThemeManifestV1 }) {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const library = useThemes();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = library.data.themes.find((entry) => entry.id === theme.id);
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const saved = await api.post<{ theme: ThemeManifestV1; warnings: string[] }>("/themes/save", { requestId: crypto.randomUUID(), manifest: theme, overwrite: Boolean(existing && !existing.builtIn) });
      const next = await api.post<ThemeLibrarySnapshot>("/themes/select", { requestId: crypto.randomUUID(), themeId: saved.theme.id, followSystem: false });
      library.refetch();
      setOpen(false);
      return next;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const footer = <><ModalClose><Control recipe="quiet">{t("cancel")}</Control></ModalClose><Control recipe="solid" disabled={saving || existing?.builtIn} onClick={() => void save()}><Save size={13} />{saving ? t("saving") : t("saveApply")}</Control></>;
  return <>
    <Control recipe="quiet" className={styles.trigger} onClick={() => setOpen(true)}><Paintbrush size={13} />{t("validateSaveTheme")}</Control>
    <Modal open={open} onOpenChange={setOpen} title={<><CheckCircle2 size={17} />{t("manifestValid")}</>} closeLabel={t("close")} size="standard" footer={footer}>
      <div className={styles.summary}><div><Text tone="muted" size="caption">Name</Text><Text as="strong" size="label" weight="semibold" truncate>{theme.name}</Text></div><div><Text tone="muted" size="caption">Theme ID</Text><Text as="code" font="code" size="label" truncate>{theme.id}</Text></div><div><Text tone="muted" size="caption">Appearance</Text><Text as="strong" size="label" weight="semibold">{theme.appearance}</Text></div><div><Text tone="muted" size="caption">{t("tokenSummary")}</Text><Text as="strong" size="label" weight="semibold">{Object.keys(theme.colors).length} colors · {Object.keys(theme.components).length} components · {theme.assets.length} assets</Text></div></div>
      {existing && <Notice tone="warning" className={styles.notice}>{existing.builtIn ? t("builtInThemeIdWarning") : t("overwriteManifestWarning")}</Notice>}
      {error && <Notice tone="danger" density="compact" role="alert" className={styles.notice}>{error}</Notice>}
    </Modal>
  </>;
}
