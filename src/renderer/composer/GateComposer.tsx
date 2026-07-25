import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Check, CheckCheck, ShieldAlert, ShieldX, X } from "lucide-react";
import type {
  ComposerPendingGate,
  GateDecision,
  PermissionPendingGate,
  QuestionPendingGate,
  RichTextRenderPolicy,
  TaskMediaAttachment,
} from "../../shared/contracts.js";
import { RichContent } from "../thread/RichContent.js";
import { QuestionOption } from "./QuestionOption.js";
import { useQuestionOptionLayout } from "./useQuestionOptionLayout.js";
import { InlineComposerEditor } from "./InlineComposerEditor.js";
import { composerHasContent, composerText, type ComposerNode } from "./composerDocument.js";
import { Control, Divider, SelectionMark, Spinner, Surface } from "../../ui/components/index.js";
import styles from "./GateComposer.module.css";

export function GateComposer({ gate, onDecision, renderPolicy, mediaScale, taskId }: { gate: ComposerPendingGate; onDecision: (decision: GateDecision) => unknown | Promise<unknown>; renderPolicy?: RichTextRenderPolicy; mediaScale?: number; taskId?: string }) {
  return gate.kind === "permission"
    ? <PermissionGate gate={gate} onDecision={onDecision} />
    : <QuestionGate gate={gate} onDecision={onDecision} renderPolicy={renderPolicy} mediaScale={mediaScale} taskId={taskId} />;
}

function PermissionGate({ gate, onDecision }: { gate: PermissionPendingGate; onDecision: (decision: GateDecision) => unknown | Promise<unknown> }) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const payload = asRecord(gate.payload);
  const tool = asRecord(payload.tool);
  const options = Array.isArray(payload.options) ? payload.options.map(asRecord) : [];
  const kind = String(tool.kind || "tool");
  const locations = Array.isArray(tool.locations) ? tool.locations.map(String) : [];
  const type = permissionType(kind, t);
  const details: Array<[string, string]> = [
    [t("permissionRisk"), gate.risk.toUpperCase()],
    [t("permissionSession"), payload.sessionScope === "child" ? t("subagent") : t("mainSession")],
    [t("scope"), locations.join(", ")],
    [t("tool"), kind],
    [t("status"), String(tool.status || "")],
  ].filter((item): item is [string, string] => Boolean(item[1]));
  const decide = async (action: "submit" | "skip", optionId?: unknown) => {
    if (submitting) return;
    const submissionKey = action === "submit" ? String(optionId) : "__cancelled__";
    setSubmitting(submissionKey);
    try {
      await onDecision({
        requestId: crypto.randomUUID(),
        gateId: gate.gateId,
        action,
        ...(action === "submit" ? { value: { optionId } } : {}),
      });
    } finally {
      setSubmitting(null);
    }
  };
  return <div className={styles.shell}><Surface as="section" appearance="raised" elevation="floating" shape="surface" tone={gate.risk === "high" ? "danger" : gate.risk === "medium" ? "warning" : "neutral"} attention={gate.risk === "high" || gate.risk === "medium"} className={`${styles.gate} ${styles.permissionGate}`}>
    <div className={styles.permissionLine}>
      <div className={styles.permissionInfo}><ShieldAlert size={14} /><strong>{type}</strong><i>·</i><span>{gate.title}</span>{payload.sessionScope === "child" && <b>{t("subagent")}</b>}{locations[0] && <code>{locations[0]}</code>}{gate.total > 1 && <em>{gate.position}/{gate.total}</em>}</div>
      <div className={styles.permissionActions}>{options.map((option) => {
        const optionKind = String(option.kind);
        const runtimeLabel = String(option.name || "");
        const kindLabel = permissionOptionLabel(optionKind, runtimeLabel, t);
        const label = runtimeLabel || kindLabel;
        return <Control recipe="quiet" density="action" iconOnly tone={permissionOptionTone(optionKind)} key={String(option.optionId)} title={label} aria-label={runtimeLabel && runtimeLabel !== kindLabel ? `${runtimeLabel} · ${kindLabel}` : label} disabled={Boolean(submitting)} onClick={() => void decide("submit", option.optionId)}>
          {submitting === String(option.optionId) ? <Spinner size="compact" tone={permissionOptionTone(optionKind)} /> : permissionOptionIcon(optionKind)}
        </Control>;
      })}{options.length === 0 && <Control recipe="quiet" density="action" iconOnly tone="danger" title={t("cancel")} aria-label={t("cancel")} disabled={Boolean(submitting)} onClick={() => void decide("skip")}>{submitting ? <Spinner size="compact" tone="danger" /> : <X size={13} />}</Control>}</div>
    </div>
    {details.length > 0 && <dl className={styles.permissionDetails}>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
  </Surface></div>;
}

function QuestionGate({ gate, onDecision, renderPolicy, mediaScale, taskId }: { gate: QuestionPendingGate; onDecision: (decision: GateDecision) => unknown | Promise<unknown>; renderPolicy?: RichTextRenderPolicy; mediaScale?: number; taskId?: string }) {
  const { t } = useTranslation();
  const questions = useMemo(() => {
    const payload = asRecord(gate.payload);
    return Array.isArray(payload.questions) ? payload.questions.map(asRecord) : [];
  }, [gate.payload]);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, ComposerNode[]>>({});
  const [notes, setNotes] = useState<Record<string, ComposerNode[]>>({});
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [partialSubmitConfirm, setPartialSubmitConfirm] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedOption, setExpandedOption] = useState<string | null>(null);
  const partialSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const question = questions[step] || {};
  const prompt = String(question.question || "Question");
  const selected = answers[prompt] || [];
  const multiSelect = question.multiSelect === true;
  const options = Array.isArray(question.options) ? question.options.map(asRecord) : [];
  const customContent = composerHasContent(other[prompt] || []);
  const customSelected = selected.includes(CUSTOM_ANSWER);
  const showClearAnswer = multiSelect ? customSelected || customContent : selected.length > 0 || customContent;
  const expandedOptionHeight = useQuestionOptionLayout({ header: headerRef, tabs: tabsRef, note: noteRef, options: optionsRef, scopeKey: `${gate.gateId}:${step}` });
  const normalized = useMemo(() => normalizeAnswers(answers, other), [answers, other]);
  const answered = questions.filter((item) => normalized[String(item.question)]?.length).length;
  const noted = questions.filter((item) => composerHasContent(notes[String(item.question)] || [])).length;
  const hasContent = answered > 0 || noted > 0;
  const answerVersion = useMemo(() => JSON.stringify([normalized, notes]), [normalized, notes]);
  useEffect(() => {
    setPartialSubmitConfirm(false);
    setSkipConfirm(false);
    if (partialSubmitTimer.current) clearTimeout(partialSubmitTimer.current);
    if (skipConfirmTimer.current) clearTimeout(skipConfirmTimer.current);
    partialSubmitTimer.current = null;
    skipConfirmTimer.current = null;
    return () => {
      if (partialSubmitTimer.current) clearTimeout(partialSubmitTimer.current);
      if (skipConfirmTimer.current) clearTimeout(skipConfirmTimer.current);
    };
  }, [answerVersion, gate.gateId]);
  useEffect(() => setCollapsed(false), [gate.gateId]);
  const goToStep = (value: number) => { setExpandedOption(null); setStep(Math.max(0, Math.min(value, questions.length - 1))); };
  const advance = () => goToStep(step + 1);
  const toggle = (label: string) => {
    setAnswers((value) => {
      const current = value[prompt] || [];
      return { ...value, [prompt]: multiSelect ? current.includes(label) ? current.filter((item) => item !== label) : [...current, label] : [label] };
    });
    if (!multiSelect && step < questions.length - 1) advance();
  };
  const submit = async () => {
    if (answered < questions.length && !partialSubmitConfirm) {
      setPartialSubmitConfirm(true);
      if (partialSubmitTimer.current) clearTimeout(partialSubmitTimer.current);
      partialSubmitTimer.current = setTimeout(() => {
        partialSubmitTimer.current = null;
        setPartialSubmitConfirm(false);
      }, PARTIAL_SUBMIT_CONFIRM_MS);
      return;
    }
    if (partialSubmitTimer.current) clearTimeout(partialSubmitTimer.current);
    partialSubmitTimer.current = null;
    setPartialSubmitConfirm(false);
    const annotations = Object.fromEntries(Object.entries(notes).flatMap(([key, value]) => {
      const text = composerText(value).trim();
      return text ? [[key, { notes: text }]] : [];
    }));
    setSubmitting(true);
    try { await onDecision({ requestId: crypto.randomUUID(), gateId: gate.gateId, action: "submit", value: { answers: normalized, ...(Object.keys(annotations).length ? { annotations } : {}) } }); }
    finally { setSubmitting(false); }
  };
  const activateCustom = () => setAnswers((value) => ({ ...value, [prompt]: multiSelect ? [...new Set([...(value[prompt] || []), CUSTOM_ANSWER])] : [CUSTOM_ANSWER] }));
  const clearAnswer = () => {
    setAnswers((value) => ({ ...value, [prompt]: multiSelect ? (value[prompt] || []).filter((item) => item !== CUSTOM_ANSWER) : [] }));
    setOther((value) => ({ ...value, [prompt]: [] }));
  };
  const registerFiles = async (files: File[]) => {
    if (!window.grokDesktop) return [];
    try { return await window.grokDesktop.registerDroppedFiles(files); }
    catch { return []; }
  };
  const revealPath = (refId: string) => void window.grokDesktop?.revealPath(refId);
  const skipGroup = async () => {
    if (hasContent && !skipConfirm) {
      setSkipConfirm(true);
      if (skipConfirmTimer.current) clearTimeout(skipConfirmTimer.current);
      skipConfirmTimer.current = setTimeout(() => { skipConfirmTimer.current = null; setSkipConfirm(false); }, SKIP_CONFIRM_MS);
      return;
    }
    if (skipConfirmTimer.current) clearTimeout(skipConfirmTimer.current);
    skipConfirmTimer.current = null;
    setSkipConfirm(false);
    setSubmitting(true);
    try { await onDecision({ requestId: crypto.randomUUID(), gateId: gate.gateId, action: "skip" }); }
    finally { setSubmitting(false); }
  };
  if (collapsed) return <div className={styles.shell}><Surface as="section" appearance="question" elevation="floating" shape="surface" className={`${styles.gate} ${styles.collapsedGate}`}>
    <div className={styles.collapsedSummary}><span>{t("question")}</span><strong>{prompt}</strong><em>{answered}/{questions.length}</em></div>
    <Control recipe="text" density="compact" onClick={() => setCollapsed(false)}>{t("expandQuestion", { defaultValue: "展开" })}</Control>
  </Surface></div>;
  return <div className={styles.shell}><Surface as="section" appearance="question" elevation="floating" shape="surface" className={styles.gate} style={{ "--question-expanded-max-height": `${expandedOptionHeight}px` } as CSSProperties}>
    <header ref={headerRef} className={styles.questionGateHeader}>
      <div className={styles.questionPrompt}><RichContent taskId={taskId} text={prompt} media={mediaItems(question.questionMedia)} renderPolicy={renderPolicy} mediaScale={mediaScale} density="compact" /></div>
      <div className={styles.headerActions}>
        <Control recipe="text" density="compact" disabled={submitting} onClick={() => setCollapsed(true)}>{t("collapseQuestion", { defaultValue: "收起" })}</Control>
        <Control recipe={skipConfirm ? "danger" : "text"} density="compact" disabled={submitting} onClick={() => void skipGroup()}>{skipConfirm ? t("confirmSkip", { defaultValue: "确认跳过" }) : t("skip")}</Control>
        <Control recipe="solid" density="compact" disabled={!hasContent || submitting} onClick={() => void submit()} aria-live="polite">{submitting ? <Spinner size="compact" tone="onAccent" /> : partialSubmitConfirm ? t("confirmPartialSubmit", { answered, total: questions.length }) : <>{t("submit")} {answered}/{questions.length}</>}</Control>
      </div>
    </header>
    {questions.length > 1 && <nav ref={tabsRef} className={styles.questionTabs} aria-label={t("questionProgress")}>{questions.map((item, index) => {
      const done = Boolean(normalized[String(item.question)]?.length);
      const noteOnly = !done && composerHasContent(notes[String(item.question)] || []);
      const current = index === step;
      return <Control recipe="text" density="compact" shape="none" tone={current ? "accent" : done ? "success" : "neutral"} key={`${String(item.question)}:${index}`} className={noteOnly ? styles.noteOnly : ""} aria-current={current ? "step" : undefined} onClick={() => goToStep(index)} aria-label={`${String(item.header || t("question"))} ${index + 1}`}>Q{index + 1}{done && !current && <Check size={8} />}</Control>;
    })}</nav>}
    <div ref={optionsRef} className={styles.questionOptions}>{options.map((option, index) => {
      const label = String(option.label);
      const active = selected.includes(label);
      const optionKey = `${index}:${label}`;
      return <QuestionOption key={optionKey} gateId={gate.gateId} step={step} index={index} active={active} multi={multiSelect} expanded={expandedOption === optionKey} onToggle={() => toggle(label)} onExpandedChange={(value) => setExpandedOption(value ? optionKey : null)} taskId={taskId} renderPolicy={renderPolicy} mediaScale={mediaScale} option={{
        label,
        description: String(option.description || ""),
        preview: String(option.preview || ""),
        labelMedia: mediaItems(option.labelMedia),
        descriptionMedia: mediaItems(option.descriptionMedia),
        previewMedia: mediaItems(option.previewMedia),
      }} />;
    })}
      <Surface appearance="plain" shape="control" interactive selected={selected.includes(CUSTOM_ANSWER)} className={styles.customAnswer}>
        <Control recipe="icon" density="detail" shape="round" onClick={activateCustom} aria-label={t("fillPlaceholder", { defaultValue: "待填写" })} aria-pressed={customSelected}><SelectionMark selected={customSelected} multiple={multiSelect} /></Control>
        <InlineComposerEditor value={other[prompt] || []} disabled={submitting} maxLines={12} className={styles.questionEditor} placeholder={t("fillPlaceholder", { defaultValue: "待填写" })} onFocus={activateCustom} onChange={(nodes) => { activateCustom(); setOther((value) => ({ ...value, [prompt]: nodes })); }} onSubmit={() => void submit()} onFiles={registerFiles} onRevealPath={revealPath} />
        {showClearAnswer && <Control recipe="icon" density="detail" shape="round" tone="danger" className={styles.clearAnswer} onClick={clearAnswer} aria-label={t(multiSelect ? "clearCustomAnswer" : "clearQuestionAnswer")}><X size={11} /></Control>}
      </Surface>
    </div>
    <div ref={noteRef} className={styles.noteArea}><Divider extent="half" /><InlineComposerEditor value={notes[prompt] || []} disabled={submitting} maxLines={3} className={`${styles.questionEditor} ${styles.note}`} placeholder={t("answerNote")} onChange={(nodes) => setNotes((value) => ({ ...value, [prompt]: nodes }))} onSubmit={() => void submit()} onFiles={registerFiles} onRevealPath={revealPath} /></div>
  </Surface></div>;
}

const CUSTOM_ANSWER = "\u0000custom-answer";
const PARTIAL_SUBMIT_CONFIRM_MS = 4_000;
const SKIP_CONFIRM_MS = 4_000;

function normalizeAnswers(answers: Record<string, string[]>, other: Record<string, ComposerNode[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(answers).flatMap(([key, values]) => {
    const custom = composerText(other[key] || []).trim();
    const normalized = [...values.filter((value) => value !== CUSTOM_ANSWER), ...(values.includes(CUSTOM_ANSWER) && custom ? [custom] : [])];
    return normalized.length ? [[key, normalized]] : [];
  }));
}

function asRecord(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }

function mediaItems(value: unknown): TaskMediaAttachment[] {
  return Array.isArray(value) ? value.filter((item): item is TaskMediaAttachment => Boolean(item && typeof item === "object" && "mediaId" in item)) : [];
}

function permissionOptionIcon(kind: string) {
  if (kind === "allow_always") return <CheckCheck size={13} />;
  if (kind === "allow_once") return <Check size={13} />;
  if (kind === "reject_always") return <ShieldX size={13} />;
  return <X size={13} />;
}

function permissionOptionTone(kind: string): "accent" | "success" | "danger" {
  if (kind === "allow_always") return "accent";
  if (kind === "allow_once") return "success";
  return "danger";
}

function permissionOptionLabel(kind: string, fallback: string, t: (key: string) => string): string {
  if (kind === "allow_always") return t("permissionAlwaysAllow");
  if (kind === "allow_once") return t("permissionAllow");
  if (kind === "reject_always") return t("permissionAlwaysDeny");
  if (kind === "reject_once") return t("permissionDeny");
  return fallback;
}

function permissionType(kind: string, t: (key: string) => string): string {
  const normalized = kind.toLowerCase();
  if (/edit|write|file/.test(normalized)) return t("permissionEdit");
  if (/terminal|command|execute|bash|shell/.test(normalized)) return t("permissionExecute");
  if (/read|search/.test(normalized)) return t("permissionRead");
  if (/mcp/.test(normalized)) return "MCP";
  return kind;
}
