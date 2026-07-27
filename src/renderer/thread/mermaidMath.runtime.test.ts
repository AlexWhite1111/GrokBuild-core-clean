import assert from "node:assert/strict";
import test from "node:test";
import { mermaidConfiguration } from "./mermaidPreviewPolicy.js";
import { svgSanitizerPolicy } from "./svgSanitizer.js";

test("Mermaid math uses strict HTML labels without relaxing direct SVG input", () => {
  const configuration = mermaidConfiguration({});
  assert.equal(configuration.securityLevel, "strict");
  assert.equal(configuration.htmlLabels, true);
  assert.equal(configuration.forceLegacyMathML, true);

  const directSvg = svgSanitizerPolicy(false, true);
  assert.equal(directSvg.allowGeneratedHtmlLabels, false);
  assert.equal(directSvg.parseAsHtml, false);
  assert.equal(directSvg.addedTags.length, 0);
  assert.equal(directSvg.htmlIntegrationPoints, undefined);
  assert.ok(directSvg.forbiddenTags.includes("foreignObject"));

  const generatedMermaid = svgSanitizerPolicy(true, true);
  assert.equal(generatedMermaid.allowGeneratedHtmlLabels, true);
  assert.equal(generatedMermaid.parseAsHtml, true);
  assert.deepEqual(generatedMermaid.addedTags, ["foreignObject"]);
  assert.equal(generatedMermaid.profiles.html, true);
  assert.equal(generatedMermaid.profiles.mathMl, true);
  assert.deepEqual(generatedMermaid.htmlIntegrationPoints, { foreignobject: true });
  assert.ok(!generatedMermaid.forbiddenTags.includes("foreignObject"));
});
