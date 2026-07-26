import type { MermaidConfig } from "mermaid";

export function mermaidConfiguration(themeVariables: MermaidConfig["themeVariables"]): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    htmlLabels: true,
    flowchart: { useMaxWidth: true },
    themeVariables,
  };
}
