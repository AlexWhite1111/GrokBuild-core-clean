import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { ApiProblem } from "../../shared/contracts.js";

const LAUNCH_TOKEN_HEADER = "x-grok-build-launch-token";

export interface ApiSecurityOptions {
  expectedOrigin: string;
  launchToken: string;
}

export function isExactOrigin(origin: string | undefined, expectedOrigin: string): boolean {
  if (!origin) return false;
  try {
    const actual = new URL(origin);
    const expected = new URL(expectedOrigin);
    return actual.origin === expected.origin
      && actual.protocol === "http:"
      && actual.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Accepts the opaque origin used by a sandboxed iframe. Callers must also validate a strong per-resource token. */
export function isTokenGatedPreviewOrigin(origin: string | undefined, expectedOrigin: string): boolean {
  return origin === "null" || isExactOrigin(origin, expectedOrigin);
}

export function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate || !expected) return false;
  const actualBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length
    && timingSafeEqual(actualBytes, expectedBytes);
}

export function requireApiSecurity(options: ApiSecurityOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.get("origin") || readOnlyReferrerOrigin(req);
    if (!isExactOrigin(origin, options.expectedOrigin)) {
      sendProblem(res, 403, "ORIGIN_REJECTED", "The request origin is not the active app origin.");
      return;
    }
    if (!tokenMatches(req.get(LAUNCH_TOKEN_HEADER), options.launchToken)) {
      sendProblem(res, 401, "AUTH_REQUIRED", "The launch token is missing or no longer valid.");
      return;
    }
    next();
  };
}

function readOnlyReferrerOrigin(req: Request): string | undefined {
  if (req.method !== "GET" && req.method !== "HEAD") return undefined;
  if (req.get("sec-fetch-site") !== "same-origin") return undefined;
  const referrer = req.get("referer");
  if (referrer) {
    try { return new URL(referrer).origin; }
    catch { return undefined; }
  }
  const host = req.get("host");
  return host ? `http://${host}` : undefined;
}

function sendProblem(
  res: Response,
  status: number,
  code: "ORIGIN_REJECTED" | "AUTH_REQUIRED",
  detail: string,
): void {
  const problem: ApiProblem = {
    type: `grok-build:${code.toLowerCase()}` as ApiProblem["type"],
    title: status === 401 ? "Authentication required" : "Origin rejected",
    status,
    code,
    detail,
  };
  res.status(status).type("application/problem+json").json(problem);
}
