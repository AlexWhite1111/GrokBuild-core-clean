import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppProblem } from "../security/problemResponse.js";
import { JsonStateStore } from "../storage/JsonStateStore.js";
import { ThemeRepository } from "./ThemeRepository.js";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9fQAAAAASUVORK5CYII=";

function repositoryFixture(t: test.TestContext): {
  state: JsonStateStore;
  repository: ThemeRepository;
  themesHome: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-build-themes-"));
  const state = new JsonStateStore(path.join(root, "app-state.json"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  const themesHome = path.join(root, "themes");
  return {
    state,
    themesHome,
    repository: new ThemeRepository(
      state,
      themesHome,
      path.join(root, "theme-assets"),
    ),
  };
}

function isAppearanceProblem(error: unknown, expectedMessage: string): boolean {
  return (
    error instanceof AppProblem &&
    error.status === 400 &&
    error.code === "VALIDATION_FAILED" &&
    error.message === expectedMessage
  );
}

test("system theme slots reject day/night appearance inversions and persist a valid pair", (t) => {
  const { repository } = repositoryFixture(t);

  assert.throws(
    () => repository.configureSystem("codex-neutral-dark", "grok-ink-dark"),
    (error) =>
      isAppearanceProblem(
        error,
        "The system day theme must use the light appearance.",
      ),
  );
  assert.throws(
    () => repository.configureSystem("grok-linen-light", "gilded-daylight"),
    (error) =>
      isAppearanceProblem(
        error,
        "The system night theme must use the dark appearance.",
      ),
  );

  const snapshot = repository.configureSystem(
    "gilded-daylight",
    "midnight-gilded",
  );
  assert.equal(snapshot.systemLightThemeId, "gilded-daylight");
  assert.equal(snapshot.systemDarkThemeId, "midnight-gilded");
  assert.equal(repository.library().systemLightThemeId, "gilded-daylight");
  assert.equal(repository.library().systemDarkThemeId, "midnight-gilded");
});

test("legacy or corrupted system slot preferences self-heal to valid appearances", (t) => {
  const { state, repository } = repositoryFixture(t);
  state.set("theme.preferences", {
      selectedThemeId: "grok-ink-dark",
      systemLightThemeId: "codex-neutral-dark",
      systemDarkThemeId: "gilded-daylight",
      followSystem: true,
    });

  const snapshot = repository.library();
  assert.equal(snapshot.systemLightThemeId, "grok-linen-light");
  assert.equal(snapshot.systemDarkThemeId, "grok-ink-dark");
  assert.equal(
    snapshot.themes.find((theme) => theme.id === snapshot.systemLightThemeId)
      ?.appearance,
    "light",
  );
  assert.equal(
    snapshot.themes.find((theme) => theme.id === snapshot.systemDarkThemeId)
      ?.appearance,
    "dark",
  );
  assert.deepEqual(readStoredPreferences(state), {
    selectedThemeId: "grok-ink-dark",
    systemLightThemeId: "grok-linen-light",
    systemDarkThemeId: "grok-ink-dark",
    followSystem: true,
  });
});

test("malformed theme preferences are repaired once and persisted canonically", (t) => {
  const { state, repository } = repositoryFixture(t);
  state.set("theme.preferences", "{not-json");

  const snapshot = repository.library();
  assert.equal(snapshot.selectedThemeId, "grok-ink-dark");
  assert.deepEqual(readStoredPreferences(state), {
    selectedThemeId: "grok-ink-dark",
    systemLightThemeId: "grok-linen-light",
    systemDarkThemeId: "grok-ink-dark",
    followSystem: true,
  });
});

test("theme manifests reject dangling or incorrectly typed asset references", (t) => {
  const { repository } = repositoryFixture(t);
  const missingFont = structuredClone(repository.get("grok-linen-light"));
  missingFont.id = "missing-font-reference";
  missingFont.name = "Missing font reference";
  delete missingFont.personality;
  missingFont.typography.ui.assetId = "asset-missing-font";
  assert.throws(
    () => repository.save(missingFont, false),
    (error) =>
      error instanceof AppProblem &&
      error.code === "VALIDATION_FAILED" &&
      /declared font asset/.test(error.message),
  );

  const missingImage = structuredClone(repository.get("grok-linen-light"));
  missingImage.id = "missing-image-reference";
  missingImage.name = "Missing image reference";
  delete missingImage.personality;
  missingImage.backgrounds.push({
    type: "asset",
    assetId: "asset-missing-image",
    opacity: 0.2,
    blur: 0,
  });
  assert.throws(
    () => repository.save(missingImage, false),
    (error) =>
      error instanceof AppProblem &&
      error.code === "VALIDATION_FAILED" &&
      /declared image or texture asset/.test(error.message),
  );
});

test("asset cleanup is conservative while a custom manifest is unreadable", (t) => {
  const { repository, themesHome } = repositoryFixture(t);
  const asset = repository.importAsset("image", "guarded.png", ONE_PIXEL_PNG);
  const assetPath = repository.assetPath(asset.id);
  const corruptManifest = path.join(themesHome, "corrupt.grok-theme.json");
  fs.writeFileSync(corruptManifest, "{not-json", "utf8");

  assert.deepEqual(repository.discardAsset(asset.id), { discarded: false });
  assert.equal(fs.existsSync(assetPath), true);

  fs.rmSync(corruptManifest, { force: true });
  assert.deepEqual(repository.discardAsset(asset.id), { discarded: true });
  assert.equal(fs.existsSync(assetPath), false);
});

test("staged theme assets can be discarded until a saved theme references them", (t) => {
  const { repository } = repositoryFixture(t);
  const orphan = repository.importAsset("image", "orphan.png", ONE_PIXEL_PNG);
  const orphanPath = repository.assetPath(orphan.id);

  assert.deepEqual(repository.discardAsset(orphan.id), { discarded: true });
  assert.equal(fs.existsSync(orphanPath), false);
  assert.deepEqual(repository.discardAsset(orphan.id), { discarded: false });

  const referenced = repository.importAsset("image", "referenced.png", ONE_PIXEL_PNG);
  const referencedPath = repository.assetPath(referenced.id);
  const custom = structuredClone(repository.get("grok-linen-light"));
  custom.id = "asset-discard-guard";
  custom.name = "Asset discard guard";
  delete custom.personality;
  custom.assets = [referenced];
  custom.backgrounds.push({
    type: "asset",
    assetId: referenced.id,
    opacity: 0.12,
    blur: 0,
  });
  repository.save(custom, false);

  assert.deepEqual(repository.discardAsset(referenced.id), { discarded: false });
  assert.equal(fs.existsSync(referencedPath), true);
});

test("theme asset lifecycle deduplicates imports and removes an orphan after deletion", (t) => {
  const { repository } = repositoryFixture(t);
  const first = repository.importAsset("image", "dot.png", ONE_PIXEL_PNG);
  const second = repository.importAsset("image", "dot-copy.png", ONE_PIXEL_PNG);
  assert.equal(second.id, first.id);
  assert.equal(second.sha256, first.sha256);
  const assetPath = repository.assetPath(first.id);

  const custom = structuredClone(repository.get("grok-linen-light"));
  custom.id = "asset-lifecycle-theme";
  custom.name = "Asset lifecycle";
  delete custom.personality;
  custom.assets = [first];
  custom.backgrounds.push({
    type: "asset",
    assetId: first.id,
    opacity: 0.12,
    blur: 0,
  });
  repository.save(custom, false);
  assert.equal(fs.existsSync(assetPath), true);

  repository.delete(custom.id);
  assert.equal(fs.existsSync(assetPath), false);
  assert.throws(
    () => repository.assetPath(first.id),
    (error) => error instanceof AppProblem && error.status === 404,
  );
});


test("overwriting a theme releases removed assets only after the last reference is gone", (t) => {
  const { repository } = repositoryFixture(t);
  const asset = repository.importAsset("image", "dot.png", ONE_PIXEL_PNG);
  const assetPath = repository.assetPath(asset.id);

  const first = structuredClone(repository.get("grok-linen-light"));
  first.id = "asset-overwrite-first";
  first.name = "Asset overwrite first";
  delete first.personality;
  first.assets = [asset];
  first.backgrounds.push({
    type: "asset",
    assetId: asset.id,
    opacity: 0.12,
    blur: 0,
  });
  repository.save(first, false);

  const second = structuredClone(first);
  second.id = "asset-overwrite-second";
  second.name = "Asset overwrite second";
  repository.save(second, false);

  first.assets = [];
  first.backgrounds = first.backgrounds.filter(
    (layer) => layer.type !== "asset",
  );
  repository.save(first, true);
  assert.equal(fs.existsSync(assetPath), true, "the shared asset must remain");

  repository.delete(second.id);
  assert.equal(fs.existsSync(assetPath), false, "the final orphan is reclaimed");
});

test("theme bundles cannot smuggle assets outside the manifest index", (t) => {
  const { repository } = repositoryFixture(t);
  const manifest = structuredClone(repository.get("grok-linen-light"));
  manifest.id = "bundle-index-theme";
  manifest.name = "Bundle index";
  delete manifest.personality;
  const bytes = Buffer.from(ONE_PIXEL_PNG, "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const reference = {
    id: `asset-${sha256.slice(0, 24)}`,
    kind: "image" as const,
    fileName: "dot.png",
    sha256,
  };
  const body = {
    manifest,
    assets: [{ reference, dataBase64: ONE_PIXEL_PNG }],
  };
  const bundle = {
    $schema: "grok-build://schemas/theme-bundle-v1.json" as const,
    ...body,
    sha256: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  };

  assert.throws(
    () => repository.importBundle(bundle, false),
    (error) =>
      error instanceof AppProblem &&
      error.code === "VALIDATION_FAILED" &&
      /exactly match/.test(error.message),
  );
});

function readStoredPreferences(state: JsonStateStore): unknown {
  return state.get("theme.preferences");
}
