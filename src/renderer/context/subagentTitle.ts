export function localizedSubagentTitle(title: string | null | undefined, fallback: string): string {
  const value = title?.trim();
  return value && !/^sub[\s-]*agent$/i.test(value) ? value : fallback;
}
