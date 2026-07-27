const DARK_LABEL = "#111111";
const LIGHT_LABEL = "#ffffff";
const LABEL_CONTENT = [
  "text",
  "tspan",
  ".label",
  ".nodeLabel",
  ".label p",
  ".nodeLabel p",
  ".katex",
  ".katex *",
  "math",
  "math *",
].join(", ");

interface RgbColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

/**
 * Mermaid owns the diagram structure. This only supplies a readable label
 * color when a generated node or cluster has an explicit custom fill.
 */
export function repairMermaidLabelContrast(markup: string): string {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const root = parsed.querySelector("svg");
  if (!root) return markup;
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  let repaired = false;
  try {
    const canvas = resolveCssColor(
      getComputedStyle(document.documentElement).getPropertyValue("--background-code-visual"),
      probe,
    );
    root.querySelectorAll<SVGGraphicsElement>(".label-container").forEach((shape) => {
      const group = shape.parentElement?.closest("g");
      if (group?.localName !== "g") return;
      repaired = repairLabel(
        group,
        shape.style.fill || shape.getAttribute("fill") || "",
        canvas,
        probe,
      ) || repaired;
    });
    root.querySelectorAll<SVGGElement>("g.cluster").forEach((cluster) => {
      const children = Array.from(cluster.children);
      const background = children.find((child) =>
        child.localName === "rect" || child.classList.contains("label-container"));
      const label = children.find((child) => child.classList.contains("cluster-label"));
      if (!(background instanceof SVGElement) || !(label instanceof SVGElement)) return;
      repaired = repairLabel(
        label,
        background.style.fill || background.getAttribute("fill") || "",
        canvas,
        probe,
      ) || repaired;
    });
  } finally {
    probe.remove();
  }
  return repaired ? new XMLSerializer().serializeToString(root) : markup;
}

function repairLabel(
  scope: Element,
  fill: string,
  canvas: RgbColor | null,
  probe: HTMLElement,
): boolean {
  if (!fill) return false;
  const label = labelColorForBackground(resolveCssColor(fill, probe), canvas);
  if (!label) return false;
  scope.querySelectorAll<SVGElement | HTMLElement>(LABEL_CONTENT).forEach((element) => {
    element.style.setProperty("color", label, "important");
    element.style.setProperty("fill", label, "important");
  });
  return true;
}

export function labelColorForBackground(
  background: RgbColor | string | null,
  canvas: RgbColor | string | null = null,
): typeof DARK_LABEL | typeof LIGHT_LABEL | null {
  const fill = typeof background === "string" ? parsedColor(background) : background;
  if (!fill || fill.alpha <= 0) return null;
  const resolvedCanvas = typeof canvas === "string" ? parsedColor(canvas) : canvas;
  const color = fill.alpha < 1
    ? resolvedCanvas ? composite(fill, resolvedCanvas) : null
    : fill;
  if (!color) return null;
  return contrastRatio(color, parsedColor(DARK_LABEL)!) >= contrastRatio(color, parsedColor(LIGHT_LABEL)!)
    ? DARK_LABEL
    : LIGHT_LABEL;
}

function resolveCssColor(value: string, probe: HTMLElement): RgbColor | null {
  probe.style.color = "";
  probe.style.color = value.trim();
  if (!probe.style.color) return null;
  return parsedColor(getComputedStyle(probe).color);
}

function parsedColor(value: string): RgbColor | null {
  const source = value.trim().toLowerCase();
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(source);
  if (hex) {
    const expanded = hex[1].length <= 4
      ? [...hex[1]].map((part) => part + part).join("")
      : hex[1];
    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*(?:,|\/)\s*([\d.]+%?))?\s*\)$/.exec(source);
  if (!rgb) return null;
  const alpha = rgb[4]?.endsWith("%")
    ? Number.parseFloat(rgb[4]) / 100
    : rgb[4] == null ? 1 : Number.parseFloat(rgb[4]);
  const color = {
    red: Number.parseFloat(rgb[1]),
    green: Number.parseFloat(rgb[2]),
    blue: Number.parseFloat(rgb[3]),
    alpha,
  };
  return Object.values(color).every(Number.isFinite) ? color : null;
}

function composite(foreground: RgbColor, background: RgbColor): RgbColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha <= 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  const channel = (front: number, back: number) =>
    (front * foreground.alpha + back * background.alpha * (1 - foreground.alpha)) / alpha;
  return {
    red: channel(foreground.red, background.red),
    green: channel(foreground.green, background.green),
    blue: channel(foreground.blue, background.blue),
    alpha,
  };
}

function contrastRatio(left: RgbColor, right: RgbColor): number {
  const brighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (brighter + .05) / (darker + .05);
}

function relativeLuminance(color: RgbColor): number {
  const channel = (value: number) => {
    const normalized = Math.min(255, Math.max(0, value)) / 255;
    return normalized <= .04045
      ? normalized / 12.92
      : ((normalized + .055) / 1.055) ** 2.4;
  };
  return .2126 * channel(color.red) + .7152 * channel(color.green) + .0722 * channel(color.blue);
}
