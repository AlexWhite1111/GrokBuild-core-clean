import assert from "node:assert/strict";
import test from "node:test";
import { previewCodeFamilies, supportsBrowserPreview } from "./previewModules.js";

test("browser preview accepts browser JavaScript and typed Web source", () => {
  assert.equal(supportsBrowserPreview("javascript", "document.body.dataset.ready = '1';"), true);
  assert.equal(supportsBrowserPreview("typescript", "const node: HTMLElement = document.body;"), true);
  assert.equal(supportsBrowserPreview("tsx", "const App = () => <main>Ready</main>;"), true);
});

test("browser preview rejects Node and CommonJS source without inspecting strings or comments", () => {
  assert.equal(supportsBrowserPreview("javascript", "#!/usr/bin/env node\nconsole.log(process.version);"), false);
  assert.equal(supportsBrowserPreview("javascript", "const fs = require('node:fs');"), false);
  assert.equal(supportsBrowserPreview("typescript", "module.exports = { ready: true };"), false);
  assert.equal(supportsBrowserPreview("javascript", "console.log('process require module Buffer');"), true);
  assert.equal(supportsBrowserPreview("javascript", "import('./view.js').then(module => module.render());"), true);
});

test("HTML preview derives every embedded Web language and rejects Node scripts", () => {
  const source = [
    "<main id=\"app\">Ready</main>",
    "<style>#app { color: red; }</style>",
    "<script type=\"text/typescript\">const app: HTMLElement = document.body;</script>",
  ].join("\n");
  assert.deepEqual(previewCodeFamilies("html", source), ["html", "css", "typescript"]);
  assert.equal(supportsBrowserPreview("html", source), true);
  assert.equal(supportsBrowserPreview("html", "<script>const fs = require('node:fs');</script>"), false);
});
