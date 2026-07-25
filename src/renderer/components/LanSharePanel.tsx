import { useState } from "react";
import { Check, Copy, Power, Wifi, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLanShare } from "../api/useLanShare.js";
import { Badge, Control, Notice, Spinner, Surface, Text } from "../../ui/components/index.js";
import styles from "./LanSharePanel.module.css";

export function LanSharePanel({ compact = false, onClose }: { compact?: boolean; onClose?: () => void }) {
  const { t } = useTranslation();
  const share = useLanShare();
  const [copied, setCopied] = useState(false);
  if (!share.available) return null;
  const status = share.status.data;
  const enabled = status?.enabled === true;
  const pending = share.status.isPending || share.setEnabled.isPending;
  const copyLink = async () => {
    if (!status?.accessUrl) return;
    await navigator.clipboard.writeText(status.accessUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return <Surface as="section" appearance={compact ? "raised" : "surface"} elevation={compact ? "floating" : "content"} className={styles.panel} data-enabled={enabled || undefined} data-compact={compact || undefined}>
    <div className={styles.summary}>
      <Badge tone={enabled ? "accent" : "neutral"} shape="round" iconOnly><Wifi size={17} /></Badge>
      <div><Text as="strong" weight="semibold">{t("lanShare")}</Text><Text as="p" tone="muted" size="caption">{t("lanShareDescription")}</Text></div>
      <Control recipe="quiet" tone={enabled ? "accent" : "neutral"} disabled={pending} onClick={() => share.setEnabled.mutate(!enabled)} aria-pressed={enabled}>
        {pending ? <Spinner size="compact" /> : <Power size={14} />}
        {t(enabled ? "disableLanShare" : "enableLanShare")}
      </Control>
      {onClose && <Control recipe="icon" onClick={onClose} aria-label={t("close")}><X size={14} /></Control>}
    </div>
    {share.setEnabled.error && <Notice tone="danger" density="compact" role="alert" className={styles.error}>{share.setEnabled.error.message}</Notice>}
    {enabled && <div className={styles.details}>
      <div className={styles.address}>
        <span><Text as="small" tone="muted" size="micro">{t("lanAddress")}</Text><Text as="code" font="code" size="label" truncate>{status?.displayUrl || t("waitingForNetwork")}</Text></span>
        <Control recipe="quiet" disabled={!status?.accessUrl} onClick={() => void copyLink()} aria-label={t("copyLanLink")}>
          {copied ? <Check size={13} /> : <Copy size={13} />}{t(copied ? "copied" : "copyLink")}
        </Control>
        {status?.portAdjusted && <Text as="em" tone="warning" size="micro">{t("lanPortAdjusted", { preferred: status.preferredPort, actual: status.port })}</Text>}
      </div>
      {status?.qrCodeDataUrl && <div className={styles.qr}><Surface as="span" appearance="raised" elevation="content" shape="control"><img src={status.qrCodeDataUrl} alt={t("lanQrCode")} /></Surface><Text tone="muted" size="micro">{t("scanOnSameWifi")}</Text></div>}
      <Text as="p" tone="muted" size="micro" className={styles.security}>{t("lanSecurityBoundary")}</Text>
    </div>}
  </Surface>;
}
