import { useTranslation } from "react-i18next";
import { Spinner } from "../../ui/components/index.js";
import styles from "./TaskPage.module.css";

export function TaskPageLoading({ error }: { error?: string }) {
  const { t } = useTranslation();
  return (
    <main className={styles.loading}>
      {error ? <><strong>{t("loadTaskFailed")}</strong><span>{error}</span></> : <><Spinner /><span>{t("connectionLoading")}…</span></>}
    </main>
  );
}
