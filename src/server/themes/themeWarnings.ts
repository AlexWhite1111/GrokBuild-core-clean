import type { ThemeManifestV1 } from "../../shared/contracts.js";

export function collectThemeWarnings(theme: ThemeManifestV1): string[] {
  const warnings: string[] = [];
  const checks: Array<{ label: string; foreground: string; background: string; minimum: number }> = [
    { label: "主文字与画布", foreground: theme.colors.text, background: theme.colors.canvas, minimum: 4.5 },
    { label: "次要文字与画布", foreground: theme.colors.textSecondary, background: theme.colors.canvas, minimum: 4.5 },
    { label: "弱化文字与画布", foreground: theme.colors.textMuted, background: theme.colors.canvas, minimum: 4.5 },
    { label: "强调文字与强调底色", foreground: theme.colors.accentText, background: theme.colors.accent, minimum: 4.5 },
    { label: "强调色与画布", foreground: theme.colors.accent, background: theme.colors.canvas, minimum: 3 },
  ];
  for (const check of checks) {
    const foreground = parseHex(check.foreground);
    const background = parseHex(check.background);
    if (foreground && background && contrast(foreground, background) < check.minimum) {
      warnings.push(`${check.label}对比度低于建议值 ${check.minimum}:1。`);
    }
  }
  if (theme.colors.danger.toLowerCase() === theme.colors.success.toLowerCase()) {
    warnings.push("危险色与成功色相同，状态语义可能难以区分。");
  }
  if (theme.backgrounds.some((layer) => layer.type === "asset" && layer.blur > 0)) {
    warnings.push("V1 背景合成器不会单独模糊资产图层；请使用预先处理的图片，或将 blur 设为 0。");
  }
  return warnings;
}

function parseHex(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) return null;
  const source = match[1].length === 3 ? [...match[1]].map((character) => `${character}${character}`).join("") : match[1];
  return [0, 2, 4].map((index) => Number.parseInt(source.slice(index, index + 2), 16)) as [number, number, number];
}

function contrast(first: [number, number, number], second: [number, number, number]): number {
  const high = Math.max(luminance(first), luminance(second));
  const low = Math.min(luminance(first), luminance(second));
  return (high + 0.05) / (low + 0.05);
}

function luminance(color: [number, number, number]): number {
  const values = color.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
