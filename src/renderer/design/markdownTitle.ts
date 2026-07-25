import type { PhrasingContent, Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

export function firstMarkdownHeading(markdown: string | null | undefined, fallback = "Plan"): string {
  const tree = unified().use(remarkParse).parse(markdown || "") as Root;
  const heading = tree.children.find((node) => node.type === "heading");
  return heading?.children.map(phrasingText).join("").trim() || fallback;
}

function phrasingText(node: PhrasingContent): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if (node.type === "image") return node.alt || "";
  return "children" in node ? node.children.map(phrasingText).join("") : "";
}
