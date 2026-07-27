import type { MermaidConfig } from "mermaid";

export function mermaidConfiguration(themeVariables: MermaidConfig["themeVariables"]): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    htmlLabels: true,
    forceLegacyMathML: true,
    flowchart: { useMaxWidth: true },
    themeVariables,
  };
}
