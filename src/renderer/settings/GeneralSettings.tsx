import { useEffect, useRef, useState } from "react";
import { Code2, FolderCog, FolderPlus, Globe2, Image, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FONT_WEIGHT_DEFAULT, FONT_WEIGHT_MAX, FONT_WEIGHT_MIN, type GrokHomeProfileStatus, type GrokHomeProfileSummary, type MediaPresentation, type UiPreferences } from "../../shared/contracts.js";
import { CORNER_RADIUS_MAX, CORNER_RADIUS_MIN } from "../../shared/themeGeometry.js";
import { useUiPreferenceIntent, useUiPreferences } from "../api/hooks.js";
import { MEDIA_SCALE_MAX, MEDIA_SCALE_MIN } from "../mediaSizing.js";
import { CORNER_RADIUS_PREVIEW_EVENT } from "../../ui/theme/index.js";
import { applyUiVisualPreferences } from "../design/applyUiVisualPreferences.js";
import { Badge, Control, Input, Notice, SegmentedControl, SettingCard, SettingSection, Switch, Text } from "../../ui/components/index.js";
import styles from "./SettingsPanels.module.css";

const READING_WIDTH_MIN = 640;
const READING_WIDTH_MAX = 1600;
type ContinuousPreference = "fontScale" | "fontWeight" | "layoutScale" | "lineSpacing" | "letterSpacing" | "mediaPreviewScale" | "mediaMinimumSize";
type ContinuousValues = Pick<UiPreferences, ContinuousPreference>;

export function GeneralSettings() {
  const { i18n, t } = useTranslation();
  const preferences = useUiPreferences().data;
  const savePreferences = useUiPreferenceIntent();
  const [readingWidth, setReadingWidth] = useState(() => effectiveReadingWidth(preferences));
  const [continuous, setContinuous] = useState<ContinuousValues>(() => continuousValues(preferences));
  const [cornerRadius, setCornerRadius] = useState(preferences.cornerRadius);
  const lastSubmittedReadingWidth = useRef(effectiveReadingWidth(preferences));
  const lastSubmittedContinuous = useRef(continuousValues(preferences));
  const lastSubmittedCornerRadius = useRef(preferences.cornerRadius);
  const persistedVisualPreferences = useRef(preferences);
  const update = (values: Partial<UiPreferences>) => savePreferences.mutate({ ...preferences, ...values });
  useEffect(() => {
    const value = effectiveReadingWidth(preferences);
    setReadingWidth(value);
    lastSubmittedReadingWidth.current = value;
  }, [preferences.readingWidth, preferences.readingWidthCustom]);
  useEffect(() => {
    const values = continuousValues(preferences);
    setContinuous(values);
    lastSubmittedContinuous.current = values;
  }, [preferences.fontScale, preferences.fontWeight, preferences.layoutScale, preferences.letterSpacing, preferences.lineSpacing, preferences.mediaMinimumSize, preferences.mediaPreviewScale]);
  useEffect(() => {
    setCornerRadius(preferences.cornerRadius);
    lastSubmittedCornerRadius.current = preferences.cornerRadius;
    // The persisted/optimistic preference is now authoritative. Clearing the
    // transient preview also makes a failed mutation roll back correctly.
    previewCornerRadius(null);
  }, [preferences.cornerRadius]);
  useEffect(() => {
    persistedVisualPreferences.current = preferences;
  }, [preferences]);
  useEffect(
    () => () => {
      applyUiVisualPreferences(persistedVisualPreferences.current);
      previewCornerRadius(null);
    },
    [],
  );
  const previewContinuous = (name: ContinuousPreference, value: number) => {
    setContinuous((current) => ({ ...current, [name]: value }));
    const css = continuousCssValue(name, value);
    if (css) document.documentElement.style.setProperty(...css);
  };
  const commitContinuous = (name: ContinuousPreference, value: number) => {
    if (value === lastSubmittedContinuous.current[name]) return;
    lastSubmittedContinuous.current = { ...lastSubmittedContinuous.current, [name]: value };
    update({ [name]: value });
  };
  const changeReadingWidth = (value: number) => {
    setReadingWidth(value);
    document.documentElement.style.setProperty("--conversation-max-width", `${value}px`);
  };
  const commitReadingWidth = (value = readingWidth) => {
    if (value === lastSubmittedReadingWidth.current && preferences.readingWidth !== 0) return;
    lastSubmittedReadingWidth.current = value;
    update({ readingWidth: value, readingWidthCustom: value });
  };
  const setFullReadingWidth = (full: boolean) => {
    update({ readingWidth: full ? 0 : readingWidth, readingWidthCustom: readingWidth });
  };
  const changeCornerRadius = (value: number) => {
    setCornerRadius(value);
    previewCornerRadius(value);
  };
  const commitCornerRadius = (value = cornerRadius) => {
    if (value === lastSubmittedCornerRadius.current) return;
    lastSubmittedCornerRadius.current = value;
    update({ cornerRadius: value });
  };
  const updateMediaPresentation = (source: "nativeMedia" | "localMedia", kind: "image" | "video" | "audio", value: MediaPresentation) => update({
    richTextRenderPolicy: {
      ...preferences.richTextRenderPolicy,
      presentation: {
        ...preferences.richTextRenderPolicy.presentation,
        [source]: { ...preferences.richTextRenderPolicy.presentation[source], [kind]: value },
      },
    },
  });
  const updateRecognition = (key: keyof UiPreferences["richTextRenderPolicy"]["recognition"], value: boolean) => update({
    richTextRenderPolicy: {
      ...preferences.richTextRenderPolicy,
      recognition: { ...preferences.richTextRenderPolicy.recognition, [key]: value },
    },
  });
  const updateReferencePresentation = (key: "localMarkdownLinks" | "localBarePaths" | "localInlineCodePaths" | "webInlineCodeUrls", value: "link" | "text") => update({
    richTextRenderPolicy: {
      ...preferences.richTextRenderPolicy,
      presentation: { ...preferences.richTextRenderPolicy.presentation, [key]: value },
    },
  });
  const updateCodePreviewLanguage = (language: keyof UiPreferences["codePreview"]["languages"], value: boolean) => update({
    codePreview: {
      ...preferences.codePreview,
      languages: { ...preferences.codePreview.languages, [language]: value },
    },
  });
  return <div className={styles.settingsSections}>
    <SettingSection title={t("grokHomeProfiles")} description={t("grokHomeProfilesDescription")}>
      <GrokHomeProfileSetting />
    </SettingSection>
    <SettingSection title={t("textAndLayout")} description={t("textAndLayoutDescription")}>
      <ContinuousSetting title={t("fontSize")} description={t("fontSizeDescription")} sample={t("fontSizeSample")} min={70} max={180} value={continuous.fontScale} format={formatScale} onChange={(value) => previewContinuous("fontScale", value)} onCommit={(value) => commitContinuous("fontScale", value)} />
      <ContinuousSetting title={t("fontWeight")} description={t("fontWeightDescription")} sample={t("fontWeightSample")} min={FONT_WEIGHT_MIN} max={FONT_WEIGHT_MAX} step={10} value={continuous.fontWeight} onChange={(value) => previewContinuous("fontWeight", value)} onCommit={(value) => commitContinuous("fontWeight", value)} />
      <SettingCard grouped title={t("fontFamilyScope")} description={t("fontFamilyScopeDescription")}><SegmentedControl value={preferences.fontFamilyScope} options={(["global", "conversation", "content"] as const).map((value) => ({ value, label: t(value === "global" ? "fontScopeGlobal" : value === "conversation" ? "fontScopeConversation" : "fontScopeContent") }))} onChange={(fontFamilyScope) => update({ fontFamilyScope })} /></SettingCard>
      <ContinuousSetting title={t("layoutDensity")} description={t("layoutDensityDescription")} min={70} max={140} value={continuous.layoutScale} format={formatScale} onChange={(value) => previewContinuous("layoutScale", value)} onCommit={(value) => commitContinuous("layoutScale", value)} />
      <ContinuousSetting title={t("lineSpacing")} description={t("lineSpacingDescription")} min={80} max={160} value={continuous.lineSpacing} format={formatScale} onChange={(value) => previewContinuous("lineSpacing", value)} onCommit={(value) => commitContinuous("lineSpacing", value)} />
      <ContinuousSetting title={t("letterSpacing")} description={t("letterSpacingDescription")} min={-8} max={20} value={continuous.letterSpacing} format={(value) => `${(value / 100).toFixed(2)}em`} onChange={(value) => previewContinuous("letterSpacing", value)} onCommit={(value) => commitContinuous("letterSpacing", value)} />
      <SettingCard grouped title={t("readingWidth")} description={t("readingWidthDescription")}>
        <div className={styles.scaleControl}>
          <div className={styles.scaleReadout}><Text font="numeric">{readingWidth}px</Text><Switch checked={preferences.readingWidth === 0} onChange={(event) => setFullReadingWidth(event.target.checked)} label="Full" /></div>
          <Input aria-label={t("readingWidth")} type="range" min={READING_WIDTH_MIN} max={READING_WIDTH_MAX} step="20" value={readingWidth} disabled={preferences.readingWidth === 0} onChange={(event) => changeReadingWidth(Number(event.target.value))} onPointerUp={(event) => commitReadingWidth(Number(event.currentTarget.value))} onKeyUp={(event) => commitReadingWidth(Number(event.currentTarget.value))} onBlur={(event) => commitReadingWidth(Number(event.currentTarget.value))} />
        </div>
      </SettingCard>
      <SettingCard grouped title={t("mediaDefaultSize")} description={t("mediaDefaultSizeDescription")}>
        <div className={styles.scaleControl}>
          <SegmentedControl value={preferences.mediaInitialSize} options={(['native', 'smaller', 'larger', 'comfortable'] as const).map((value) => ({ value, label: t(`mediaInitial_${value}`) }))} onChange={(mediaInitialSize) => update({ mediaInitialSize })} />
          <div className={styles.scaleReadout}><Text tone="muted" size="label">{t("mediaComfortableSize")}</Text><Text as="strong" tone="muted" font="numeric">{continuous.mediaPreviewScale}%</Text></div>
          <Input aria-label={t("mediaComfortableSize")} type="range" min={MEDIA_SCALE_MIN} max={MEDIA_SCALE_MAX} value={continuous.mediaPreviewScale} disabled={preferences.mediaInitialSize === "native"} onChange={(event) => previewContinuous("mediaPreviewScale", Number(event.target.value))} onPointerUp={(event) => commitContinuous("mediaPreviewScale", Number(event.currentTarget.value))} onKeyUp={(event) => commitContinuous("mediaPreviewScale", Number(event.currentTarget.value))} onBlur={(event) => commitContinuous("mediaPreviewScale", Number(event.currentTarget.value))} />
        </div>
      </SettingCard>
      <ContinuousSetting title={t("mediaMinimumSize")} description={t("mediaMinimumSizeDescription")} min={48} max={240} step={8} value={continuous.mediaMinimumSize} format={(value) => `${value}px`} onChange={(value) => previewContinuous("mediaMinimumSize", value)} onCommit={(value) => commitContinuous("mediaMinimumSize", value)} />
      <SettingCard grouped title={t("grokMessagePresentation")} description={t("grokMessagePresentationDescription")}><SegmentedControl value={preferences.grokMessagePresentation} options={(["document", "bubble"] as const).map((value) => ({ value, label: t(value === "document" ? "grokMessageDocument" : "grokMessageBubble") }))} onChange={(grokMessagePresentation) => update({ grokMessagePresentation })} /></SettingCard>
      <ContinuousSetting title={t("cornerStrength")} description={t("cornerStrengthDescription")} min={CORNER_RADIUS_MIN} max={CORNER_RADIUS_MAX} value={cornerRadius} format={(value) => `${value}px`} onChange={changeCornerRadius} onCommit={commitCornerRadius} />
      <SettingCard grouped title={t("sendShortcut")} description={t("sendShortcutDescription")}><SegmentedControl value={preferences.sendShortcut} options={(["enter", "commandEnter"] as const).map((value) => ({ value, label: value === "enter" ? "Enter" : "⌘ Enter" }))} onChange={(sendShortcut) => update({ sendShortcut })} /></SettingCard>
    </SettingSection>
    <SettingSection title={t("languageAndTime")} description={t("languageAndTimeDescription")}>
      <SettingCard grouped title={t("language")} description={t("languageDescription")}>
        <SegmentedControl value={i18n.language as UiPreferences["locale"]} options={(["zh-CN", "en-US"] as const).map((locale) => ({ value: locale, label: locale === "zh-CN" ? "简体中文" : "English" }))} onChange={(locale) => update({ locale })} />
      </SettingCard>
      <SettingCard grouped title={t("timestamps")} description={t("timestampsDescription")}><SegmentedControl value={preferences.timestamps} options={(["hover", "always"] as const).map((value) => ({ value, label: value === "hover" ? "Hover / Focus" : t("alwaysVisible") }))} onChange={(timestamps) => update({ timestamps })} /></SettingCard>
    </SettingSection>
    <SettingSection title={t("rendering")} description={t("renderingDescription")}>
      <SettingCard grouped title={t("collapseWorkProcessByDefault")} description={t("collapseWorkProcessByDefaultDescription")}><Switch checked={preferences.collapseWorkProcessByDefault} onChange={(event) => update({ collapseWorkProcessByDefault: event.target.checked })} label={t("collapseWorkProcessByDefaultToggle")} /></SettingCard>
      <SettingCard grouped title={t("showContextUsage")} description={t("showContextUsageDescription")}><Switch checked={preferences.showContextUsage} onChange={(event) => update({ showContextUsage: event.target.checked })} label={t("showContextUsageToggle")} /></SettingCard>
      <SettingCard grouped title={t("codePreviewRendering")} description={t("codePreviewRenderingDescription")}>
        <div className={styles.policyGroups}>
          <div className={styles.policyGroup} data-shape="control">
            <div className={styles.policyHeading}><Code2 size={13} /><Text as="strong" size="label">{t("interactiveCodePreview")}</Text></div>
            <Switch checked={preferences.codePreview.interactive} onChange={(event) => update({ codePreview: { ...preferences.codePreview, interactive: event.target.checked } })} label={t("interactiveCodePreviewToggle")} />
          </div>
          <div className={styles.policyGroup} data-shape="control">
            <div className={styles.policyHeading}><Code2 size={13} /><Text as="strong" size="label">{t("codePreviewLanguages")}</Text></div>
            {(["html", "css", "javascript", "typescript"] as const).map((language) =>
              <Switch key={language} checked={preferences.codePreview.languages[language]} onChange={(event) => updateCodePreviewLanguage(language, event.target.checked)} label={t(`codePreview_${language}`)} />)}
          </div>
        </div>
      </SettingCard>
      <SettingCard grouped title={t("richTextMediaRendering")} description={t("richTextMediaRenderingDescription")}>
        <div className={styles.policyGroups}>
          {(["nativeMedia", "localMedia"] as const).map((source) => <div className={styles.policyGroup} data-shape="control" key={source}>
            <div className={styles.policyHeading}><Image size={13} /><Text as="strong" size="label">{t(source === "nativeMedia" ? "nativeMediaPresentation" : "localMediaPresentation")}</Text></div>
            {(["image", "video", "audio"] as const).map((kind) => <div className={styles.policyRow} key={kind}>
              <Text as="span" tone="muted" size="label">{t(`mediaType_${kind}`)}</Text>
              <SegmentedControl value={preferences.richTextRenderPolicy.presentation[source][kind]} options={presentationOptions(t)} onChange={(value) => updateMediaPresentation(source, kind, value)} />
            </div>)}
          </div>)}
          <div className={styles.policyGroup} data-shape="control">
            <div className={styles.policyHeading}><Globe2 size={13} /><Text as="strong" size="label">{t("remoteMarkdownImages")}</Text></div>
            <div className={styles.policyRow}>
              <Text as="span" tone="muted" size="label">{t("remoteMarkdownImagePresentation")}</Text>
              <SegmentedControl value={preferences.richTextRenderPolicy.presentation.remoteMarkdownImages} options={presentationOptions(t)} onChange={(remoteMarkdownImages) => update({ richTextRenderPolicy: { ...preferences.richTextRenderPolicy, presentation: { ...preferences.richTextRenderPolicy.presentation, remoteMarkdownImages } } })} />
            </div>
          </div>
            <div className={styles.policyGroup} data-shape="control">
              <div className={styles.policyHeading}><Link2 size={13} /><Text as="strong" size="label">{t("recognitionSources")}</Text></div>
              {(["localMarkdownLinks", "localMarkdownMedia", "localBarePaths", "localInlineCodePaths", "webInlineCodeUrls", "remoteMarkdownImages"] as const).map((key) =>
                <Switch key={key} checked={preferences.richTextRenderPolicy.recognition[key]} onChange={(event) => updateRecognition(key, event.target.checked)} label={t(`recognition_${key}`)} />)}
            </div>
            <div className={styles.policyGroup} data-shape="control">
              <div className={styles.policyHeading}><Code2 size={13} /><Text as="strong" size="label">{t("referencePresentation")}</Text></div>
              {(["localMarkdownLinks", "localBarePaths", "localInlineCodePaths", "webInlineCodeUrls"] as const).map((key) => <div className={styles.policyRow} key={key}>
                <Text as="span" tone="muted" size="label">{t(`presentation_${key}`)}</Text>
                <SegmentedControl value={preferences.richTextRenderPolicy.presentation[key]} options={(["link", "text"] as const).map((value) => ({ value, label: t(`mediaPresentation_${value}`) }))} onChange={(value) => updateReferencePresentation(key, value)} />
              </div>)}
            </div>
        </div>
      </SettingCard>
    </SettingSection>
  </div>;
}

function GrokHomeProfileSetting() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GrokHomeProfileStatus | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void window.grokDesktop?.getGrokHomeProfiles()
      .then((value) => { if (active) setStatus(value); })
      .catch((reason) => { if (active) setError(messageFrom(reason)); });
    return () => { active = false; };
  }, []);
  const select = async (profileId: string) => {
    if (!window.grokDesktop) return;
    setPending(profileId); setError(null);
    try { setStatus((await window.grokDesktop.selectGrokHome(profileId)).status); }
    catch (reason) { setError(messageFrom(reason)); }
    finally { setPending(null); }
  };
  const choose = async () => {
    if (!window.grokDesktop) return;
    setPending("choose"); setError(null);
    try { setStatus((await window.grokDesktop.chooseCustomGrokHome()).status); }
    catch (reason) { setError(messageFrom(reason)); }
    finally { setPending(null); }
  };
  return <SettingCard grouped title={t("activeGrokHome")} description={t("activeGrokHomeDescription")}>
    <div className={styles.grokHomeControl}>
      <div className={styles.grokHomeProfiles}>
        {status?.profiles.map((profile) => <div className={styles.grokHomeProfile} data-shape="control" key={profile.id} data-active={profile.active || undefined}>
          <div className={styles.grokHomeIdentity}>
            <span><FolderCog size={14} /><Text as="strong" size="label">{grokHomeLabel(profile, t)}</Text></span>
            <Text as="code" font="code" size="caption" tone="muted" truncate title={profile.path}>{profile.path}</Text>
          </div>
          <div className={styles.grokHomeActions}>
            {profile.active
              ? <Badge tone="accent" variant="soft">{t("current")}</Badge>
              : profile.available
                ? <Control recipe="quiet" density="compact" disabled={pending !== null} onClick={() => void select(profile.id)}>{pending === profile.id ? t("switchingGrokHome") : t("switchGrokHome")}</Control>
                : <Badge tone="warning" variant="soft">{t("grokHomeMissing")}</Badge>}
          </div>
        </div>)}
      </div>
      <Control recipe="quiet" disabled={pending !== null || !window.grokDesktop} onClick={() => void choose()}><FolderPlus size={14} />{pending === "choose" ? t("openingGrokHomePicker") : t("chooseCustomGrokHome")}</Control>
      {error && <Notice tone="danger" density="compact">{error}</Notice>}
    </div>
  </SettingCard>;
}

function grokHomeLabel(profile: GrokHomeProfileSummary, t: ReturnType<typeof useTranslation>["t"]): string {
  if (profile.kind === "native") return t("nativeGrokHome");
  if (profile.kind === "legacy") return t("legacyGrokHome");
  return t("customGrokHome");
}

function messageFrom(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function presentationOptions(t: ReturnType<typeof useTranslation>["t"]): Array<{ value: MediaPresentation; label: string }> {
  return (["inline", "link", "text"] as const).map((value) => ({ value, label: t(`mediaPresentation_${value}`) }));
}

function previewCornerRadius(value: number | null): void {
  window.dispatchEvent(new CustomEvent(CORNER_RADIUS_PREVIEW_EVENT, { detail: value }));
}

function effectiveReadingWidth(preferences: Pick<UiPreferences, "readingWidth" | "readingWidthCustom">): number {
  return preferences.readingWidth === 0 ? preferences.readingWidthCustom : preferences.readingWidth;
}

function formatScale(value: number): string {
  return `${Number((value / 100).toFixed(2))}×`;
}

function continuousValues(preferences: UiPreferences): ContinuousValues {
  const { fontScale, fontWeight, layoutScale, lineSpacing, letterSpacing, mediaPreviewScale, mediaMinimumSize } = preferences;
  return { fontScale, fontWeight, layoutScale, lineSpacing, letterSpacing, mediaPreviewScale, mediaMinimumSize };
}

function continuousCssValue(name: ContinuousPreference, value: number): [string, string] | null {
  if (name === "fontScale") return ["--font-scale", String(value / 100)];
  if (name === "fontWeight") return ["--font-weight-adjust", String(value - FONT_WEIGHT_DEFAULT)];
  if (name === "layoutScale") return ["--layout-density-scale", String(value / 100)];
  if (name === "lineSpacing") return ["--line-spacing-scale", String(value / 100)];
  if (name === "letterSpacing") return ["--letter-spacing-adjust", `${value / 100}em`];
  return null;
}

function ContinuousSetting({ title, description, sample, min, max, step = 1, value, format = String, onChange, onCommit }: {
  title: string;
  description: string;
  sample?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return <SettingCard grouped title={title} description={description}>
    <div className={styles.scaleControl}>
      <div className={styles.scaleReadout}><Text font="body">{sample || title}</Text><Text as="strong" tone="muted" font="numeric">{format(value)}</Text></div>
      <Input aria-label={title} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} onPointerUp={(event) => onCommit(Number(event.currentTarget.value))} onKeyUp={(event) => onCommit(Number(event.currentTarget.value))} onBlur={(event) => onCommit(Number(event.currentTarget.value))} />
    </div>
  </SettingCard>;
}
