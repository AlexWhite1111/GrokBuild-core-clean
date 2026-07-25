import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ThemeManifestV1Schema,
  ThemeBundleV1Schema,
  type ThemeAssetReference,
  type ThemeBundleV1,
  type ThemeLibrarySnapshot,
  type ThemeManifestV1,
} from "../../shared/contracts.js";
import { normalizeThemeGeometry } from "../../shared/themeGeometry.js";
import { AppProblem } from "../security/problemResponse.js";
import type { JsonStateStore } from "../storage/JsonStateStore.js";
import { BUILT_IN_THEMES } from "./builtInThemes.js";
import { collectThemeWarnings } from "./themeWarnings.js";

interface ThemePreferences {
  selectedThemeId: string;
  systemLightThemeId: string;
  systemDarkThemeId: string;
  followSystem: boolean;
}

const DEFAULT_PREFERENCES: ThemePreferences = {
  selectedThemeId: "grok-ink-dark",
  systemLightThemeId: "grok-linen-light",
  systemDarkThemeId: "grok-ink-dark",
  followSystem: true,
};
const THEME_PREFERENCE_KEYS = new Set<keyof ThemePreferences>([
  "selectedThemeId",
  "systemLightThemeId",
  "systemDarkThemeId",
  "followSystem",
]);

export class ThemeRepository {
  constructor(
    private readonly state: JsonStateStore,
    private readonly themesHome: string,
    private readonly assetsHome: string,
  ) {
    fs.mkdirSync(themesHome, { recursive: true, mode: 0o700 });
    fs.mkdirSync(assetsHome, { recursive: true, mode: 0o700 });
  }

  library(): ThemeLibrarySnapshot {
    const custom = this.#customThemes();
    const manifests = [...BUILT_IN_THEMES, ...custom];
    const storedPreferences = this.#preferences();
    const preferences = this.#normalizePreferences(storedPreferences, manifests);
    if (!samePreferences(storedPreferences, preferences)) {
      this.#savePreferences(preferences);
    }
    const { selectedThemeId } = preferences;
    return {
      ...preferences,
      themes: manifests.map((theme) => ({
        id: theme.id,
        name: theme.name,
        appearance: theme.appearance,
        builtIn: BUILT_IN_THEMES.some((item) => item.id === theme.id),
        selected: theme.id === selectedThemeId,
        fileName: BUILT_IN_THEMES.some((item) => item.id === theme.id)
          ? null
          : `${theme.id}.grok-theme.json`,
        assetCount: theme.assets.length,
        warnings: collectThemeWarnings(theme),
        personality: theme.personality ?? null,
        swatch: {
          canvas: theme.colors.canvas,
          sidebar: theme.colors.sidebar,
          surface: theme.colors.surface,
          surfaceRaised: theme.colors.surfaceRaised,
          border: theme.colors.borderStrong,
          accent: theme.colors.accent,
          text: theme.colors.text,
        },
      })),
    };
  }

  get(themeId: string): ThemeManifestV1 {
    const builtIn = BUILT_IN_THEMES.find((theme) => theme.id === themeId);
    if (builtIn) {
      return normalizeThemeGeometry(
        ThemeManifestV1Schema.parse(structuredClone(builtIn)),
      );
    }
    return this.#readManifest(this.#themePath(themeId));
  }

  save(
    input: unknown,
    overwrite: boolean,
  ): { theme: ThemeManifestV1; warnings: string[] } {
    const parsed = ThemeManifestV1Schema.safeParse(input);
    if (!parsed.success) {
      throw new AppProblem(
        400,
        "VALIDATION_FAILED",
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      );
    }
    const theme = normalizeThemeGeometry(parsed.data);
    if (BUILT_IN_THEMES.some((item) => item.id === theme.id)) {
      throw new AppProblem(
        409,
        "POLICY_LOCKED",
        "Built-in themes are read-only; copy the theme first.",
      );
    }
    this.#validateAssetReferences(theme);
    const destination = this.#themePath(theme.id);
    const exists = fs.existsSync(destination);
    if (exists && !overwrite) {
      throw new AppProblem(
        409,
        "IDEMPOTENCY_CONFLICT",
        "A theme with this ID already exists.",
      );
    }
    let previous: ThemeManifestV1 | null = null;
    if (exists && overwrite) {
      try {
        previous = this.#readManifest(destination);
      } catch {
        // Overwrite is also the repair path for a malformed custom manifest.
      }
    }
    this.#atomicJsonWrite(destination, theme);
    if (previous) {
      const retained = new Set(theme.assets.map((asset) => asset.id));
      this.#removeOrphanedAssets(
        previous.assets.filter((asset) => !retained.has(asset.id)),
      );
    }
    return { theme, warnings: collectThemeWarnings(theme) };
  }

  select(themeId: string, followSystem?: boolean): ThemeLibrarySnapshot {
    this.get(themeId);
    const preferences = this.#preferences();
    const next: ThemePreferences = {
      ...preferences,
      selectedThemeId: themeId,
      ...(typeof followSystem === "boolean" ? { followSystem } : {}),
    };
    this.#savePreferences(next);
    return this.library();
  }

  configureSystem(
    lightThemeId: string,
    darkThemeId: string,
  ): ThemeLibrarySnapshot {
    const lightTheme = this.get(lightThemeId);
    const darkTheme = this.get(darkThemeId);
    if (lightTheme.appearance !== "light") {
      throw new AppProblem(
        400,
        "VALIDATION_FAILED",
        "The system day theme must use the light appearance.",
      );
    }
    if (darkTheme.appearance !== "dark") {
      throw new AppProblem(
        400,
        "VALIDATION_FAILED",
        "The system night theme must use the dark appearance.",
      );
    }
    this.#savePreferences({
      ...this.#preferences(),
      systemLightThemeId: lightThemeId,
      systemDarkThemeId: darkThemeId,
    });
    return this.library();
  }

  rename(
    themeId: string,
    nextId: string,
    nextName: string,
  ): ThemeLibrarySnapshot {
    if (BUILT_IN_THEMES.some((theme) => theme.id === themeId))
      throw new AppProblem(
        409,
        "POLICY_LOCKED",
        "Built-in themes are read-only; copy the theme first.",
      );
    const source = this.get(themeId);
    const renamed = ThemeManifestV1Schema.parse({
      ...source,
      id: nextId,
      name: nextName,
    });
    if (nextId === themeId) {
      this.save(renamed, true);
      return this.library();
    }
    this.save(renamed, false);
    const preferences = this.#preferences();
    this.#savePreferences({
      ...preferences,
      selectedThemeId:
        preferences.selectedThemeId === themeId
          ? nextId
          : preferences.selectedThemeId,
      systemLightThemeId:
        preferences.systemLightThemeId === themeId
          ? nextId
          : preferences.systemLightThemeId,
      systemDarkThemeId:
        preferences.systemDarkThemeId === themeId
          ? nextId
          : preferences.systemDarkThemeId,
    });
    fs.rmSync(this.#themePath(themeId), { force: true });
    return this.library();
  }

  duplicate(
    themeId: string,
    nextId: string,
    nextName: string,
  ): ThemeManifestV1 {
    const source = this.get(themeId);
    const copy = ThemeManifestV1Schema.parse({
      ...source,
      id: nextId,
      name: nextName,
      assets: [...source.assets],
    });
    return this.save(copy, false).theme;
  }

  delete(themeId: string): ThemeLibrarySnapshot {
    if (BUILT_IN_THEMES.some((theme) => theme.id === themeId)) {
      throw new AppProblem(
        409,
        "POLICY_LOCKED",
        "Built-in themes cannot be deleted.",
      );
    }
    const deleted = this.get(themeId);
    fs.rmSync(this.#themePath(themeId), { force: true });
    const preferences = this.#preferences();
    this.#savePreferences({
      ...preferences,
      selectedThemeId:
        preferences.selectedThemeId === themeId
          ? DEFAULT_PREFERENCES.selectedThemeId
          : preferences.selectedThemeId,
      systemLightThemeId:
        preferences.systemLightThemeId === themeId
          ? DEFAULT_PREFERENCES.systemLightThemeId
          : preferences.systemLightThemeId,
      systemDarkThemeId:
        preferences.systemDarkThemeId === themeId
          ? DEFAULT_PREFERENCES.systemDarkThemeId
          : preferences.systemDarkThemeId,
    });
    this.#removeOrphanedAssets(deleted.assets);
    return this.library();
  }

  tokenDiff(
    existingId: string,
    proposed: unknown,
  ): Array<{ path: string; before: unknown; after: unknown }> {
    const before = this.get(existingId) as unknown as Record<string, unknown>;
    const after = normalizeThemeGeometry(
      ThemeManifestV1Schema.parse(proposed),
    ) as unknown as Record<string, unknown>;
    return diffRecords(before, after);
  }

  importAsset(
    kind: ThemeAssetReference["kind"],
    fileName: string,
    dataBase64: string,
  ): ThemeAssetReference {
    return this.#storeAsset(kind, fileName, dataBase64).reference;
  }

  discardAsset(assetId: string): { discarded: boolean } {
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(assetId)) {
      throw new AppProblem(400, "PATH_REJECTED", "Invalid theme asset ID.");
    }
    if (this.#assetReferenced(assetId)) return { discarded: false };
    const files = this.#assetFiles(assetId);
    for (const file of files) fs.rmSync(file, { force: true });
    return { discarded: files.length > 0 };
  }

  bundle(themeId: string): ThemeBundleV1 {
    return this.bundleManifest(this.get(themeId));
  }

  bundleManifest(input: unknown): ThemeBundleV1 {
    const manifest = normalizeThemeGeometry(ThemeManifestV1Schema.parse(input));
    this.#validateAssetReferences(manifest);
    const assets = manifest.assets.map((reference) => ({
      reference,
      dataBase64: fs
        .readFileSync(this.assetPath(reference.id))
        .toString("base64"),
    }));
    const body = { manifest, assets };
    return {
      $schema: "grok-build://schemas/theme-bundle-v1.json",
      ...body,
      sha256: bundleBodyHash(body),
    };
  }

  importBundle(
    input: unknown,
    overwrite: boolean,
  ): { theme: ThemeManifestV1; warnings: string[] } {
    const bundle = ThemeBundleV1Schema.parse(input);
    const body = { manifest: bundle.manifest, assets: bundle.assets };
    const expected = bundleBodyHash(body);
    const acceptedLegacyHashes = new Set([
      createHash("sha256").update(JSON.stringify(body)).digest("hex"),
      rawBundleBodyHash(input),
    ]);
    if (
      expected !== bundle.sha256.toLowerCase() &&
      !acceptedLegacyHashes.has(bundle.sha256.toLowerCase())
    ) {
      throw new AppProblem(
        400,
        "VALIDATION_FAILED",
        "Theme bundle hash mismatch.",
      );
    }
    validateBundleAssetIndex(bundle);
    const written: Array<{ id: string; file: string }> = [];
    try {
      for (const asset of bundle.assets) {
        const stored = this.#storeAsset(
          asset.reference.kind,
          asset.reference.fileName,
          asset.dataBase64,
        );
        if (
          stored.reference.id !== asset.reference.id ||
          stored.reference.sha256 !== asset.reference.sha256.toLowerCase()
        ) {
          throw new AppProblem(
            400,
            "VALIDATION_FAILED",
            `Theme bundle asset mismatch: ${asset.reference.id}`,
          );
        }
        if (stored.created) {
          written.push({ id: stored.reference.id, file: stored.file });
        }
      }
      return this.save(bundle.manifest, overwrite);
    } catch (error) {
      for (const asset of written) {
        if (!this.#assetReferenced(asset.id)) {
          fs.rmSync(asset.file, { force: true });
        }
      }
      throw error;
    }
  }

  assetPath(assetId: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(assetId)) {
      throw new AppProblem(400, "PATH_REJECTED", "Invalid theme asset ID.");
    }
    const matches = this.#assetFiles(assetId);
    if (!matches.length) {
      throw new AppProblem(404, "NOT_FOUND", "Theme asset not found.");
    }
    if (matches.length === 1) return matches[0];

    const byDigest = new Map<string, string[]>();
    for (const file of matches) {
      const digest = createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex");
      byDigest.set(digest, [...(byDigest.get(digest) ?? []), file]);
    }
    if (byDigest.size !== 1) {
      throw new AppProblem(
        409,
        "IDEMPOTENCY_CONFLICT",
        `Multiple different files use theme asset ID ${assetId}.`,
      );
    }
    const [keep, ...duplicates] = [...matches].sort();
    for (const duplicate of duplicates) fs.rmSync(duplicate, { force: true });
    return keep;
  }

  #customThemes(): ThemeManifestV1[] {
    return fs
      .readdirSync(this.themesHome)
      .filter((file) => file.endsWith(".grok-theme.json"))
      .flatMap((file) => {
        try {
          return [this.#readManifest(path.join(this.themesHome, file))];
        } catch {
          return [];
        }
      });
  }

  #readManifest(file: string): ThemeManifestV1 {
    try {
      const theme = normalizeThemeGeometry(
        ThemeManifestV1Schema.parse(JSON.parse(fs.readFileSync(file, "utf8"))),
      );
      this.#validateAssetReferences(theme);
      return theme;
    } catch (error) {
      if (!fs.existsSync(file))
        throw new AppProblem(404, "NOT_FOUND", "Theme not found.");
      throw new AppProblem(
        400,
        "VALIDATION_FAILED",
        error instanceof Error ? error.message : "Invalid theme manifest.",
      );
    }
  }

  #themePath(themeId: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{1,95}$/i.test(themeId)) {
      throw new AppProblem(400, "PATH_REJECTED", "Invalid theme ID.");
    }
    return path.join(this.themesHome, `${themeId}.grok-theme.json`);
  }

  #validateAssetReferences(theme: ThemeManifestV1): void {
    const assets = new Map<string, ThemeAssetReference>();
    for (const asset of theme.assets) {
      if (assets.has(asset.id)) {
        throw new AppProblem(
          400,
          "VALIDATION_FAILED",
          `Theme asset ID is duplicated: ${asset.id}`,
        );
      }
      const candidate = this.assetPath(asset.id);
      const bytes = fs.readFileSync(candidate);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== asset.sha256.toLowerCase()) {
        throw new AppProblem(
          400,
          "VALIDATION_FAILED",
          `Theme asset hash mismatch: ${asset.id}`,
        );
      }
      validateAssetBytes(asset.kind, path.extname(candidate).toLowerCase(), bytes);
      assets.set(asset.id, asset);
    }

    for (const [role, typography] of Object.entries(theme.typography)) {
      if (!typography.assetId) continue;
      const asset = assets.get(typography.assetId);
      if (!asset || asset.kind !== "font") {
        throw new AppProblem(
          400,
          "VALIDATION_FAILED",
          `Typography role ${role} must reference a declared font asset.`,
        );
      }
    }
    for (const layer of theme.backgrounds) {
      if (layer.type !== "asset") continue;
      const asset = assets.get(layer.assetId);
      if (!asset || asset.kind === "font") {
        throw new AppProblem(
          400,
          "VALIDATION_FAILED",
          `Background layer must reference a declared image or texture asset: ${layer.assetId}`,
        );
      }
    }
  }

  #storeAsset(
    kind: ThemeAssetReference["kind"],
    fileName: string,
    dataBase64: string,
  ): { reference: ThemeAssetReference; file: string; created: boolean } {
    const bytes = decodeBase64(dataBase64);
    const extension = path.extname(fileName).toLowerCase();
    validateAssetBytes(kind, extension, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const id = `asset-${sha256.slice(0, 24)}`;
    const reference = { id, kind, fileName, sha256 } satisfies ThemeAssetReference;
    const matches = this.#assetFiles(id);
    if (matches.length) {
      const file = this.assetPath(id);
      const existingDigest = createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex");
      if (existingDigest !== sha256) {
        throw new AppProblem(
          409,
          "IDEMPOTENCY_CONFLICT",
          `Theme asset ID collision: ${id}`,
        );
      }
      return { reference, file, created: false };
    }
    const file = path.join(this.assetsHome, `${id}${extension}`);
    this.#atomicWrite(file, bytes);
    return { reference, file, created: true };
  }

  #assetFiles(assetId: string): string[] {
    return fs
      .readdirSync(this.assetsHome)
      .filter((entry) => entry.startsWith(`${assetId}.`))
      .map((entry) => path.join(this.assetsHome, entry));
  }

  #assetReferenced(assetId: string): boolean {
    if (
      BUILT_IN_THEMES.some((theme) =>
        theme.assets.some((asset) => asset.id === assetId),
      )
    ) {
      return true;
    }
    for (const entry of fs
      .readdirSync(this.themesHome)
      .filter((file) => file.endsWith(".grok-theme.json"))) {
      try {
        const raw = JSON.parse(
          fs.readFileSync(path.join(this.themesHome, entry), "utf8"),
        ) as unknown;
        if (rawManifestReferencesAsset(raw, assetId)) return true;
      } catch {
        // An unreadable manifest may still own an asset. Prefer a small leak
        // over deleting user data that cannot currently prove its reference.
        return true;
      }
    }
    return false;
  }

  #removeOrphanedAssets(assets: ThemeAssetReference[]): void {
    for (const assetId of new Set(assets.map((asset) => asset.id))) {
      if (this.#assetReferenced(assetId)) continue;
      for (const file of this.#assetFiles(assetId)) {
        try {
          fs.rmSync(file, { force: true });
        } catch {
          // Asset cleanup is maintenance; a successful manifest write remains successful.
        }
      }
    }
  }

  #preferences(): ThemePreferences {
    const stored = this.state.get<Partial<ThemePreferences>>("theme.preferences");
    if (!stored) {
      const defaults = { ...DEFAULT_PREFERENCES };
      this.#savePreferences(defaults);
      return defaults;
    }
    try {
      const value = stored;
      const preferences: ThemePreferences = {
        selectedThemeId:
          typeof value.selectedThemeId === "string"
            ? value.selectedThemeId
            : DEFAULT_PREFERENCES.selectedThemeId,
        systemLightThemeId:
          typeof value.systemLightThemeId === "string"
            ? value.systemLightThemeId
            : DEFAULT_PREFERENCES.systemLightThemeId,
        systemDarkThemeId:
          typeof value.systemDarkThemeId === "string"
            ? value.systemDarkThemeId
            : DEFAULT_PREFERENCES.systemDarkThemeId,
        followSystem:
          typeof value.followSystem === "boolean"
            ? value.followSystem
            : DEFAULT_PREFERENCES.followSystem,
      };
      if (
        Object.keys(value).some(
          (key) => !THEME_PREFERENCE_KEYS.has(key as keyof ThemePreferences),
        ) ||
        !samePreferences(value, preferences)
      ) {
        this.#savePreferences(preferences);
      }
      return preferences;
    } catch {
      const defaults = { ...DEFAULT_PREFERENCES };
      this.#savePreferences(defaults);
      return defaults;
    }
  }

  #normalizePreferences(
    preferences: ThemePreferences,
    manifests: ThemeManifestV1[],
  ): ThemePreferences {
    const byId = new Map(manifests.map((theme) => [theme.id, theme]));
    const selected = byId.get(preferences.selectedThemeId);
    const light = byId.get(preferences.systemLightThemeId);
    const dark = byId.get(preferences.systemDarkThemeId);
    return {
      ...preferences,
      selectedThemeId: selected?.id ?? DEFAULT_PREFERENCES.selectedThemeId,
      systemLightThemeId:
        light?.appearance === "light"
          ? light.id
          : DEFAULT_PREFERENCES.systemLightThemeId,
      systemDarkThemeId:
        dark?.appearance === "dark"
          ? dark.id
          : DEFAULT_PREFERENCES.systemDarkThemeId,
    };
  }

  #savePreferences(preferences: ThemePreferences): void {
    this.state.set("theme.preferences", preferences);
  }

  #atomicJsonWrite(destination: string, value: unknown): void {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      fs.renameSync(temporary, destination);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  #atomicWrite(destination: string, value: Buffer): void {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, value, { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, destination);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
}

function rawManifestReferencesAsset(raw: unknown, assetId: string): boolean {
  if (!raw || typeof raw !== "object") return false;
  const manifest = raw as {
    assets?: unknown;
    typography?: unknown;
    backgrounds?: unknown;
  };
  if (
    Array.isArray(manifest.assets) &&
    manifest.assets.some(
      (asset) =>
        Boolean(asset) &&
        typeof asset === "object" &&
        (asset as { id?: unknown }).id === assetId,
    )
  ) {
    return true;
  }
  if (manifest.typography && typeof manifest.typography === "object") {
    for (const role of Object.values(manifest.typography)) {
      if (
        role &&
        typeof role === "object" &&
        (role as { assetId?: unknown }).assetId === assetId
      ) {
        return true;
      }
    }
  }
  return (
    Array.isArray(manifest.backgrounds) &&
    manifest.backgrounds.some(
      (layer) =>
        Boolean(layer) &&
        typeof layer === "object" &&
        (layer as { assetId?: unknown }).assetId === assetId,
    )
  );
}

function samePreferences(
  left: Partial<ThemePreferences>,
  right: ThemePreferences,
): boolean {
  return (
    left.selectedThemeId === right.selectedThemeId &&
    left.systemLightThemeId === right.systemLightThemeId &&
    left.systemDarkThemeId === right.systemDarkThemeId &&
    left.followSystem === right.followSystem
  );
}

function validateBundleAssetIndex(bundle: ThemeBundleV1): void {
  const manifestIds = new Set(bundle.manifest.assets.map((asset) => asset.id));
  const bundleIds = new Set<string>();
  for (const asset of bundle.assets) {
    if (bundleIds.has(asset.reference.id)) {
      throw new AppProblem(
        400,
        "VALIDATION_FAILED",
        `Theme bundle asset is duplicated: ${asset.reference.id}`,
      );
    }
    bundleIds.add(asset.reference.id);
  }
  if (
    manifestIds.size !== bundleIds.size ||
    [...manifestIds].some((id) => !bundleIds.has(id))
  ) {
    throw new AppProblem(
      400,
      "VALIDATION_FAILED",
      "Theme bundle assets must exactly match the manifest asset index.",
    );
  }
}

function bundleBodyHash(value: {
  manifest: ThemeManifestV1;
  assets: ThemeBundleV1["assets"];
}): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function rawBundleBodyHash(input: unknown): string {
  if (!isRecord(input)) return "";
  return createHash("sha256")
    .update(
      JSON.stringify({
        manifest: input.manifest,
        assets: input.assets,
      }),
    )
    .digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function decodeBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new AppProblem(
      400,
      "VALIDATION_FAILED",
      "Theme asset is not canonical base64.",
    );
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > 12_000_000)
    throw new AppProblem(
      400,
      "VALIDATION_FAILED",
      "Theme asset must be between 1 byte and 12 MB.",
    );
  return bytes;
}

function validateAssetBytes(
  kind: ThemeAssetReference["kind"],
  extension: string,
  bytes: Buffer,
): void {
  const font =
    bytes.length >= 4 &&
    [".otf", ".ttf", ".woff2"].includes(extension) &&
    (bytes.subarray(0, 4).toString("ascii") === "OTTO" ||
      bytes.subarray(0, 4).toString("ascii") === "wOF2" ||
      bytes.readUInt32BE(0) === 0x00010000);
  const png =
    extension === ".png" &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    [".jpg", ".jpeg"].includes(extension) &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8;
  const webp =
    bytes.length >= 12 &&
    extension === ".webp" &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const avif =
    bytes.length >= 12 &&
    extension === ".avif" &&
    bytes.subarray(4, 8).toString("ascii") === "ftyp";
  if (kind === "font" ? !font : !(png || jpeg || webp || avif)) {
    throw new AppProblem(
      400,
      "VALIDATION_FAILED",
      `Theme ${kind} content does not match its allowed local file type.`,
    );
  }
}

function diffRecords(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix = "",
): Array<{ path: string; before: unknown; after: unknown }> {
  const changes: Array<{ path: string; before: unknown; after: unknown }> = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const pathName = prefix ? `${prefix}.${key}` : key;
    const left = before[key];
    const right = after[key];
    if (isRecord(left) && isRecord(right))
      changes.push(...diffRecords(left, right, pathName));
    else if (JSON.stringify(left) !== JSON.stringify(right))
      changes.push({ path: pathName, before: left, after: right });
  }
  return changes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
