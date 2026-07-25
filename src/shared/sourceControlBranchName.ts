const DEFAULT_PREFIX = "grok";
const MAX_BRANCH_LENGTH = 220;

/**
 * Produces a stable, user-editable Git branch suggestion. Git remains the
 * authority: the backend validates the final value with check-ref-format.
 */
export function suggestSourceControlBranchName(
  taskTitle: string,
  taskId: string,
  prefix = DEFAULT_PREFIX,
): string {
  const safePrefix = branchComponent(prefix) || DEFAULT_PREFIX;
  const safeTitle = branchComponent(taskTitle) || "task";
  const shortId = taskId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "task";
  const reserved = safePrefix.length + shortId.length + 2;
  const title = safeTitle.slice(0, Math.max(1, MAX_BRANCH_LENGTH - reserved)).replace(/[-.]+$/g, "") || "task";
  return `${safePrefix}/${title}-${shortId}`;
}

function branchComponent(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/@\{/g, "-")
    .replace(/\.\.+/g, "-")
    .replace(/[\u0000-\u0020\u007f~^:?*\[\]\\/]+/g, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/[-._]{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .replace(/\.lock$/i, "-lock");
}
