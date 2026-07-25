import { Ban, Check, Code2, Eye, MessageCircle, RotateCcw, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GateDecision, PlanReviewPendingGate, RichTextRenderPolicy, TaskSnapshot } from "../../shared/contracts.js";
import { typographyScope } from "../../ui/core/index.js";
import type { ApiClient } from "../api/ApiClient.js";
import { RichContent } from "../thread/RichContent.js";
import { Control, Notice, TextArea, UiIcon, WorkspaceDetail } from "../../ui/components/index.js";
import styles from "./PlanReview.module.css";
import { usePlanReviewDraft } from "./usePlanReviewDraft.js";

const PLAN_FEEDBACK_LIMIT = 100_000;
export function PlanReview({ api, taskId, gate, document, preparing = false, onClose, onDecision, renderPolicy, mediaScale }: {
  api?: Pick<ApiClient, "get" | "post">;
  taskId?: string;
  gate?: PlanReviewPendingGate;
  document?: TaskSnapshot["plan"]["document"];
  preparing?: boolean;
  onClose?: () => void;
  onDecision?: (decision: GateDecision) => unknown | Promise<unknown>;
  renderPolicy?: RichTextRenderPolicy;
  mediaScale?: number;
}) {
  const { t } = useTranslation();
  const payload = useMemo(() => asRecord(gate?.payload), [gate?.payload]);
  const content = gate ? String(payload.content || "") : document?.content || "";
  const truncated = gate ? payload.truncated === true || content.length > PLAN_FEEDBACK_LIMIT : false;
  const identity = gate ? `${gate.gateId}:${gate.receivedAt}` : `document:${document?.updatedAt || "empty"}`;
  const [view, setView] = useState<"preview" | "source">("preview");
  const planDraft = usePlanReviewDraft({ api, taskId, gate, content });
  const { draft, setDraft } = planDraft;
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    setView("preview");
    setDecisionError(null);
    setDecisionPending(false);
  }, [identity]);
  useEffect(() => {
    if (planDraft.restored) setView("source");
  }, [planDraft.restored]);

  const dirty = Boolean(gate && draft !== content);
  const editable = Boolean(gate && !truncated && planDraft.ready);
  const canSubmitChanges = editable && dirty && draft.trim().length > 0 && draft.length <= PLAN_FEEDBACK_LIMIT;
  const clearDraft = () => {
    setDraft(content);
    void planDraft.persist(content).catch((cause) => {
      setDecisionError(cause instanceof Error ? cause.message : t("planDecisionFailed"));
    });
  };
  const decide = async (decision: "approved" | "cancelled" | "abandoned", feedback?: string) => {
    if (!gate || !onDecision || decisionPending) return;
    setDecisionPending(true);
    setDecisionError(null);
    try {
      if (decision === "cancelled" && feedback !== undefined) await planDraft.persist(feedback || draft);
      await onDecision({
        requestId: crypto.randomUUID(), gateId: gate.gateId, action: "submit",
        value: { decision, ...(feedback === undefined ? {} : { feedback }) },
      });
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : t("planDecisionFailed"));
    } finally {
      setDecisionPending(false);
    }
  };
  const actions = <>
    {content && <Control recipe="icon" density="titlebar" aria-label={t(view === "preview" ? "sourceCode" : "preview")} title={t(view === "preview" ? "sourceCode" : "preview")} onClick={() => setView((current) => current === "preview" ? "source" : "preview")}><UiIcon source={view === "preview" ? Code2 : Eye} /></Control>}
    {gate && dirty && <Control recipe="icon" density="titlebar" aria-label={t("discardPlanDraft")} title={t("discardPlanDraft")} disabled={decisionPending} onClick={clearDraft}><UiIcon source={RotateCcw} /></Control>}
    {gate && dirty && <Control recipe="icon" density="titlebar" tone="accent" aria-label={t("submitPlanChanges")} title={t("submitPlanChanges")} disabled={!canSubmitChanges || decisionPending} onClick={() => void decide("cancelled", draft)}><UiIcon source={Send} /></Control>}
    {gate && <Control recipe="icon" density="titlebar" tone="danger" aria-label={t("abandon")} title={t("abandon")} disabled={decisionPending} onClick={() => void decide("abandoned")}><UiIcon source={Ban} /></Control>}
    {gate && <Control recipe="icon" density="titlebar" aria-label={t("discussPlan")} title={t("discussPlan")} disabled={decisionPending} onClick={() => void decide("cancelled")}><UiIcon source={MessageCircle} /></Control>}
    {gate && <Control recipe="icon" density="titlebar" tone="success" aria-label={t("approvePlan")} title={t("approvePlan")} disabled={dirty || decisionPending} onClick={() => void decide("approved")}><UiIcon source={Check} /></Control>}
    {onClose && <Control recipe="icon" density="titlebar" aria-label={t("close")} title={t("close")} disabled={decisionPending} onClick={onClose}><UiIcon source={X} /></Control>}
  </>;

  return <WorkspaceDetail actions={actions}>
    {decisionError && <Notice className={styles.error} density="compact" tone="danger" role="alert">{decisionError}</Notice>}
    {preparing && !content ? <div className={styles.empty}>{t("preparingPlan")}</div>
      : !content ? <div className={styles.empty}>{t("noActivePlan")}</div>
        : view === "source" ? <div className={styles.source} {...typographyScope("content")}>
          {truncated && <p className={styles.limit}>{t("planEditTruncated")}</p>}
          <TextArea className={styles.editor} appearance="plain" aria-label={t("planSourceEditor")} value={draft} readOnly={!editable || decisionPending} maxLength={PLAN_FEEDBACK_LIMIT} onBlur={() => void planDraft.persist().catch(() => undefined)} onChange={(event) => setDraft(event.target.value)} />
        </div>
          : <div className={styles.document} {...typographyScope("content")}><RichContent taskId={taskId} text={draft} renderPolicy={renderPolicy} mediaScale={mediaScale} /></div>}
  </WorkspaceDetail>;
}

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
