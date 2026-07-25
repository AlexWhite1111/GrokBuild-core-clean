import { useEffect, useState, type PropsWithChildren } from "react";
import { OPEN_LAN_SHARE_EVENT } from "../app/uiEvents.js";
import { LanSharePanel } from "../components/LanSharePanel.js";
import styles from "./ComposerStack.module.css";

export function ComposerStack({ children }: PropsWithChildren) {
  const [lanShareOpen, setLanShareOpen] = useState(false);
  useEffect(() => {
    const open = () => setLanShareOpen(true);
    window.addEventListener(OPEN_LAN_SHARE_EVENT, open);
    return () => window.removeEventListener(OPEN_LAN_SHARE_EVENT, open);
  }, []);
  return <div className={styles.stack}>
    {lanShareOpen && <LanSharePanel compact onClose={() => setLanShareOpen(false)} />}
    {children}
  </div>;
}
