const protectedSyntax = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`+[^`\n]*`+|!?\[[^\]\n]*\]\([^\n)]*\)|<!--[\s\S]*?-->|<\/?[A-Za-z][^>\n]*>)/g;
const protectedBlock = /@@GROK_MATH_BLOCK_(\d+)@@/g;

/** Normalizes TeX delimiters commonly emitted by Grok without touching code or HTML. */
export function normalizeMathDelimiters(markdown: string): string {
  return markdown.split(protectedSyntax).map((segment, index) => index % 2 ? segment : normalizeProse(segment)).join("");
}

function normalizeProse(source: string): string {
  const blocks: string[] = [];
  const protect = (body: string) => {
    const index = blocks.push(body.trim()) - 1;
    return `@@GROK_MATH_BLOCK_${index}@@`;
  };
  let value = source.replace(/\\\[([\s\S]*?)\\\]/g, (_whole, body: string) => protect(body));
  value = value.replace(/^[\t ]*\[\s*(.+?)\s*\][\t ]*$/gm, (whole, body: string) => isLikelyDisplayMath(body) ? protect(body) : whole);
  value = value.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|@@GROK_MATH_BLOCK_\d+@@)/g).map((part) => {
    if (!part || part.startsWith("$") || /^@@GROK_MATH_BLOCK_\d+@@$/.test(part)) return part;
    const explicit = part.replace(/\\\((.+?)\\\)/g, (_whole, body: string) => `$${body.trim()}$`);
    return explicit.replace(/\(([^()\n]{1,160})\)/g, (whole, body: string) => isLikelyInlineMath(body) ? `$${body.trim()}$` : whole);
  }).join("");
  return value.replace(protectedBlock, (_whole, index: string) => `\n\n$$\n${blocks[Number(index)] || ""}\n$$\n\n`);
}

function isLikelyInlineMath(body: string): boolean {
  const value = body.trim();
  if (!value || /https?:|www\.|[<>]/i.test(value)) return false;
  if (/^\d{1,3}$/.test(value) || /^[A-Za-z]$/.test(value) || /^[α-ωΑ-Ω]$/.test(value)) return true;
  return /\\[A-Za-z]+|[_^=]|(?:<=|>=|→|←|≈|≠|±|×|÷)/.test(value);
}

function isLikelyDisplayMath(body: string): boolean {
  const value = body.trim();
  return value.length > 2 && /\\[A-Za-z]+|[_^=]|(?:<=|>=|→|←|≈|≠|±|×|÷)/.test(value);
}
