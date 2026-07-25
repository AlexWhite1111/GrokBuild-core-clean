import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), entryChunkBudget(250_000)],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:5180",
      "/ws": {
        target: "ws://127.0.0.1:5180",
        ws: true,
      },
    },
  },
  build: {
    sourcemap: false,
    // Large diagram engines are intentionally lazy. Keep warnings useful for
    // optional renderers while enforcing the startup entry separately below.
    chunkSizeWarningLimit: 1_400,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return undefined;
          if (id.includes("/node_modules/@viz-js/viz/")) return "vendor-graphviz";
          if (id.includes("/node_modules/yaml/") || id.includes("/node_modules/smol-toml/")) return "vendor-structured-data";
          if (id.includes("/node_modules/katex/")) return "vendor-katex";
          if (id.includes("/node_modules/lucide-react/")) return "vendor-icons";
          if (["/react/", "/react-dom/", "/scheduler/"].some((name) => id.includes(`/node_modules${name}`))) return "vendor-react";
          if ([
            "remark-",
            "rehype-",
            "unified",
            "micromark",
            "mdast-",
            "hast-",
            "unist-",
            "vfile",
            "property-information",
            "html-url-attributes",
            "decode-named-character-reference",
            "character-entities",
            "comma-separated-tokens",
            "space-separated-tokens",
            "trim-lines",
            "zwitch",
            "devlop",
          ].some((name) => id.includes(`/node_modules/${name}`))) return "vendor-rich-text";
          // Leave optional renderers such as Mermaid in their dynamic import graph.
          // A catch-all vendor chunk makes every task pay their parse cost at startup.
          return undefined;
        },
      },
    },
  },
});

function entryChunkBudget(maxBytes: number): Plugin {
  return {
    name: "grok-build-entry-chunk-budget",
    generateBundle(_, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk" || !output.isEntry) continue;
        const size = Buffer.byteLength(output.code);
        if (size > maxBytes) this.error(`Renderer entry ${output.fileName} is ${size} bytes; budget is ${maxBytes} bytes.`);
      }
    },
  };
}
