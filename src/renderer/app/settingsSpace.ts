export function isSettingsSpace(pathname: string): boolean {
  return /^\/(?:settings(?:\/|$)|automations(?:\/|$)|extensions(?:\/|$)|diagnostics(?:\/|$))/.test(pathname);
}
