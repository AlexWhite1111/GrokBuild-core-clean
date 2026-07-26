import assert from "node:assert/strict";
import test from "node:test";
import type { RichTextPolicy } from "../../shared/richTextPipeline.js";
import { parseRichTextDocument } from "../../shared/richTextPipeline.js";
import {
  finalizeStreamingRichText,
  initialStreamingRichText,
  updateStreamingRichText,
} from "./streamingRichText.js";

const POLICY: RichTextPolicy = { level: "media" };

const COMPLEX_SOURCES = [
  "第一段普通正文。\n\n第二段包含 **强调** 与换行。",
  "# 标题\n\n正文\n\n- 第一项\n- 第二项",
  "正文\n\n```ts\nconst value = 1;\n```\n\n结尾",
  "正文\n\n<div class=\"card\">\n  <strong>HTML</strong>\n</div>\n\n结尾",
  "| A | B |\n| - | - |\n| 1 | 2 |",
  "公式 $V_o = DV_i$。\n\n$$E = mc^2$$",
  "[链接][ref]\n\n[ref]: https://example.com",
  "![示意图](https://example.com/example.png)",
  "const node = document.body;\nnode.dataset.ready = '1';",
  ":root { color: red; }\n\nconst node = document.body;",
] as const;

test("streaming rich text always finalizes to the authoritative one-shot tree", () => {
  for (const source of COMPLEX_SOURCES) {
    for (let split = 0; split <= source.length; split += 1) {
      let state = initialStreamingRichText(source.slice(0, split), POLICY);
      for (let cursor = split; cursor < source.length; cursor += 1) {
        state = updateStreamingRichText(state, source.slice(0, cursor + 1), POLICY);
      }
      const final = finalizeStreamingRichText(state, source, POLICY);
      assert.deepEqual(final.tree, parseRichTextDocument(source, POLICY), `${source.slice(0, 32)} @ ${split}`);
      assert.equal(final.activeSource, "");
      assert.equal(final.committedSource, source);
    }
  }
});

test("unsafe open constructs never become a guessed cached prefix", () => {
  for (const source of [
    "```ts\nconst value = 1;",
    "<div>\nunfinished",
    "| A | B |\n| - |",
    "$$\nE = mc^2",
    "[label][future]",
  ]) {
    const state = updateStreamingRichText(initialStreamingRichText("", POLICY), source, POLICY);
    assert.equal(state.mode, "full", source);
    assert.equal(state.committedSource, "", source);
  }
});

test("completed prose prefixes are parsed once while the active tail grows", () => {
  let source = "稳定的第一段。\n\n";
  let state = initialStreamingRichText(source, POLICY);
  source += "第二段开始";
  state = updateStreamingRichText(state, source, POLICY);
  assert.equal(state.mode, "incremental");
  const committed = state.committedSource;
  const parsedBefore = state.parsedCharacters;

  for (let index = 0; index < 1_000; index += 1) {
    source += "字";
    state = updateStreamingRichText(state, source, POLICY);
    assert.equal(state.committedSource, committed);
  }

  assert.ok(state.parsedCharacters - parsedBefore < source.length * 1_000);
  assert.equal(state.tree.children.length > 0, true);
});

test("a long plain paragraph stays byte-for-byte canonical without repeated full parsing", () => {
  const lines = Array.from({ length: 300 }, (_, index) =>
    `第${String(index + 1).padStart(3, "0")}行，持续输出用于验证流式渲染性能。`);
  let source = "";
  let state = initialStreamingRichText(source, POLICY);
  for (const line of lines) {
    source += `${source ? "\n" : ""}${line}`;
    state = updateStreamingRichText(state, source, POLICY);
    assert.equal(state.mode, "plain");
    assert.deepEqual(state.tree, parseRichTextDocument(source, POLICY));
  }

  assert.equal(state.parsedCharacters, 0);
  const final = finalizeStreamingRichText(state, source, POLICY);
  assert.deepEqual(final.tree, parseRichTextDocument(source, POLICY));
});

test("every partial plain-text frame keeps canonical whitespace, line, and Unicode positions", () => {
  const source = "第一行 plain text.\nSecond line 😀.";
  let state = initialStreamingRichText("", POLICY);
  for (let cursor = 1; cursor <= source.length; cursor += 1) {
    const partial = source.slice(0, cursor);
    state = updateStreamingRichText(state, partial, POLICY);
    assert.equal(state.mode, "plain", `cursor ${cursor}`);
    assert.deepEqual(state.tree, parseRichTextDocument(partial, POLICY), `cursor ${cursor}`);
  }
});

test("plain streaming returns to the canonical parser as soon as syntax becomes meaningful", () => {
  for (const [prefix, source] of [
    ["普通正文", "普通正文 **强调**"],
    ["www", "www.example.com"],
    ["document", "document.body"],
    ["await", "await fetch"],
    ["new", "new Date"],
  ]) {
    let state = initialStreamingRichText(prefix, POLICY);
    assert.equal(state.mode, "plain");
    state = updateStreamingRichText(state, source, POLICY);
    assert.equal(state.mode, "full", source);
    assert.deepEqual(state.tree, parseRichTextDocument(source, POLICY), source);
  }
});
