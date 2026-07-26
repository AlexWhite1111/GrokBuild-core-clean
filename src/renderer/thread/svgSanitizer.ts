import DOMPurify from "dompurify";

const UNSAFE_CSS = /@import|expression\s*\(/i;
const CSS_URL = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi;

export function sanitizeSvgMarkup(markup: string, generated = false, generatedHtmlLabels = false): string | null {
  const policy = svgSanitizerPolicy(generated, generatedHtmlLabels);
  const clean = DOMPurify.sanitize(markup, {
    USE_PROFILES: policy.profiles,
    ADD_TAGS: policy.addedTags,
    HTML_INTEGRATION_POINTS: policy.htmlIntegrationPoints,
    FORBID_TAGS: policy.forbiddenTags,
    FORBID_ATTR: policy.forbiddenAttributes,
  });
  const document = new DOMParser().parseFromString(clean, policy.parseAsHtml ? "text/html" : "image/svg+xml");
  const root = policy.parseAsHtml ? document.querySelector("svg") : document.documentElement;
  if (!root || root.localName !== "svg" || (!policy.parseAsHtml && document.querySelector("parsererror"))) return null;
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

export function svgSanitizerPolicy(generated: boolean, generatedHtmlLabels: boolean) {
  const allowGeneratedHtmlLabels = generated && generatedHtmlLabels;
  return {
    allowGeneratedHtmlLabels,
    profiles: allowGeneratedHtmlLabels
      ? { html: true, mathMl: true, svg: true, svgFilters: true }
      : { svg: true, svgFilters: true },
    parseAsHtml: allowGeneratedHtmlLabels,
    addedTags: allowGeneratedHtmlLabels ? ["foreignObject"] : [],
    htmlIntegrationPoints: allowGeneratedHtmlLabels ? { foreignobject: true } : undefined,
    forbiddenTags: [
      "script", "iframe", "object", "embed", "image", "audio", "video",
      "form", "input", "button", "select", "textarea",
      ...(allowGeneratedHtmlLabels ? [] : ["foreignObject"]),
      ...(generated ? [] : ["style"]),
    ],
    forbiddenAttributes: generated ? [] : ["style"],
  };
}

function sanitizeGeneratedCss(source: string): string {
  if (UNSAFE_CSS.test(source)) return "";
  return source.replace(CSS_URL, (_whole, quote: string, target: string) => {
    const value = target.trim();
    return /^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value) ? `url(${quote}${value}${quote})` : "none";
  });
}
