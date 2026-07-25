import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PreviewPrepareRequest } from "../../shared/contracts.js";
import { PreviewRuntimeService } from "./PreviewRuntimeService.js";

const SIMPLE_PREVIEW: PreviewPrepareRequest = {
  language: "html",
  source: "<main>Ready</main>",
  embedded: false,
};

test("concurrent preview preparation publishes one deterministic cache entry", async (context) => {
  const fixture = await previewFixture(context);
  const service = new PreviewRuntimeService(fixture.cache);
  const prepared = await Promise.all(Array.from({ length: 6 }, () => service.prepare(SIMPLE_PREVIEW, fixture.workspace)));

  assert.equal(new Set(prepared.map((item) => item.hash)).size, 1);
  const hash = prepared[0].hash;
  const entries = (await fs.readdir(fixture.cache)).filter((name) => !name.startsWith("."));
  assert.deepEqual(entries, [hash]);
  assert.match(await service.index(hash), new RegExp(`/preview-runtime/${hash}/`));

  const cached = await service.prepare(SIMPLE_PREVIEW, fixture.workspace);
  assert.equal(cached.hash, hash);
  assert.equal(cached.cacheHit, true);
});

test("a corrupt preview cache entry is replaced instead of becoming a permanent miss", async (context) => {
  const fixture = await previewFixture(context);
  const first = new PreviewRuntimeService(fixture.cache);
  const prepared = await first.prepare(SIMPLE_PREVIEW, fixture.workspace);
  const entry = path.join(fixture.cache, prepared.hash);
  await fs.writeFile(path.join(entry, "manifest.json"), "{corrupt", "utf8");
  await fs.writeFile(path.join(entry, "index.html"), "stale", "utf8");

  const restarted = new PreviewRuntimeService(fixture.cache);
  const recovered = await restarted.prepare(SIMPLE_PREVIEW, fixture.workspace);

  assert.equal(recovered.hash, prepared.hash);
  assert.equal(recovered.cacheHit, false);
  assert.notEqual(await restarted.index(recovered.hash), "stale");
  const manifest = JSON.parse(await fs.readFile(path.join(entry, "manifest.json"), "utf8")) as { hash?: string };
  assert.equal(manifest.hash, recovered.hash);
});

test("typed workspace modules are cached and invalidated by file metadata", async (context) => {
  const fixture = await previewFixture(context);
  const modulePath = path.join(fixture.workspace, "entry.ts");
  await fs.writeFile(modulePath, "export const answer: number = 42;\n", "utf8");
  const service = new PreviewRuntimeService(fixture.cache);
  const prepared = await service.prepare({
    language: "html",
    source: '<script type="module" src="./entry.ts"></script>',
    embedded: false,
  }, fixture.workspace);

  const first = await service.asset(prepared.hash, "entry.ts");
  assert.equal(first.kind, "body");
  if (first.kind !== "body") return;
  assert.doesNotMatch(first.body, /: number/);
  assert.match(first.body, /42/);

  const cached = await service.asset(prepared.hash, "entry.ts");
  assert.deepEqual(cached, first);

  await fs.writeFile(modulePath, "export const answer: number = 4200;\n", "utf8");
  const changed = await service.asset(prepared.hash, "entry.ts");
  assert.equal(changed.kind, "body");
  if (changed.kind !== "body") return;
  assert.match(changed.body, /4200/);
  assert.notEqual(changed.etag, first.etag);
});

async function previewFixture(context: test.TestContext): Promise<{ root: string; workspace: string; cache: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-preview-runtime-"));
  const workspace = path.join(root, "workspace");
  const cache = path.join(root, "cache");
  await fs.mkdir(workspace, { recursive: true });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, workspace, cache };
}
