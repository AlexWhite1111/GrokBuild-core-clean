import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Element, Root } from "hast";
import {
  parseRichTextDocument,
  RICH_EXECUTABLE_CODE_TAG,
  RICH_LIVE_HTML_TAG,
  RICH_STATIC_HTML_TAG,
} from "./richTextPipeline.js";

type Executable = { language: string; source: string; start?: number; end?: number };

describe("rich-text code segmentation", () => {
  describe("prose boundaries", () => {
    for (const source of [
      "这是普通正文，const value = 1 只是句子的一部分。",
      "`const value = 1`",
      "https://example.com/theme.css",
      "color: red",
      "function is a word in this sentence",
      ".preview-root",
      "const value =",
      ":root { color:",
      "* ordinary Markdown bullet",
      "1. const value = 1 is an instruction",
      "> const value = 1;",
      '{"kind":"data","value":1}',
      "Try { this is ordinary prose }",
    ]) {
      it(`keeps prose as prose: ${source}`, () => assert.deepEqual(executables(source), []));
    }
  });

  describe("implicit JavaScript and TypeScript", () => {
    const cases: Array<[string, string]> = [
      ["const count = 0;\ndocument.body.textContent = String(count);", "javascript"],
      ["// setup\nconst count = 1;\n// done", "javascript"],
      ["document.querySelector('#app')?.classList.add('ready');", "javascript"],
      ["fetch('/data.json').then(response => response.json());", "javascript"],
      ["addEventListener('load', () => console.log('ready'));", "javascript"],
      ["setTimeout(() => console.log('ready'), 10);", "javascript"],
      ["await fetch('/data.json');", "javascript"],
      ["(() => { document.body.dataset.ready = '1'; })();", "javascript"],
      ["export const answer = 42;", "javascript"],
      ["class Widget { mount(){ document.body.dataset.ready = '1'; } }", "javascript"],
      ["async function load(){ return await fetch('/data.json'); }", "javascript"],
      ["if (document.body) { document.body.dataset.ready = '1'; }", "javascript"],
      ["try { JSON.parse('{\"ok\":true}'); } catch (error) { console.error(error); }", "javascript"],
      ["do { console.log('once'); } while (false);", "javascript"],
      ["interface User { id: number }\nconst user: User = { id: 1 };", "typescript"],
      ["const node: HTMLElement = document.body;", "typescript"],
      ["type Mode = 'light' | 'dark';\nconst mode: Mode = 'dark';", "typescript"],
      ["enum State { Idle, Running }\nconst state = State.Idle;", "typescript"],
      ["const config = { mode: 'dark' } satisfies { mode: string };", "typescript"],
      ["const value = input as string;", "typescript"],
      ["import React from 'react';\nconst App = () => <svg><circle cx={4} cy={4} r={3} /></svg>;", "jsx"],
      ["const App = () => <><strong>Ready</strong><span>Now</span></>;", "jsx"],
      ["import React from 'react';\nconst App = (props: { label: string }) => <button>{props.label}</button>;", "tsx"],
      ["function App<T>(props: { value: T }) { return <main>{String(props.value)}</main>; }", "tsx"],
    ];
    for (const [source, language] of cases) {
      it(`recognizes ${language}: ${source.slice(0, 42)}`, () => {
        assert.deepEqual(executables(source).map((item) => item.language), [language]);
      });
    }
  });

  describe("implicit CSS", () => {
    for (const source of [
      ":root{font-family:system-ui;color-scheme:light dark}.preview-root{padding:24px;border:1px solid #38bdf8}",
      "@media (max-width: 600px) { .card { padding: 8px; } }",
      "body { margin: 0; }",
      "button:hover { color: cyan; }",
      "[data-state='open'] { display: block; }",
      "* { box-sizing: border-box; }",
      "* + * { margin-top: 1rem; }",
      "/* theme */\n.preview-root { color: cyan; }",
      "@supports (display: grid) { .layout { display: grid; } }",
      "@container card (width > 30rem) { .title { font-size: 2rem; } }",
      "@keyframes pulse { from { opacity: .5; } to { opacity: 1; } }",
      ":where(.card, .panel) > button { color: cyan; }",
      "::selection { background: #38bdf8; }",
      "svg > path { fill: currentColor; }",
      "h1, h2 { text-wrap: balance; }",
      "my-widget[data-ready] { display: block; }",
      "* {\n  box-sizing: border-box;\n}",
    ]) {
      it(`recognizes CSS: ${source.slice(0, 42)}`, () => {
        assert.deepEqual(executables(source).map((item) => item.language), ["css"]);
      });
    }
  });

  describe("mixed implicit blocks", () => {
    it("splits CSS followed by JavaScript without swallowing either side", () => {
      const source = ":root { color: red; }\nconst node = document.body;";
      assert.deepEqual(executables(source), [
        { language: "css", source: ":root { color: red; }", start: 0, end: 21 },
        { language: "javascript", source: "const node = document.body;", start: 22, end: source.length },
      ]);
    });

    it("splits JavaScript followed by CSS", () => {
      assert.deepEqual(executables("const node = document.body;\n.preview { color: red; }").map(({ language }) => language), ["javascript", "css"]);
    });

    it("supports three consecutive languages", () => {
      const source = ":root { color: red; }\nconst node: HTMLElement = document.body;\n.card { padding: 8px; }";
      assert.deepEqual(executables(source).map(({ language }) => language), ["css", "typescript", "css"]);
    });

    it("rejects a paragraph when prose interrupts executable source", () => {
      assert.deepEqual(executables("const value = 1;\nThis line is prose.\n.card { color: red; }"), []);
    });

    it("preserves exact trimmed source offsets", () => {
      const source = "\n\n   const value = 1;   \n";
      assert.deepEqual(executables(source), [{ language: "javascript", source: "const value = 1;", start: 5, end: 21 }]);
    });

    it("supports blank-line separated executable paragraphs", () => {
      assert.deepEqual(executables(":root { color: red; }\n\nconst node = document.body;").map(({ language }) => language), ["css", "javascript"]);
    });

    it("keeps a JavaScript template containing CSS-like lines as one program", () => {
      const source = "const css = `\n.card { color: cyan; }\n`;\ndocument.body.dataset.css = css;";
      assert.deepEqual(executables(source).map(({ language }) => language), ["javascript"]);
    });

    it("keeps less-than markup inside a JavaScript string in the script segment", () => {
      const source = "const markup = '<main>Ready</main>';\ndocument.body.innerHTML = markup;";
      assert.deepEqual(executables(source).map(({ language }) => language), ["javascript"]);
    });

    it("handles CRLF boundaries and preserves source offsets", () => {
      const source = "  :root { color: red; }\r\nconst node = document.body;  ";
      assert.deepEqual(executables(source), [
        { language: "css", source: ":root { color: red; }", start: 2, end: 23 },
        { language: "javascript", source: "const node = document.body;", start: 25, end: 52 },
      ]);
    });

    it("does not discard a valid first paragraph when the next paragraph is prose", () => {
      assert.deepEqual(executables("const value = 1;\n\nThis is a separate explanation.").map(({ source }) => source), ["const value = 1;"]);
    });
  });

  describe("Markdown fence isolation", () => {
    it("leaves a standalone fenced block under CommonMark ownership", () => {
      const root = parse("```css\n.preview { color: red; }\n```");
      assert.equal(elements(root, RICH_EXECUTABLE_CODE_TAG).length, 0);
      assert.equal(elements(root, "pre").length, 1);
    });

    it("does not reinterpret HTML written inside a fence", () => {
      const root = parse("```html\n<div><button onclick=\"go()\">Go</button></div>\n```");
      assert.equal(elements(root, RICH_LIVE_HTML_TAG).length, 0);
      assert.equal(elements(root, "pre").length, 1);
    });

    it("bundles adjacent HTML, CSS and JavaScript fences once", () => {
      const root = parse([
        "```html", "<main id=\"app\"><button>Go</button></main>", "```",
        "```css", "#app { color: cyan; }", "```",
        "```js", "document.querySelector('#app')?.setAttribute('data-ready', '1');", "```",
      ].join("\n"));
      const live = liveSources(root);
      assert.equal(live.length, 1);
      assert.match(live[0], /<main id="app">/);
      assert.match(live[0], /<style data-grok-bundle>/);
      assert.match(live[0], /<script data-grok-bundle>/);
    });

    it("keeps Node code outside an adjacent browser HTML bundle", () => {
      const root = parse([
        "```html",
        "<main>Ready</main>",
        "```",
        "",
        "```javascript",
        "#!/usr/bin/env node",
        "console.log(process.version);",
        "```",
      ].join("\n"));
      assert.equal(liveSources(root).length, 0);
      assert.equal(elements(root, "pre").length, 2);
    });

    it("accepts CSS before the markup fence", () => {
      const root = parse([
        "```css", ".card { color: cyan; }", "```",
        "```html", "<article class=\"card\">Card</article>", "```",
      ].join("\n"));
      assert.equal(liveSources(root).length, 1);
    });

    it("keeps a self-contained HTML document isolated from following code", () => {
      const root = parse([
        "```html", "<!doctype html><html><body><main>Page</main></body></html>", "```",
        "```css", "main { color: cyan; }", "```",
      ].join("\n"));
      assert.equal(liveSources(root).length, 0);
      assert.equal(elements(root, "pre").length, 2);
    });

    it("uses prose as a hard bundle boundary", () => {
      const root = parse([
        "```html", "<main id=\"app\">Page</main>", "```",
        "Explanation between examples.",
        "```css", "#app { color: cyan; }", "```",
      ].join("\n"));
      assert.equal(liveSources(root).length, 0);
      assert.equal(elements(root, "pre").length, 2);
    });

    it("starts a new boundary at a second script program", () => {
      const root = parse([
        "```html", "<main id=\"app\">Page</main>", "```",
        "```js", "document.body.dataset.first = '1';", "```",
        "```js", "document.body.dataset.second = '1';", "```",
      ].join("\n"));
      assert.equal(liveSources(root).length, 1);
      assert.equal(elements(root, "pre").length, 1);
    });

    it("supports tilde fences without reclassifying their contents", () => {
      const root = parse("~~~javascript\nconst value = 1;\n~~~");
      assert.equal(elements(root, RICH_EXECUTABLE_CODE_TAG).length, 0);
      assert.equal(elements(root, "pre").length, 1);
    });

    it("keeps an unlabeled fence as a plain code block", () => {
      const root = parse("```\nconst value = 1;\n```");
      assert.equal(elements(root, RICH_EXECUTABLE_CODE_TAG).length, 0);
      assert.equal(elements(root, "pre").length, 1);
    });

    it("keeps an unclosed fence isolated through end of input", () => {
      const root = parse("```html\n<div><button onclick=\"go()\">Go</button></div>");
      assert.equal(elements(root, RICH_LIVE_HTML_TAG).length, 0);
      assert.equal(elements(root, "pre").length, 1);
    });

    it("honors a longer outer fence containing triple backticks", () => {
      const root = parse("````html\n<pre>```nested```</pre>\n````");
      assert.equal(elements(root, RICH_LIVE_HTML_TAG).length, 0);
      assert.equal(elements(root, "pre").length, 1);
    });

    it("bundles script and style fences authored before markup", () => {
      const root = parse([
        "```js", "const app = document.querySelector('#app');", "```",
        "```css", "#app { color: cyan; }", "```",
        "```html", "<main id=\"app\">Ready</main>", "```",
      ].join("\n"));
      assert.equal(liveSources(root).length, 1);
    });

    it("bundles multiple style fences around one markup block", () => {
      const root = parse([
        "```css", ":root { color-scheme: dark; }", "```",
        "```html", "<main class=\"card\">Ready</main>", "```",
        "```css", ".card { color: cyan; }", "```",
      ].join("\n"));
      const live = liveSources(root);
      assert.equal(live.length, 1);
      assert.equal((live[0].match(/<style data-grok-bundle>/g) || []).length, 2);
    });

    it("preserves TSX language when composing a fenced web bundle", () => {
      const root = parse([
        "```html", "<main id=\"app\"></main>", "```",
        "```tsx", "const App = (props: { label: string }) => <b>{props.label}</b>;", "```",
      ].join("\n"));
      assert.match(liveSources(root)[0], /<script type="text\/tsx" data-grok-bundle>/);
    });
  });

  describe("raw HTML islands", () => {
    it("keeps static block HTML static", () => {
      assert.equal(elements(parse("<div class=\"card\">Static content</div>"), RICH_STATIC_HTML_TAG).length, 1);
    });

    it("promotes interactive block HTML to a live island", () => {
      assert.equal(elements(parse("<div><button onclick=\"go()\">Go</button></div>"), RICH_LIVE_HTML_TAG).length, 1);
    });

    it("routes styled block HTML through the isolated live preview", () => {
      assert.equal(elements(parse("<div style=\"color: red\">Styled content</div>"), RICH_LIVE_HTML_TAG).length, 1);
    });

    it("keeps inline span markup inside prose", () => {
      const root = parse("Text with <span style=\"color:red\">inline HTML</span> around it.");
      assert.equal(elements(root, RICH_LIVE_HTML_TAG).length, 0);
      assert.equal(elements(root, RICH_STATIC_HTML_TAG).length, 0);
      assert.equal(elements(root, "span").length, 1);
      assert.equal(elements(root, "span")[0].properties?.style, undefined);
    });

    it("narrows authored inline HTML to safe tags and properties", () => {
      const root = parse("Text <custom-card class=\"overlay\"><a href=\"https://example.com\" target=\"_top\">link</a></custom-card>.");
      const spans = elements(root, "span");
      const links = elements(root, "a");
      assert.equal(spans.length, 1);
      assert.deepEqual(spans[0].properties, {});
      assert.equal(links.length, 1);
      assert.deepEqual(links[0].properties, { href: "https://example.com" });
    });

    it("captures a full HTML document as one live island", () => {
      const root = parse("<!doctype html>\n<html><head><style>body{margin:0}</style></head><body><main>Page</main></body></html>");
      assert.equal(liveSources(root).length, 1);
      assert.match(liveSources(root)[0], /<!doctype html>/i);
    });

    it("bundles raw HTML with following implicit CSS and JavaScript", () => {
      const root = parse([
        "<div id=\"app\"><button>Go</button></div>", "",
        "#app { color: cyan; }", "",
        "const app = document.querySelector('#app');", "app?.setAttribute('data-ready', '1');",
      ].join("\n"));
      const live = liveSources(root);
      assert.equal(live.length, 1);
      assert.match(live[0], /<style data-grok-bundle>/);
      assert.match(live[0], /<script data-grok-bundle>/);
    });

    it("joins adjacent top-level HTML blocks into one static island", () => {
      const root = parse("<section>One</section>\n\n<!-- join -->\n<div>Two</div>");
      assert.equal(elements(root, RICH_STATIC_HTML_TAG).length, 1);
      assert.match(String(elements(root, RICH_STATIC_HTML_TAG)[0].properties?.source), /<div>Two<\/div>/);
    });

    it("uses prose as a hard boundary between raw HTML islands", () => {
      const root = parse("<div>One</div>\n\nExplanation.\n\n<div>Two</div>");
      assert.equal(elements(root, RICH_STATIC_HTML_TAG).length, 2);
    });

    it("bundles raw HTML with universal-selector CSS and JavaScript", () => {
      const root = parse([
        "<main id=\"app\">Ready</main>", "",
        "* { box-sizing: border-box; }", "",
        "const app = document.querySelector('#app');",
      ].join("\n"));
      const live = liveSources(root);
      assert.equal(live.length, 1);
      assert.match(live[0], /\* \{ box-sizing: border-box; \}/);
    });

    it("keeps an inline code element inside prose rather than creating an HTML island", () => {
      const root = parse("Use <code>const value = 1</code> in this sentence.");
      assert.equal(elements(root, RICH_LIVE_HTML_TAG).length, 0);
      assert.equal(elements(root, RICH_STATIC_HTML_TAG).length, 0);
      assert.equal(elements(root, "code").length, 1);
    });

    it("captures raw SVG as one live island", () => {
      const root = parse("<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\" /></svg>");
      assert.equal(elements(root, RICH_LIVE_HTML_TAG).length, 1);
    });
  });

  describe("module boundary projection", () => {
    it("marks a bundled top-level await script as a module", () => {
      const root = parse([
        "```html", "<main id=\"app\">Page</main>", "```",
        "```js", "const response = await fetch('/data.json');", "```",
      ].join("\n"));
      assert.match(liveSources(root)[0], /<script type="module" data-grok-bundle>/);
    });

    it("keeps await inside an async function compatible with classic globals", () => {
      const root = parse([
        "```html", "<button onclick=\"loadData()\">Load</button>", "```",
        "```js", "async function loadData(){ await fetch('/data.json'); }", "```",
      ].join("\n"));
      assert.match(liveSources(root)[0], /<script data-grok-bundle>/);
      assert.doesNotMatch(liveSources(root)[0], /<script type="module"/);
    });

    it("marks a static import script as a module", () => {
      const root = parse([
        "```html", "<main id=\"app\"></main>", "```",
        "```js", "import { render } from './view.js';\nrender(document.querySelector('#app'));", "```",
      ].join("\n"));
      assert.match(liveSources(root)[0], /<script type="module" data-grok-bundle>/);
    });

    it("marks an export script as a module", () => {
      const root = parse([
        "```html", "<main id=\"app\"></main>", "```",
        "```js", "export const ready = true;", "```",
      ].join("\n"));
      assert.match(liveSources(root)[0], /<script type="module" data-grok-bundle>/);
    });

    it("keeps dynamic import compatible with a classic script", () => {
      const root = parse([
        "```html", "<main id=\"app\"></main>", "```",
        "```js", "import('./view.js').then(module => module.render());", "```",
      ].join("\n"));
      assert.match(liveSources(root)[0], /<script data-grok-bundle>/);
      assert.doesNotMatch(liveSources(root)[0], /<script type="module"/);
    });
  });
});

function parse(source: string): Root {
  return parseRichTextDocument(source, { level: "safe" });
}

function executables(source: string): Executable[] {
  return elements(parse(source), RICH_EXECUTABLE_CODE_TAG).map((node) => ({
    language: String(node.properties?.language || ""),
    source: String(node.properties?.source || ""),
    ...(typeof node.position?.start.offset === "number" ? { start: node.position.start.offset } : {}),
    ...(typeof node.position?.end.offset === "number" ? { end: node.position.end.offset } : {}),
  }));
}

function liveSources(root: Root): string[] {
  return elements(root, RICH_LIVE_HTML_TAG).map((node) => String(node.properties?.source || ""));
}

function elements(root: Root, tagName: string): Element[] {
  const result: Element[] = [];
  const visit = (node: Root | Root["children"][number]) => {
    if (node.type === "element") {
      if (node.tagName === tagName) result.push(node);
      node.children.forEach(visit);
    } else if ("children" in node) node.children.forEach(visit);
  };
  visit(root);
  return result;
}
