import fs from "node:fs";
import type { Express, NextFunction, Request, Response } from "express";
import type { MediaArtifactStore, MediaPayload } from "../media/MediaArtifactStore.js";
import { mediaByteRange } from "../media/mediaRange.js";
import { AppProblem } from "../security/problemResponse.js";
import { isExactOrigin } from "../security/apiSecurity.js";

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function registerMediaRoutes(app: Express, media: MediaArtifactStore, expectedOrigin: string): void {
  app.get("/media/:ticket", (req, res, next) => serveMedia(req, res, next, media, expectedOrigin));
  app.head("/media/:ticket", (req, res, next) => serveMedia(req, res, next, media, expectedOrigin));
}

function isAllowedMediaRequest(req: Pick<Request, "get">, expectedOrigin: string): boolean {
  const referrer = req.get("referer");
  if (referrer) {
    try { if (isExactOrigin(new URL(referrer).origin, expectedOrigin)) return true; }
    catch { return false; }
  }
  const site = req.get("sec-fetch-site");
  const mode = req.get("sec-fetch-mode");
  const destination = req.get("sec-fetch-dest");
  return (site === "same-origin" || site === "same-site")
    && mode === "no-cors"
    && (destination === "image" || destination === "audio" || destination === "video");
}

function serveMedia(req: Request, res: Response, next: NextFunction, media: MediaArtifactStore, expectedOrigin: string): void {
  try {
    if (!isAllowedMediaRequest(req, expectedOrigin)) throw new AppProblem(403, "ORIGIN_REJECTED", "Media requests are restricted to the active local app.");
    const ticket = Array.isArray(req.params.ticket) ? req.params.ticket[0] : req.params.ticket;
    if (!TICKET_PATTERN.test(ticket)) throw new AppProblem(404, "NOT_FOUND", "Media lease is unknown.");
    const payload = media.resolveLease(ticket);
    const range = mediaByteRange(req.get("range"), payload.sizeBytes);
    applyMediaHeaders(res, payload, range);
    if (req.method === "HEAD") { res.end(); return; }
    if (range.partial) res.status(206);
    if (payload.bytes) { res.end(payload.bytes.subarray(range.start, range.end + 1)); return; }
    if (!payload.canonicalPath) throw new AppProblem(404, "NOT_FOUND", "Media source is unavailable.");
    const stream = fs.createReadStream(payload.canonicalPath, { start: range.start, end: range.end });
    stream.on("error", (error) => res.headersSent ? res.destroy(error) : next(error));
    stream.pipe(res);
  } catch (error) { next(error); }
}

function applyMediaHeaders(res: Response, payload: MediaPayload, range: ReturnType<typeof mediaByteRange>): void {
  res.setHeader("Content-Type", payload.mimeType);
  res.setHeader("Content-Length", String(range.length));
  res.setHeader("Accept-Ranges", "bytes");
  // Lease URLs are opaque, scoped, and short-lived. A small private cache lets
  // decoded media survive harmless renderer remounts without outliving the
  // backend's idle lease window or becoming shared cache content.
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(payload.name)}`);
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  if (range.partial) res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${payload.sizeBytes}`);
}
