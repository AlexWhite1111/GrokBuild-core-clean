import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CODE_PREVIEW_POLICY } from "../../shared/contracts.js";
import { codeCapability, codeDefaultView, webCodePreviewEnabled } from "./codeBlockRegistry.js";

test("fenced and implicit JavaScript share one browser compatibility decision", () => {
  const browser = codeCapability("javascript", "document.body.textContent = 'ready';");
  assert.equal(browser.execute, "web");
  assert.equal(browser.browserCompatible, true);

  const node = codeCapability("javascript", "#!/usr/bin/env node\nconst fs = require('node:fs');");
  assert.equal(node.execute, "web");
  assert.equal(node.browserCompatible, false);
});

test("non-Web code remains source-owned", () => {
  assert.deepEqual(codeCapability("text", "plain text"), {
    language: "text",
    defaultView: "source",
  });
});

test("executable previews wait for the official message to finish streaming", () => {
  const mermaid = codeCapability("mermaid", "flowchart LR\nA --> B");
  const browser = codeCapability("typescript", "document.body.textContent = 'ready';");

  assert.equal(codeDefaultView(mermaid, false, true), "source");
  assert.equal(codeDefaultView(browser, true, true), "source");
  assert.equal(codeDefaultView(mermaid, false, false), "preview");
  assert.equal(codeDefaultView(browser, true, false), "preview");
  assert.equal(codeDefaultView(browser, false, false), "source");
});

test("Web execution requires the local service and every enabled code family", () => {
  const bundled = "<main>Ready</main><style>main{color:red}</style><script>document.body.dataset.ready='1'</script>";
  const capability = codeCapability("html", bundled);
  assert.equal(webCodePreviewEnabled(capability, bundled, DEFAULT_CODE_PREVIEW_POLICY, true), true);
  assert.equal(webCodePreviewEnabled(capability, bundled, DEFAULT_CODE_PREVIEW_POLICY, false), false);
  assert.equal(webCodePreviewEnabled(capability, bundled, {
    ...DEFAULT_CODE_PREVIEW_POLICY,
    languages: { ...DEFAULT_CODE_PREVIEW_POLICY.languages, javascript: false },
  }, true), false);
  assert.equal(webCodePreviewEnabled(capability, bundled, {
    ...DEFAULT_CODE_PREVIEW_POLICY,
    interactive: false,
  }, true), false);
});
