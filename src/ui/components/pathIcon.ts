import type { PathIcon } from "./pathBadge.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARKUP: Record<PathIcon, string> = {
  file: '<path d="M6 2.5h7l5 5v14H6z"/><path d="M13 2.5v5h5"/>',
  document: '<path d="M6 2.5h7l5 5v14H6z"/><path d="M13 2.5v5h5M9 12h6M9 16h6"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>',
  presentation: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4M12 17v4"/>',
  code: '<path d="M8.5 7L4 12l4.5 5M15.5 7l4.5 5-4.5 5M14 4l-4 16"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M4 17l5-5 3 3 2-2 6 6"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9l5 3-5 3z"/>',
  audio: '<path d="M9 18V6l9-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="15.5" cy="16" r="2.5"/>',
  archive: '<path d="M4 7h16v14H4zM3 3h18v4H3zM9 11h6"/>',
  folder: '<path d="M3 6h7l2 2h9v12H3z"/>',
};

export function pathIconMarkup(name: PathIcon): string {
  return MARKUP[name];
}

export function pathIconElement(name: PathIcon): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) icon.setAttribute(key, value);
  icon.style.strokeWidth = "var(--icon-stroke-standard)";
  icon.innerHTML = pathIconMarkup(name);
  return icon;
}
