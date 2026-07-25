import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  Download,
  FileJson,
  FolderOpen,
  ImagePlus,
  Link2,
  Monitor,
  MoonStar,
  Paintbrush,
  Pencil,
  RotateCcw,
  Save,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import {
  ThemeBundleV1Schema,
  ThemeManifestV1Schema,
  type ThemeAssetReference,
  type ThemeBundleV1,
  type ThemeLibraryEntry,
  type ThemeLibrarySnapshot,
  type ThemeManifestV1,
} from "../../shared/contracts.js";
import { normalizeThemeGeometry } from "../../shared/themeGeometry.js";
import { useBootstrap } from "../api/BootstrapContext.js";
import { useTheme, useThemes } from "../api/hooks.js";
import { THEME_PREVIEW_EVENT, activeThemeId } from "../../ui/theme/index.js";
import { SemanticMutationDialog } from "../components/SemanticMutationDialog.js";
import { useSystemDark } from "../design/useSystemDark.js";
import {
  Control,
  Field,
  FormDialog,
  Input,
  Surface,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
  Text,
  TextArea,
  ThemedSelect,
} from "../../ui/components/index.js";
import styles from "./ThemeStudio.module.css";
import { themeSwatchVariables } from "./themeSwatch.js";

export function ThemeStudio() {
  const { t } = useTranslation();
  const { api } = useBootstrap();
  const queryClient = useQueryClient();
  const library = useThemes();
  const systemDark = useSystemDark();
  const appliedId = activeThemeId(library.data, systemDark);
  const selectedId = library.data.selectedThemeId;
  const [editorThemeId, setEditorThemeIdState] = useState(appliedId);
  const editorThemeIdRef = useRef(appliedId);
  const editorSession = useRef(0);
  const observedAppliedId = useRef(appliedId);
  const pendingAppliedId = useRef<string | null>(null);
  const selected = useTheme(editorThemeId);
  const [draft, setDraft] = useState<ThemeManifestV1 | null>(
    selected.data || null,
  );
  const [baseline, setBaseline] = useState<ThemeManifestV1 | null>(
    selected.data || null,
  );
  const currentDraftId = useRef(draft?.id);
  const stagedAssetIds = useRef(new Set<string>());
  const [json, setJson] = useState(() =>
    selected.data ? JSON.stringify(selected.data, null, 2) : "",
  );
  const [message, setMessage] = useState("");
  const [diff, setDiff] = useState<{
    manifest: ThemeManifestV1;
    changes: Array<{ path: string; before: unknown; after: unknown }>;
  } | null>(null);
  const [renameDraft, setRenameDraft] = useState<{
    nextId: string;
    nextName: string;
  } | null>(null);
  const [pendingBundle, setPendingBundle] = useState<{
    bundle: ThemeBundleV1;
    changes: Array<{ path: string; before: unknown; after: unknown }>;
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const activeEntry = library.data.themes.find(
    (theme) => theme.id === draft?.id,
  );
  const previewChanged = Boolean(
    draft &&
      baseline &&
      JSON.stringify(draft) !== JSON.stringify(baseline),
  );

  const openEditorTheme = useCallback((themeId: string) => {
    if (editorThemeIdRef.current !== themeId) {
      editorThemeIdRef.current = themeId;
      editorSession.current += 1;
    }
    setEditorThemeIdState(themeId);
  }, []);

  const replaceDraft = useCallback(
    (next: ThemeManifestV1 | null, updateBaseline = false) => {
      if (currentDraftId.current !== next?.id) editorSession.current += 1;
      currentDraftId.current = next?.id;
      setDraft(next);
      if (updateBaseline) setBaseline(next);
    },
    [],
  );

  const discardStagedAsset = useCallback(
    (assetId: string) => {
      stagedAssetIds.current.delete(assetId);
      void api
        .post<{ discarded: boolean }>("/themes/assets/discard", {
          requestId: crypto.randomUUID(),
          assetId,
        })
        .catch(() => {
          // Keep the asset staged so a later draft transition can retry cleanup.
          stagedAssetIds.current.add(assetId);
        });
    },
    [api],
  );

  useEffect(() => {
    currentDraftId.current = draft?.id;
  }, [draft?.id]);

  useEffect(() => {
    const incoming = selected.data;
    if (!incoming || incoming.id !== editorThemeId) return;
    if (incoming === baseline && draft === incoming) return;
    const dirty = Boolean(
      draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline),
    );
    if (baseline?.id === incoming.id && dirty) return;
    replaceDraft(incoming, true);
  }, [baseline, draft, editorThemeId, replaceDraft, selected.data]);

  useEffect(() => {
    if (observedAppliedId.current !== appliedId) {
      observedAppliedId.current = appliedId;
      if (previewChanged) pendingAppliedId.current = appliedId;
      else {
        pendingAppliedId.current = null;
        openEditorTheme(appliedId);
      }
      return;
    }
    if (!previewChanged && pendingAppliedId.current) {
      const pending = pendingAppliedId.current;
      pendingAppliedId.current = null;
      openEditorTheme(pending);
    }
  }, [appliedId, openEditorTheme, previewChanged]);

  useEffect(() => {
    const attached = new Set(draft?.assets.map((asset) => asset.id) ?? []);
    for (const assetId of [...stagedAssetIds.current]) {
      if (!attached.has(assetId)) discardStagedAsset(assetId);
    }
  }, [discardStagedAsset, draft?.assets]);

  useEffect(
    () => () => {
      for (const assetId of [...stagedAssetIds.current]) {
        discardStagedAsset(assetId);
      }
    },
    [discardStagedAsset],
  );

  useEffect(() => {
    const parsed =
      draft && previewChanged ? ThemeManifestV1Schema.safeParse(draft) : null;
    const preview = parsed?.success
      ? normalizeThemeGeometry(parsed.data)
      : null;
    window.dispatchEvent(
      new CustomEvent<ThemeManifestV1 | null>(THEME_PREVIEW_EVENT, {
        detail: preview,
      }),
    );
  }, [draft, previewChanged]);

  useEffect(
    () => () => {
      window.dispatchEvent(
        new CustomEvent<ThemeManifestV1 | null>(THEME_PREVIEW_EVENT, {
          detail: null,
        }),
      );
    },
    [],
  );

  useEffect(() => {
    if (draft) setJson(JSON.stringify(draft, null, 2));
  }, [draft]);
  const select = useMutation({
    mutationFn: (input: { themeId: string; followSystem: boolean }) =>
      api.post<ThemeLibrarySnapshot>("/themes/select", {
        requestId: crypto.randomUUID(),
        ...input,
      }),
    onSuccess: (value, input) => {
      queryClient.setQueryData(["theme-library"], value);
      openEditorTheme(
        input.followSystem ? activeThemeId(value, systemDark) : input.themeId,
      );
      setMessage(t("themeApplied"));
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });
  const save = useMutation({
    mutationFn: async (manifest: ThemeManifestV1) => {
      const saved = await api.post<{
        theme: ThemeManifestV1;
        warnings: string[];
      }>("/themes/save", {
        requestId: crypto.randomUUID(),
        manifest,
        overwrite: library.data.themes.some(
          (theme) => theme.id === manifest.id && !theme.builtIn,
        ),
      });
      let nextLibrary = library.data;
      let applyError: string | null = null;
      try {
        nextLibrary = await api.post<ThemeLibrarySnapshot>("/themes/select", {
          requestId: crypto.randomUUID(),
          themeId: saved.theme.id,
          followSystem: false,
        });
      } catch (error) {
        applyError = errorMessage(error);
        try {
          nextLibrary = await api.get<ThemeLibrarySnapshot>("/themes");
        } catch {
          // Saving is authoritative even when the follow-up refresh is unavailable.
        }
      }
      return { ...saved, library: nextLibrary, applyError };
    },
    onSuccess: (value) => {
      queryClient.setQueryData(["theme", value.theme.id], value.theme);
      queryClient.setQueryData(["theme-library"], value.library);
      if (value.applyError) {
        void queryClient.invalidateQueries({ queryKey: ["theme-library"] });
      }
      openEditorTheme(value.theme.id);
      replaceDraft(value.theme, true);
      for (const asset of value.theme.assets) {
        stagedAssetIds.current.delete(asset.id);
      }
      setMessage(
        value.applyError
          ? t("themeSavedApplyFailed", { error: value.applyError })
          : value.warnings.length
            ? value.warnings.join(" ")
            : t("themeSaved"),
      );
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });
  const remove = useMutation({
    mutationFn: (themeId: string) =>
      api.post<ThemeLibrarySnapshot>("/themes/delete", {
        requestId: crypto.randomUUID(),
        themeId,
      }),
    onSuccess: (value, themeId) => {
      queryClient.removeQueries({ queryKey: ["theme", themeId] });
      queryClient.setQueryData(["theme-library"], value);
      openEditorTheme(activeThemeId(value, systemDark));
      setMessage(t("themeDeleted"));
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });
  const configureSystem = useMutation({
    mutationFn: async (input: {
      light: string;
      dark: string;
      activate?: boolean;
    }) => {
      const configured = await api.post<ThemeLibrarySnapshot>("/themes/preferences", {
        requestId: crypto.randomUUID(),
        systemLightThemeId: input.light,
        systemDarkThemeId: input.dark,
      });
      if (!input.activate) {
        return { library: configured, activationError: null as string | null };
      }
      try {
        const activated = await api.post<ThemeLibrarySnapshot>("/themes/select", {
          requestId: crypto.randomUUID(),
          themeId: systemDark ? input.dark : input.light,
          followSystem: true,
        });
        return { library: activated, activationError: null as string | null };
      } catch (error) {
        return { library: configured, activationError: errorMessage(error) };
      }
    },
    onSuccess: ({ library: value, activationError }) => {
      queryClient.setQueryData(["theme-library"], value);
      if (value.followSystem) openEditorTheme(activeThemeId(value, systemDark));
      setMessage(
        activationError
          ? t("systemThemePairActivationFailed", { error: activationError })
          : t("systemThemePairSaved"),
      );
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });
  const rename = useMutation({
    mutationFn: (input: {
      themeId: string;
      nextId: string;
      nextName: string;
    }) =>
      api.post<ThemeLibrarySnapshot>("/themes/rename", {
        requestId: crypto.randomUUID(),
        ...input,
      }),
    onSuccess: (value, input) => {
      queryClient.removeQueries({ queryKey: ["theme", input.themeId] });
      queryClient.setQueryData(["theme-library"], value);
      openEditorTheme(input.nextId);
      setMessage(t("themeRenamed"));
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });
  const parseJson = () => {
    try {
      const parsed = normalizeThemeGeometry(
        ThemeManifestV1Schema.parse(JSON.parse(json)),
      );
      replaceDraft(parsed);
      setMessage(t("themeJsonValid"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const copyTheme = () => {
    if (!draft) return;
    const suffix = Date.now().toString(36).slice(-5);
    const value = {
      ...draft,
      id: `${draft.id}-copy-${suffix}`,
      name: `${draft.name} ${t("themeCopySuffix")}`,
    };
    replaceDraft(value);
    setMessage(t("themeCopyCreated"));
  };
  const applyBundle = async (bundle: ThemeBundleV1, overwrite: boolean) => {
    try {
      const value = await api.post<{ theme: ThemeManifestV1 }>(
        "/themes/bundle/import",
        { requestId: crypto.randomUUID(), bundle, overwrite },
      );
      let nextLibrary = library.data;
      let applyError: string | null = null;
      try {
        nextLibrary = await api.post<ThemeLibrarySnapshot>("/themes/select", {
          requestId: crypto.randomUUID(),
          themeId: value.theme.id,
          followSystem: false,
        });
      } catch (error) {
        applyError = errorMessage(error);
        try {
          nextLibrary = await api.get<ThemeLibrarySnapshot>("/themes");
        } catch {
          // Importing is authoritative even when the follow-up refresh is unavailable.
        }
      }
      queryClient.setQueryData(["theme", value.theme.id], value.theme);
      queryClient.setQueryData(["theme-library"], nextLibrary);
      if (applyError) {
        void queryClient.invalidateQueries({ queryKey: ["theme-library"] });
      }
      openEditorTheme(value.theme.id);
      replaceDraft(value.theme, true);
      setMessage(
        applyError
          ? t("themeImportedApplyFailed", { error: applyError })
          : t("themeBundleImported"),
      );
      setPendingBundle(null);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const bundle = ThemeBundleV1Schema.safeParse(raw);
      if (bundle.success) {
        const exists = library.data.themes.some(
          (theme) => theme.id === bundle.data.manifest.id && !theme.builtIn,
        );
        if (exists) {
          const result = await api.post<{
            changes: Array<{ path: string; before: unknown; after: unknown }>;
          }>(`/themes/${bundle.data.manifest.id}/diff`, {
            manifest: bundle.data.manifest,
          });
          setPendingBundle({ bundle: bundle.data, changes: result.changes });
          return;
        }
        await applyBundle(bundle.data, false);
      } else {
        const value = normalizeThemeGeometry(ThemeManifestV1Schema.parse(raw));
        replaceDraft(value);
        setMessage(t("themeLoadedPreview"));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const exportTheme = async () => {
    if (!draft) return;
    try {
      const value: ThemeManifestV1 | ThemeBundleV1 = draft.assets.length
        ? await api.post<ThemeBundleV1>("/themes/bundle/export", {
            requestId: crypto.randomUUID(),
            manifest: draft,
          })
        : draft;
      downloadJson(
        value,
        draft.assets.length
          ? `${draft.id}.grok-theme-bundle.json`
          : `${draft.id}.grok-theme.json`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const importAsset = async (file?: File) => {
    if (!file || !draft) return;
    const targetThemeId = draft.id;
    const targetSession = editorSession.current;
    try {
      const extension = file.name.toLowerCase().split(".").pop();
      const kind: ThemeAssetReference["kind"] = [
        "otf",
        "ttf",
        "woff2",
      ].includes(extension || "")
        ? "font"
        : "image";
      const reference = await api.post<ThemeAssetReference>(
        "/themes/assets/import",
        {
          requestId: crypto.randomUUID(),
          kind,
          fileName: file.name,
          dataBase64: await fileBase64(file, t("themeAssetTooLarge")),
        },
      );
      const stillEditingTarget =
        editorSession.current === targetSession &&
        currentDraftId.current === targetThemeId;
      if (!stillEditingTarget) {
        discardStagedAsset(reference.id);
      } else {
        stagedAssetIds.current.add(reference.id);
      }
      setDraft((current) => {
        if (!stillEditingTarget || !current || current.id !== targetThemeId) {
          return current;
        }
        const assets = [
          ...current.assets.filter((asset) => asset.id !== reference.id),
          reference,
        ];
        const backgrounds =
          kind === "image" &&
          !current.backgrounds.some(
            (layer) => layer.type === "asset" && layer.assetId === reference.id,
          )
            ? [
                ...current.backgrounds,
                {
                  type: "asset" as const,
                  assetId: reference.id,
                  opacity: 0.18,
                  blur: 0,
                },
              ]
            : current.backgrounds;
        return { ...current, assets, backgrounds };
      });
      setMessage(
        t(
          stillEditingTarget
            ? "themeAssetImported"
            : "themeAssetImportedAfterSwitch",
          { name: file.name },
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const saveWithDiff = async () => {
    if (!draft) return;
    const candidate = structuredClone(draft);
    try {
      if (activeEntry && !activeEntry.builtIn) {
        const result = await api.post<{
          changes: Array<{ path: string; before: unknown; after: unknown }>;
        }>(`/themes/${candidate.id}/diff`, { manifest: candidate });
        if (result.changes.length) {
          setDiff({ manifest: candidate, changes: result.changes });
          return;
        }
      }
      save.mutate(candidate);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const renameTheme = () => {
    if (!draft || activeEntry?.builtIn) return;
    setRenameDraft({ nextName: draft.name, nextId: draft.id });
  };

  const pairs = themePairs(library.data);
  const standaloneThemes = library.data.themes.filter(
    (theme) => !theme.builtIn || !theme.personality,
  );
  const renderThemeCard = (theme: ThemeLibraryEntry) => {
    const role =
      theme.personality?.role ??
      (theme.appearance === "light" ? "day" : "night");
    return (
      <Control
        recipe="row"
        key={theme.id}
        selected={theme.id === appliedId}
        className={styles.themeItem}
        data-theme-recipe={theme.personality?.recipe}
        onClick={() => {
          openEditorTheme(theme.id);
          select.mutate({ themeId: theme.id, followSystem: false });
        }}
      >
        <span
          className={styles.swatch}
          style={themeSwatchVariables(theme.swatch) as CSSProperties}
          aria-hidden="true"
        >
          <i className={styles.swatchSidebar} />
          <i className={styles.swatchTopbar} />
          <i className={styles.swatchMessage} />
          <i className={styles.swatchAccent} />
        </span>
        <span className={styles.themeCopy}>
          <span className={styles.themeNameLine}>
            <Text as="strong" size="label" weight="semibold" truncate>
              {theme.name}
            </Text>
            <span className={styles.themeRole} data-role={role}>
              {role === "day" ? <Sun size={11} /> : <MoonStar size={11} />}
              {t(role === "day" ? "dayTheme" : "nightTheme")}
            </span>
          </span>
          <Text
            as="small"
            tone="muted"
            size="micro"
            className={styles.themeTagline}
            truncate
          >
            {theme.personality?.tagline ??
              (theme.builtIn
                ? t("builtInReadOnly")
                : t("themeAssetCount", { count: theme.assetCount }))}
          </Text>
        </span>
        <span className={styles.themeState}>
          {theme.id === appliedId && <Check size={14} />}
        </span>
      </Control>
    );
  };

  if (!draft) return null;
  return (
    <Surface
      appearance="surface"
      elevation="control"
      shape="surface"
      className={styles.studio}
    >
      <Surface
        as="aside"
        appearance="sidebar"
        shape="none"
        className={styles.library}
      >
        <header className={styles.libraryHeading}>
          <Text as="h2" font="heading" size="body" weight="semibold">
            {t("themeLibraryLabel")}
          </Text>
          <Text as="p" tone="muted" size="micro">
            {t("threeThemePairsHint")}
          </Text>
        </header>
        <div className={styles.libraryScroll}>
          <Control
            recipe="row"
            selected={library.data.followSystem}
            className={styles.systemTheme}
            onClick={() =>
              select.mutate({ themeId: selectedId, followSystem: true })
            }
          >
            <span className={styles.systemIcon}>
              <Monitor size={15} />
            </span>
            <span>
              <Text as="strong" size="label" weight="semibold">
                {t("systemTheme")}
              </Text>
              <Text as="small" tone="muted" size="micro">
                {t("autoLightDark")}
              </Text>
            </span>
            {library.data.followSystem && <Check size={14} />}
          </Control>
          <Surface
            as="section"
            appearance="muted"
            elevation="content"
            shape="control"
            className={styles.systemPair}
          >
            <header>
              <Text
                as="strong"
                tone="secondary"
                size="caption"
                weight="semibold"
              >
                {t("systemThemePair")}
              </Text>
              <Text as="small" tone="muted" size="micro">
                {t("systemThemePairHint")}
              </Text>
            </header>
            <label>
              <Text as="span" tone="muted" size="micro">
                <Sun size={12} />
                {t("dayTheme")}
              </Text>
              <ThemedSelect
                ariaLabel={t("dayTheme")}
                disabled={configureSystem.isPending}
                value={library.data.systemLightThemeId}
                options={themeOptions(library.data, "light")}
                onValueChange={(value) =>
                  configureSystem.mutate({
                    light: value,
                    dark: library.data.systemDarkThemeId,
                  })
                }
              />
            </label>
            <label>
              <Text as="span" tone="muted" size="micro">
                <MoonStar size={12} />
                {t("nightTheme")}
              </Text>
              <ThemedSelect
                ariaLabel={t("nightTheme")}
                disabled={configureSystem.isPending}
                value={library.data.systemDarkThemeId}
                options={themeOptions(library.data, "dark")}
                onValueChange={(value) =>
                  configureSystem.mutate({
                    light: library.data.systemLightThemeId,
                    dark: value,
                  })
                }
              />
            </label>
          </Surface>
          <div className={styles.themeCollections}>
            {pairs.map((pair, index) => {
              const day = pair.themes.find(
                (theme) => theme.personality?.role === "day",
              );
              const night = pair.themes.find(
                (theme) => theme.personality?.role === "night",
              );
              const pairSelected = Boolean(
                day &&
                  night &&
                  library.data.systemLightThemeId === day.id &&
                  library.data.systemDarkThemeId === night.id,
              );
              return (
                <section
                  className={styles.pairGroup}
                  data-recipe={pair.recipe}
                  key={pair.id}
                >
                  <header className={styles.pairHeader}>
                    <div className={styles.pairIdentity}>
                      <span className={styles.pairNumber}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <Text as="strong" size="caption" weight="semibold">
                          {pair.name}
                        </Text>
                        <Text as="small" tone="muted" size="micro">
                          {t(`themeRecipe_${pair.recipe}`)}
                        </Text>
                      </span>
                    </div>
                    {day && night && (
                      <Control
                        recipe="icon"
                        density="detail"
                        selected={pairSelected && library.data.followSystem}
                        disabled={configureSystem.isPending}
                        aria-label={t("useThemePair", { name: pair.name })}
                        title={t("useThemePair", { name: pair.name })}
                        onClick={() =>
                          configureSystem.mutate({
                            light: day.id,
                            dark: night.id,
                            activate: true,
                          })
                        }
                      >
                        <Link2 size={12} />
                      </Control>
                    )}
                  </header>
                  <div className={styles.pairThemes}>
                    {day && renderThemeCard(day)}
                    {night && renderThemeCard(night)}
                  </div>
                </section>
              );
            })}
            {standaloneThemes.length > 0 && (
              <section className={styles.pairGroup} data-recipe="custom">
                <header className={styles.pairHeader}>
                  <div className={styles.pairIdentity}>
                    <span className={styles.pairNumber}>＋</span>
                    <span>
                      <Text as="strong" size="caption" weight="semibold">
                        {t("customThemes")}
                      </Text>
                      <Text as="small" tone="muted" size="micro">
                        {t("customThemesHint")}
                      </Text>
                    </span>
                  </div>
                </header>
                <div className={styles.pairThemes}>
                  {standaloneThemes.map(renderThemeCard)}
                </div>
              </section>
            )}
          </div>
        </div>
      </Surface>
      <section className={styles.editor}>
        <header>
          <div>
            <Text as="h2" font="heading" size="body" weight="semibold">
              {draft.name}
            </Text>
            <Text as="p" tone="muted" size="caption">
              {draft.id} · {draft.appearance}
              {activeEntry?.warnings.length
                ? ` · ${t("themeWarningCount", { count: activeEntry.warnings.length })}`
                : ""}
            </Text>
          </div>
          <div className={styles.actions}>
            <Control recipe="quiet" density="compact" onClick={copyTheme}>
              <Copy size={13} />
              {t("copy")}
            </Control>
            <Control asChild recipe="quiet" density="compact">
              <label>
                <Upload size={13} />
                {t("import")}
                <Input
                  type="file"
                  accept=".json,.grok-theme.json,.grok-theme-bundle.json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void importFile(file);
                  }}
                />
              </label>
            </Control>
            <Control asChild recipe="quiet" density="compact">
              <label>
                <ImagePlus size={13} />
                {t("assets")}
                <Input
                  type="file"
                  accept=".otf,.ttf,.woff2,.png,.jpg,.jpeg,.webp,.avif"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void importAsset(file);
                  }}
                />
              </label>
            </Control>
            <Control
              recipe="quiet"
              density="compact"
              onClick={() => void exportTheme()}
            >
              <Download size={13} />
              {t("export")}
            </Control>
            <Control
              recipe="icon"
              density="compact"
              aria-label={t("openProject")}
              onClick={() => void window.grokDesktop?.openThemesDirectory()}
            >
              <FolderOpen size={13} />
            </Control>
            {!activeEntry?.builtIn && (
              <>
                <Control
                  recipe="icon"
                  density="compact"
                  aria-label={t("rename")}
                  onClick={renameTheme}
                >
                  <Pencil size={13} />
                </Control>
                <Control
                  recipe="icon"
                  density="compact"
                  tone="danger"
                  aria-label={t("delete")}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 size={13} />
                </Control>
              </>
            )}
          </div>
        </header>
        <TabsRoot defaultValue="form" className={styles.tabs}>
          <TabsList>
            <TabsTrigger value="form">
              <Paintbrush size={13} />
              {t("form")}
            </TabsTrigger>
            <TabsTrigger value="json">
              <FileJson size={13} />
              JSON
            </TabsTrigger>
          </TabsList>
          <TabsContent value="form" className={styles.form}>
            <Field label="Name">
              <Input
                appearance="surface"
                value={draft.name}
                onChange={(event) =>
                  update(setDraft, draft, ["name"], event.target.value)
                }
              />
            </Field>
            <Field label="Theme ID">
              <Input
                appearance="surface"
                value={draft.id}
                disabled={Boolean(activeEntry)}
                onChange={(event) =>
                  update(setDraft, draft, ["id"], event.target.value)
                }
              />
            </Field>
            <div className={styles.colorGrid}>
              {Object.entries(draft.colors).map(([key, value]) => (
                <Field key={key} label={key}>
                  <div className={styles.colorInput}>
                    {/^#[0-9a-f]{6}$/i.test(value) && (
                      <Input
                        type="color"
                        value={value}
                        onChange={(event) =>
                          update(
                            setDraft,
                            draft,
                            ["colors", key],
                            event.target.value,
                          )
                        }
                      />
                    )}
                    <Input
                      appearance="surface"
                      value={value}
                      onChange={(event) =>
                        update(
                          setDraft,
                          draft,
                          ["colors", key],
                          event.target.value,
                        )
                      }
                    />
                  </div>
                </Field>
              ))}
            </div>
            <Text as="h3" tone="muted" size="label" weight="semibold">
              {t("typographyRoles")}
            </Text>
            <div className={styles.typeGrid}>
              {Object.entries(draft.typography).map(([role, value]) => (
                <Field key={role} label={role}>
                  <Input
                    appearance="surface"
                    value={value.family}
                    onChange={(event) =>
                      update(
                        setDraft,
                        draft,
                        ["typography", role, "family"],
                        event.target.value,
                      )
                    }
                  />
                  <ThemedSelect
                    ariaLabel={`${role} font asset`}
                    value={value.assetId || ""}
                    options={[
                      { value: "", label: t("localFontFamily") },
                      ...draft.assets
                        .filter((asset) => asset.kind === "font")
                        .map((asset) => ({
                          value: asset.id,
                          label: asset.fileName,
                        })),
                    ]}
                    onValueChange={(next) =>
                      updateOptional(
                        setDraft,
                        draft,
                        ["typography", role, "assetId"],
                        next,
                      )
                    }
                  />
                  <div className={styles.numericRow}>
                    <NumberInput
                      label="Weight"
                      value={value.weight}
                      min={100}
                      max={900}
                      step={100}
                      onChange={(next) =>
                        update(
                          setDraft,
                          draft,
                          ["typography", role, "weight"],
                          next,
                        )
                      }
                    />
                  </div>
                  <Input
                    appearance="surface"
                    value={value.color}
                    onChange={(event) =>
                      update(
                        setDraft,
                        draft,
                        ["typography", role, "color"],
                        event.target.value,
                      )
                    }
                  />
                </Field>
              ))}
            </div>
            <Text as="p" tone="muted" size="caption" className={styles.advancedHint}>
              {t("themeAdvancedJsonHint")}
            </Text>
            <Text as="h3" tone="muted" size="label" weight="semibold">
              {t("syntaxAnsiDiff")}
            </Text>
            <div className={styles.colorGrid}>
              {Object.entries(draft.syntax).map(([key, value]) => (
                <Field key={`syntax-${key}`} label={`syntax.${key}`}>
                  <Input
                    appearance="surface"
                    value={value}
                    onChange={(event) =>
                      update(
                        setDraft,
                        draft,
                        ["syntax", key],
                        event.target.value,
                      )
                    }
                  />
                </Field>
              ))}
              {Object.entries(draft.ansi).map(([key, value]) => (
                <Field key={`ansi-${key}`} label={`ansi.${key}`}>
                  <Input
                    appearance="surface"
                    value={value}
                    onChange={(event) =>
                      update(setDraft, draft, ["ansi", key], event.target.value)
                    }
                  />
                </Field>
              ))}
              {Object.entries(draft.diff).map(([key, value]) => (
                <Field key={`diff-${key}`} label={`diff.${key}`}>
                  <Input
                    appearance="surface"
                    value={value}
                    onChange={(event) =>
                      update(setDraft, draft, ["diff", key], event.target.value)
                    }
                  />
                </Field>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="json" className={styles.json}>
            <TextArea
              appearance="surface"
              spellCheck={false}
              value={json}
              onChange={(event) => setJson(event.target.value)}
            />
            <Control
              recipe="solid"
              className={styles.validate}
              onClick={parseJson}
            >
              {t("validatePreview")}
            </Control>
          </TabsContent>
        </TabsRoot>
        <footer>
          <Text as="span" tone="muted" size="caption">
            {message || t("themePreviewHint")}
          </Text>
          <div className={styles.footerActions}>
            {previewChanged && (
              <Control
                recipe="quiet"
                onClick={() => {
                  if (!baseline) return;
                  replaceDraft(structuredClone(baseline));
                  setMessage(t("themePreviewReverted"));
                }}
              >
                <RotateCcw size={13} />
                {t("revertThemePreview")}
              </Control>
            )}
            <Control
              recipe="solid"
              onClick={() => void saveWithDiff()}
              disabled={activeEntry?.builtIn || save.isPending}
            >
              <Save size={13} />
              {t("saveTheme")}
            </Control>
          </div>
        </footer>
      </section>
      {diff && (
        <SemanticMutationDialog
          open
          title={t("overwriteTheme")}
          target={diff.manifest.id}
          changes={diff.changes
            .slice(0, 100)
            .map((change) => ({
              field: change.path,
              before: JSON.stringify(change.before),
              after: JSON.stringify(change.after),
            }))}
          warnings={
            diff.changes.length > 100
              ? [t("hiddenThemeDiffs", { count: diff.changes.length - 100 })]
              : []
          }
          pending={save.isPending}
          onOpenChange={(open) => {
            if (!open) setDiff(null);
          }}
          onApply={() => {
            const reviewed = diff.manifest;
            setDiff(null);
            save.mutate(reviewed);
          }}
        />
      )}
      {pendingBundle && (
        <SemanticMutationDialog
          open
          title={t("overwriteTheme")}
          target={pendingBundle.bundle.manifest.id}
          changes={pendingBundle.changes
            .slice(0, 100)
            .map((change) => ({
              field: change.path,
              before: JSON.stringify(change.before),
              after: JSON.stringify(change.after),
            }))}
          warnings={[
            t("themeOverwriteConfirm", { count: pendingBundle.changes.length }),
          ]}
          onOpenChange={(open) => {
            if (!open) setPendingBundle(null);
          }}
          onApply={() => void applyBundle(pendingBundle.bundle, true)}
        />
      )}
      {renameDraft && (
        <FormDialog
          open
          title={t("rename")}
          fields={[
            {
              id: "nextName",
              label: t("themeNamePrompt"),
              value: renameDraft.nextName,
            },
            { id: "nextId", label: "Theme ID", value: renameDraft.nextId },
          ]}
          pending={rename.isPending}
          onOpenChange={(open) => {
            if (!open) setRenameDraft(null);
          }}
          onFieldChange={(id, value) =>
            setRenameDraft((current) =>
              current ? { ...current, [id]: value } : current,
            )
          }
          onApply={() => {
            rename.mutate({ themeId: draft.id, ...renameDraft });
            setRenameDraft(null);
          }}
        />
      )}
      {deleteOpen && (
        <SemanticMutationDialog
          open
          title={t("deleteTheme")}
          target={draft.name}
          changes={[
            {
              field: t("themeLibraryLabel"),
              before: draft.name,
              after: t("neutralFallback"),
            },
          ]}
          warnings={[t("deleteThemeWarning")]}
          destructive
          pending={remove.isPending}
          onOpenChange={setDeleteOpen}
          onApply={() =>
            remove.mutate(draft.id, { onSuccess: () => setDeleteOpen(false) })
          }
        />
      )}
    </Surface>
  );
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function themeOptions(
  library: ThemeLibrarySnapshot,
  appearance: ThemeLibraryEntry["appearance"],
): Array<{ value: string; label: string }> {
  return library.themes
    .filter((theme) => theme.appearance === appearance)
    .map((theme) => ({ value: theme.id, label: theme.name }));
}

interface ThemePairGroup {
  id: string;
  name: string;
  recipe: NonNullable<ThemeLibraryEntry["personality"]>["recipe"];
  themes: ThemeLibraryEntry[];
}

function themePairs(library: ThemeLibrarySnapshot): ThemePairGroup[] {
  const groups = new Map<string, ThemePairGroup>();
  for (const theme of library.themes) {
    if (!theme.builtIn || !theme.personality) continue;
    const current = groups.get(theme.personality.pairId);
    if (current) current.themes.push(theme);
    else
      groups.set(theme.personality.pairId, {
        id: theme.personality.pairId,
        name: theme.personality.pairName,
        recipe: theme.personality.recipe,
        themes: [theme],
      });
  }
  const order = { editorial: 0, precision: 1, gilded: 2 } as const;
  return [...groups.values()].sort(
    (left, right) => order[left.recipe] - order[right.recipe],
  );
}

function update(
  setter: React.Dispatch<React.SetStateAction<ThemeManifestV1 | null>>,
  theme: ThemeManifestV1,
  path: string[],
  value: unknown,
): void {
  const copy = structuredClone(theme) as unknown as Record<string, unknown>;
  let target = copy;
  for (const key of path.slice(0, -1))
    target = target[key] as Record<string, unknown>;
  target[path.at(-1)!] = value;
  setter(copy as unknown as ThemeManifestV1);
}

function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => setText(String(value)), [value]);

  const normalize = (raw: string): number | null => {
    if (!raw.trim()) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed));
  };

  return (
    <Field className={styles.numberInput} label={label}>
      <Input
        appearance="surface"
        density="compact"
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          const nextValue = normalize(nextText);
          if (nextValue !== null) onChange(nextValue);
        }}
        onBlur={() => {
          const nextValue = normalize(text);
          if (nextValue === null) setText(String(value));
          else {
            setText(String(nextValue));
            if (nextValue !== value) onChange(nextValue);
          }
        }}
      />
    </Field>
  );
}

function updateOptional(
  setter: React.Dispatch<React.SetStateAction<ThemeManifestV1 | null>>,
  theme: ThemeManifestV1,
  path: string[],
  value: string,
): void {
  const copy = structuredClone(theme) as unknown as Record<string, unknown>;
  let target = copy;
  for (const key of path.slice(0, -1))
    target = target[key] as Record<string, unknown>;
  if (value) target[path.at(-1)!] = value;
  else delete target[path.at(-1)!];
  setter(copy as unknown as ThemeManifestV1);
}

function downloadJson(value: unknown, fileName: string): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function fileBase64(file: File, tooLargeMessage: string): Promise<string> {
  if (file.size > 12_000_000) return Promise.reject(new Error(tooLargeMessage));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.readAsDataURL(file);
  });
}
