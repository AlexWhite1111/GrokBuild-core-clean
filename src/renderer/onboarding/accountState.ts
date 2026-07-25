import type { AccountModelSnapshot, AccountStatusSnapshot } from "../../shared/contracts.js";

export type AccountViewState = "loading" | "authenticated" | "unauthenticated" | "error";

export function accountViewState(
  status: AccountStatusSnapshot | undefined,
  full: AccountModelSnapshot | undefined,
  fullPending: boolean,
  fullError: boolean,
): AccountViewState {
  if (status?.account.authenticated || full?.account.authenticated) return "authenticated";
  if (fullError) return "error";
  if (fullPending || !full) return "loading";
  return "unauthenticated";
}

export function effectiveAccount(
  status: AccountStatusSnapshot,
  full: AccountModelSnapshot | undefined,
): AccountModelSnapshot["account"] {
  return full?.account.authenticated ? full.account : status.account;
}
