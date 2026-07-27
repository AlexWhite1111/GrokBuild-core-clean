import assert from "node:assert/strict";
import test from "node:test";
import type { RichTextPolicy } from "../../shared/richTextPipeline.js";
import { parseRichTextDocument } from "../../shared/richTextPipeline.js";
import {
  finalizeStreamingRichText,
  initialStreamingRichText,
  streamingRichTextRenderSegments,
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
  "**则** \\(\\exists\\, c\\in(a,b)\\) 使得  \n$$f'(c)=0$$",
  "则 \\(F(a)=F(b)\\)，Rolle ⇒ \\(F'(c)=0\\Rightarrow f'(c)=\\lambda g'(c)\\)。",
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

test("a closed Mermaid fence becomes a non-streaming render segment immediately", () => {
  const source = [
    "```mermaid",
    "flowchart TD",
    "  A[开始] --> B[完成]",
    "```",
    "",
  ].join("\n");
  let state = initialStreamingRichText("", POLICY);
  for (let cursor = 1; cursor <= source.length; cursor += 1) {
    state = updateStreamingRichText(state, source.slice(0, cursor), POLICY);
  }

  assert.equal(state.committedSource, source);
  assert.equal(state.activeSource, "");
  assert.deepEqual(
    streamingRichTextRenderSegments(state)?.map((segment) => segment.streaming),
    [false],
  );
  assert.deepEqual(state.tree, parseRichTextDocument(source, POLICY));
});

test("blank lines inside an unfinished fence never create a completed segment", () => {
  const source = [
    "```mermaid",
    "flowchart TD",
    "",
    "  A[开始] --> B[仍在生成]",
    "",
  ].join("\n");
  const state = updateStreamingRichText(initialStreamingRichText("", POLICY), source, POLICY);
  assert.equal(state.committedSource, "");
  assert.equal(state.committedSegments.length, 0);
  assert.equal(streamingRichTextRenderSegments(state), null);
});

test("completed blocks stay mounted while only the active tail remains streaming", () => {
  const source = [
    "```mermaid",
    "flowchart LR",
    "  A --> B",
    "```",
    "",
    "后续正文仍在生成",
  ].join("\n");
  let state = initialStreamingRichText("", POLICY);
  for (let cursor = 1; cursor <= source.length; cursor += 1) {
    state = updateStreamingRichText(state, source.slice(0, cursor), POLICY);
  }
  const committed = state.committedSegments[0];

  assert.deepEqual(
    streamingRichTextRenderSegments(state)?.map((segment) => segment.streaming),
    [false, true],
  );

  const final = finalizeStreamingRichText(state, source, POLICY);
  assert.strictEqual(final.committedSegments[0], committed);
  assert.deepEqual(
    streamingRichTextRenderSegments(final)?.map((segment) => segment.streaming),
    [false, false],
  );
  assert.deepEqual(final.tree, parseRichTextDocument(source, POLICY));
});

test("portable enrichment takes over only when its authoritative tree differs", () => {
  const source = "第一段。\n\n第二段。";
  let state = initialStreamingRichText("", POLICY);
  for (let cursor = 1; cursor <= source.length; cursor += 1) {
    state = updateStreamingRichText(state, source.slice(0, cursor), POLICY);
  }
  const final = finalizeStreamingRichText(state, source, POLICY);
  assert.ok(streamingRichTextRenderSegments(final, parseRichTextDocument(source, POLICY)));

  const enriched = structuredClone(final.tree);
  const first = enriched.children.find((node) => node.type === "element");
  assert.ok(first && first.type === "element");
  first.tagName = "grok-local-link";
  assert.equal(streamingRichTextRenderSegments(final, enriched), null);
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

test("complex streaming stays visibly canonical while committed blocks remain stable", () => {
  const source = [
    "# 标题",
    "",
    "正文有 **强调**、[链接](https://example.com) 与 $E=mc^2$。",
    "",
    "- 第一项",
    "- 第二项",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "```ts",
    "const xs = [1, 2];",
    "```",
    "",
    "<div class=\"card\">HTML</div>",
    "",
    "结尾",
  ].join("\n");
  let state = initialStreamingRichText("", POLICY);
  for (let cursor = 1; cursor <= source.length; cursor += 1) {
    const partial = source.slice(0, cursor);
    state = updateStreamingRichText(state, partial, POLICY);
    assert.deepEqual(
      visibleChildren(state.tree),
      visibleChildren(parseRichTextDocument(partial, POLICY)),
      `cursor ${cursor}`,
    );
  }
  assert.ok(state.committedSource.length > source.length * 0.7);
});

test("complex Markdown parsing amplification stays bounded", () => {
  const section = (index: number) => [
    `## 模块 ${index}`,
    "",
    `这里是包含 **强调**、[链接](https://example.com/${index}) 和公式 $E=mc^2$ 的说明。`,
    "",
    `- 条目 A ${index}`,
    `- 条目 B ${index}`,
    "",
    "| 名称 | 数值 |",
    "| --- | ---: |",
    `| 项目 ${index} | ${index} |`,
    "",
    "```ts",
    `const value${index}: number = ${index};`,
    `console.log(value${index});`,
    "```",
    "",
  ].join("\n");
  const source = repeatedSource(section);
  const state = streamInFrames(source);

  assert.ok(
    state.parsedCharacters <= source.length * 5,
    `${state.parsedCharacters} parsed characters for ${source.length} source characters`,
  );
});

test("math-rich Markdown commits stable blocks and keeps parsing amplification bounded", () => {
  const section = (index: number) => [
    `## 定理 ${index}`,
    "",
    `**设** \\(f_${index}\\) 在 \\([a,b]\\) 连续，且 \\(F_${index}(a)=F_${index}(b)\\)。  `,
    `**则** \\(\\exists c\\in(a,b)\\) 使 \\(F_${index}'(c)=0\\)。`,
    "",
    "$$",
    `F_${index}'(c)=0\\Rightarrow f_${index}'(c)=\\lambda g_${index}'(c)`,
    "$$",
    "",
  ].join("\n");
  const source = repeatedSource(section);
  const state = streamInFrames(source);

  assert.ok(state.committedSource.length > source.length * 0.7);
  assert.ok(
    state.parsedCharacters <= source.length * 5,
    `${state.parsedCharacters} parsed characters for ${source.length} source characters`,
  );
  assert.deepEqual(
    finalizeStreamingRichText(state, source, POLICY).tree,
    parseRichTextDocument(source, POLICY),
  );
});

test("many Mermaid blocks stay bounded and survive final canonical verification", () => {
  const section = (index: number) => [
    `## 图 ${index}`,
    "",
    `说明含 [链接](https://example.com/${index}) 与 $E=mc^2$。`,
    "",
    "```mermaid",
    "flowchart LR",
    `  A${index}[输入] --> B${index}[处理] --> C${index}[完成]`,
    "```",
    "",
  ].join("\n");
  const source = repeatedSource(section);
  const state = streamInFrames(source);
  const committed = state.committedSegments.slice();
  const final = finalizeStreamingRichText(state, source, POLICY);

  assert.ok(
    state.parsedCharacters <= source.length * 4,
    `${state.parsedCharacters} parsed characters for ${source.length} source characters`,
  );
  assert.ok(committed.length > 1);
  assert.equal(
    committed.every((segment, index) => final.committedSegments[index] === segment),
    true,
  );
  assert.equal(
    streamingRichTextRenderSegments(final)?.every((segment) => !segment.streaming),
    true,
  );
  assert.deepEqual(final.tree, parseRichTextDocument(source, POLICY));
});

function visibleChildren(root: ReturnType<typeof parseRichTextDocument>): unknown[] {
  return root.children.flatMap((node) =>
    node.type === "text" && !node.value.trim() ? [] : [node]);
}

function repeatedSource(section: (index: number) => string): string {
  let source = "";
  for (let index = 1; source.length < 9_500; index += 1) source += section(index);
  return source;
}

function streamInFrames(source: string) {
  let state = initialStreamingRichText("", POLICY);
  for (let frame = 1; frame <= 150; frame += 1) {
    state = updateStreamingRichText(
      state,
      source.slice(0, Math.floor(source.length * frame / 150)),
      POLICY,
    );
  }
  return state;
}
