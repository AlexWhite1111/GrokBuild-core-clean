import DOMPurify from "dompurify";

const UNSAFE_CSS = /@import|expression\s*\(/i;
const CSS_URL = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;

export function sanitizeSvgMarkup(markup: string, generated = false): string | null {
  const clean = DOMPurify.sanitize(markup, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "image", "audio", "video", "foreignObject", ...(generated ? [] : ["style"])],
    FORBID_ATTR: generated ? [] : ["style"],
  });
  const document = new DOMParser().parseFromString(clean, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || document.querySelector("parsererror")) return null;
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if ((name === "href" || name === "xlink:href") && !attribute.value.startsWith("#")) element.removeAttribute(attribute.name);
      if (name === "style") {
        const style = generated ? sanitizeGeneratedCss(attribute.value) : null;
        if (generated && style) attribute.value = style;
        else if (!generated || !style) element.removeAttribute(attribute.name);
      }
    }
    if (element.localName === "style") {
      const style = generated ? sanitizeGeneratedCss(element.textContent || "") : null;
      if (generated && style) element.textContent = style;
      else element.remove();
    }
  }
  return new XMLSerializer().serializeToString(root);
}

function sanitizeGeneratedCss(source: string): string {
  if (UNSAFE_CSS.test(source)) return "";
  return source.replace(CSS_URL, (_whole, quote: string, target: string) => {
    const value = target.trim();
    return /^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value) ? `url(${quote}${value}${quote})` : "none";
  });
}
