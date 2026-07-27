import assert from "node:assert/strict";
import test from "node:test";
import type { Element, Root } from "hast";
import { normalizeMathDelimiters } from "../../shared/richText.js";
import { parseRichTextDocument } from "../../shared/richTextPipeline.js";
import {
  annotateMarkdownSourceUnits,
  codeBlockClipboardText,
  markdownFromSourceRanges,
  markdownSourceAtomProps,
  replaceClipboardWithMarkdown,
} from "./richTextMarkdownCopy.js";

const POLICY = { level: "media" } as const;

test("explicit TeX math keeps source coordinates and nested parentheses intact", () => {
  const source = [
    "**设** \\(f\\) 在 \\([a,b]\\) 上连续，在 \\((a,b)\\) 内可导，且 \\(f(a)=f(b)\\)。  ",
    "**则** \\(\\exists\\, c\\in(a,b)\\) 使得  ",
    "$$f'(c)=0$$",
  ].join("\n");
  const normalized = normalizeMathDelimiters(source);

  assert.equal(normalized.length, source.length);
  assert.equal(normalized, [
    "**设** $ f $ 在 $ [a,b] $ 上连续，在 $ (a,b) $ 内可导，且 $ f(a)=f(b) $。  ",
    "**则** $ \\exists\\, c\\in(a,b) $ 使得  ",
    "$$f'(c)=0$$",
  ].join("\n"));
  assert.doesNotMatch(normalized, /\$f\$a\$|\$F'\$c\$/);
});

test("normalization owns only explicit delimiters", () => {
  const protectedSource = [
    "`\\(code(x)\\)`",
    "```md",
    "\\(f(x)\\)",
    "```",
    "[\\(label\\)](https://example.com/a_(b))",
    "$\\(already-owned\\)$",
  ].join("\n");
  assert.equal(normalizeMathDelimiters(protectedSource), protectedSource);
  assert.equal(normalizeMathDelimiters("步骤 (A)；数组 [x=1]。"), "步骤 (A)；数组 [x=1]。");
});

test("official Rolle and Cauchy source renders without leaked delimiters", () => {
  const source = [
    "**设** \\(f\\) 在 \\([a,b]\\) 上连续，在 \\((a,b)\\) 内可导，且 \\(f(a)=f(b)\\)。  ",
    "**则** \\(\\exists\\, c\\in(a,b)\\) 使得  ",
    "$$f'(c)=0$$",
    "",
    "则 \\(F(a)=F(b)\\)，Rolle ⇒ \\(F'(c)=0\\Rightarrow f'(c)=\\lambda g'(c)\\)。",
  ].join("\n");
  const tree = parseRichTextDocument(source, POLICY);

  assert.equal(elementsWithClass(tree, "katex").length, 8);
  assert.equal(elementsWithClass(tree, "katex-display").length, 1);
  assert.equal(elements(tree, "strong").length, 2);
  assert.doesNotMatch(textOutsideMath(tree), /[$\\]/);
});

test("whole-line double-dollar math remains display math after a Markdown hard break", () => {
  const source = "**则** \\(x\\) 使得  \n$$f'(c)=0$$";
  const tree = parseRichTextDocument(source, POLICY);
  assert.equal(elementsWithClass(tree, "katex-display").length, 1);
  assert.equal(elementsWithClass(parseRichTextDocument("正文 $$x$$ 正文", POLICY), "katex-display").length, 0);
});

test("source-copy annotations retain canonical block positions without reparsing Markdown", () => {
  const blocks = ["第一段 \\(F(a)=F(b)\\)。", "第二段 **加粗**。"];
  const source = blocks.join("\n\n");
  const annotated = annotateMarkdownSourceUnits(parseRichTextDocument(source, POLICY), source);
  const ranges = annotated.children.flatMap((node) => {
    if (node.type !== "element") return [];
    const start = Number(node.properties["data-md-source-start"]);
    const end = Number(node.properties["data-md-source-end"]);
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) ? [source.slice(start, end)] : [];
  });
  assert.deepEqual(ranges, blocks);
});

test("table text is character-addressable while formulas and inline syntax remain source atoms", () => {
  const source = [
    "| 名称 | 公式 |",
    "| --- | --- |",
    "| 能量 | $E=mc^2$ |",
    "| 力 | **F=ma** |",
  ].join("\n");
  const annotated = annotateMarkdownSourceUnits(parseRichTextDocument(source, POLICY), source);

  assert.deepEqual(sourceSlices(annotated, source, "data-md-copy-text"), [
    "名称",
    "公式",
    "能量",
    "力",
  ]);
  assert.deepEqual(sourceSlices(annotated, source, "data-md-copy-atom"), [
    "$E=mc^2$",
    "**F=ma**",
  ]);
  assert.deepEqual(elements(annotated, "tr").map((row) => sourceSlice(row, source)), [
    "| 名称 | 公式 |",
    "| 能量 | $E=mc^2$ |",
    "| 力 | **F=ma** |",
  ]);
});

test("KaTeX roots recover the exact authored delimiter range", () => {
  const source = "行内 \\(E=mc^2\\)，行间：\n\n$$F=ma$$";
  const annotated = annotateMarkdownSourceUnits(parseRichTextDocument(source, POLICY), source);
  assert.deepEqual(
    sourceSlices(annotated, source, "data-md-copy-atom"),
    ["\\(E=mc^2\\)", "$$F=ma$$"],
  );
});

test("the final clipboard slice spans only selected text offsets and complete syntax atoms", () => {
  const source = "| 能量 | $E=mc^2$ |";
  const formulaStart = source.indexOf("$");
  assert.equal(markdownFromSourceRanges(source, [
    { start: source.indexOf("量"), end: source.indexOf("量") + 1 },
    { start: formulaStart, end: source.lastIndexOf("$") + 1 },
  ]), "量 | $E=mc^2$");
});

test("Markdown selection copy removes the competing rendered HTML flavor", () => {
  const calls: string[] = [];
  const values = new Map<string, string>();
  replaceClipboardWithMarkdown({
    clearData() {
      calls.push("clear");
      values.clear();
    },
    setData(type, value) {
      calls.push(type);
      values.set(type, value);
    },
  }, "```text\nsource\n```");

  assert.deepEqual(calls, ["clear", "text/plain", "text/markdown"]);
  assert.deepEqual(Object.fromEntries(values), {
    "text/plain": "```text\nsource\n```",
    "text/markdown": "```text\nsource\n```",
  });
  assert.equal(values.has("text/html"), false);
});

test("custom rich projections can retain one exact source atom on their real DOM boundary", () => {
  assert.deepEqual(markdownSourceAtomProps({ start: 14, end: 41 }), {
    "data-md-source-start": "14",
    "data-md-source-end": "41",
    "data-md-copy-atom": "true",
  });
  assert.deepEqual(markdownSourceAtomProps(undefined), {});
});

test("a code-block copy keeps the exact authored fence, language, info string and line endings", () => {
  const source = "~~~~typescript title=\"demo\"\r\nconst value = 1;\r\n~~~~";
  const annotated = annotateMarkdownSourceUnits(parseRichTextDocument(source, POLICY), source);
  const pre = elements(annotated, "pre")[0];
  const authored = pre ? sourceSlice(pre, source) : undefined;

  assert.equal(authored, source);
  assert.equal(codeBlockClipboardText("const value = 1;", authored), source);
  assert.equal(codeBlockClipboardText("const value = 1;"), "const value = 1;");
});

test("source annotation tolerates generated nodes with partial positions", () => {
  const source = "正文";
  const document = {
    type: "root",
    children: [{
      type: "element",
      tagName: "span",
      properties: {},
      children: [{ type: "text", value: source }],
      position: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 3 },
      },
    }],
  } as Root;

  assert.doesNotThrow(() => annotateMarkdownSourceUnits(document, source));
  assert.deepEqual(document.children[0]?.type === "element" ? document.children[0].properties : {}, {});
});

function elements(root: Root, tagName: string): Element[] {
  const values: Element[] = [];
  visit(root, (node) => {
    if (node.type === "element" && node.tagName === tagName) values.push(node);
  });
  return values;
}

function elementsWithClass(root: Root, className: string): Element[] {
  const values: Element[] = [];
  visit(root, (node) => {
    if (
      node.type === "element"
      && Array.isArray(node.properties.className)
      && node.properties.className.includes(className)
    ) values.push(node);
  });
  return values;
}

function sourceSlices(root: Root, source: string, property: string): string[] {
  const values: string[] = [];
  visit(root, (node) => {
    if (node.type !== "element" || !node.properties[property]) return;
    const value = sourceSlice(node, source);
    if (value !== undefined) values.push(value);
  });
  return values;
}

function sourceSlice(node: Element, source: string): string | undefined {
  const start = Number(node.properties["data-md-source-start"]);
  const end = Number(node.properties["data-md-source-end"]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end)
    ? source.slice(start, end)
    : undefined;
}

function textOutsideMath(root: Root): string {
  const values: string[] = [];
  const collect = (node: Root | Root["children"][number], insideMath: boolean): void => {
    const classes = node.type === "element" && Array.isArray(node.properties.className)
      ? node.properties.className
      : [];
    const blocked = insideMath || classes.includes("katex") || classes.includes("katex-display");
    if (node.type === "text" && !blocked) values.push(node.value);
    if ("children" in node) node.children.forEach((child) => collect(child, blocked));
  };
  collect(root, false);
  return values.join("");
}

function visit(root: Root, visitor: (node: Root | Root["children"][number]) => void): void {
  const walk = (node: Root | Root["children"][number]): void => {
    visitor(node);
    if ("children" in node) node.children.forEach(walk);
  };
  walk(root);
}
