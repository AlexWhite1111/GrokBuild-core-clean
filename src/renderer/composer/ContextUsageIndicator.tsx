import { useTranslation } from "react-i18next";
import type { TaskContextWindowUsage } from "../../shared/contracts.js";
import styles from "./Composer.module.css";

export function ContextUsageIndicator({ usage }: { usage: TaskContextWindowUsage }) {
  const { i18n, t } = useTranslation();
  const percentage = Math.max(0, Math.min(100, usage.percentage));
  const number = new Intl.NumberFormat(i18n.language);
  const detail = `${number.format(usage.usedTokens)} / ${number.format(usage.totalTokens)} Tokens · ${percentage.toFixed(1)}%`;
  return <span
    className={styles.contextUsage}
    tabIndex={0}
    role="img"
    aria-label={t("contextUsageLabel", { detail })}
  >
    <svg className={styles.contextUsageGraphic} viewBox="0 0 20 20" aria-hidden>
      <circle className={styles.contextUsageTrack} cx="10" cy="10" r="7.5" />
      <circle className={styles.contextUsageValue} cx="10" cy="10" r="7.5" pathLength="100" strokeDasharray={`${percentage} 100`} />
    </svg>
    <span className={styles.contextUsageTip} data-shape="control" role="tooltip">{detail}</span>
  </span>;
}
