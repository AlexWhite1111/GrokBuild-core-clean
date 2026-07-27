import assert from "node:assert/strict";
import test from "node:test";
import type { Element, Root } from "hast";
import { normalizeMathDelimiters } from "../../shared/richText.js";
import { parseRichTextDocument } from "../../shared/richTextPipeline.js";
import { annotateMarkdownSourceBlocks } from "./richTextMarkdownCopy.js";

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

test("source-copy annotations use canonical positions without reparsing Markdown", () => {
  const blocks = ["第一段 \\(F(a)=F(b)\\)。", "第二段 **加粗**。"];
  const source = blocks.join("\n\n");
  const annotated = annotateMarkdownSourceBlocks(parseRichTextDocument(source, POLICY), source);
  const ranges = annotated.children.flatMap((node) => {
    if (node.type !== "element") return [];
    const start = Number(node.properties["data-md-source-start"]);
    const end = Number(node.properties["data-md-source-end"]);
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) ? [source.slice(start, end)] : [];
  });
  assert.deepEqual(ranges, blocks);
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
