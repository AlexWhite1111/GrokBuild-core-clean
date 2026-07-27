const protectedSyntax = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`+[^`\n]*`+|!?\[[^\]\n]*\]\([^\n)]*\)|<!--[\s\S]*?-->|<\/?[A-Za-z][^>\n]*>|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g;
const explicitMath = /(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]|(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g;

/**
 * Converts Grok's explicit TeX delimiters to remark-math syntax without
 * changing source length. Code, HTML, links, and existing dollar math retain
 * their canonical ownership and plain parentheses are never guessed as math.
 */
export function normalizeMathDelimiters(markdown: string): string {
  return markdown.split(protectedSyntax).map((segment, index) =>
    index % 2 ? segment : segment.replace(
      explicitMath,
      (_whole, display: string | undefined, inline: string | undefined) =>
        display !== undefined ? `$$${display}$$` : `$ ${inline || ""} $`,
    )).join("");
}
