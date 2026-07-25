import type { Express, Request } from "express";
import { PreviewPrepareRequestSchema } from "../../shared/contracts.js";
import type { PreviewRuntimeService } from "../preview/PreviewRuntimeService.js";
import { SANDBOX_RESOURCE_HEADERS } from "../security/sandboxResourceHeaders.js";

export function registerPreviewRuntimeRoutes(
  app: Express,
  runtime: PreviewRuntimeService,
  resolveWorkspace: (taskId?: string) => string,
): void {
  app.post("/api/v1/preview/prepare", async (req, res, next) => {
    try {
      const input = PreviewPrepareRequestSchema.parse(req.body);
      res.json(await runtime.prepare(input, resolveWorkspace(input.taskId)));
    } catch (error) { next(error); }
  });

  app.get("/preview-runtime/runtime.js", (_req, res) => {
    res.set({
      ...SANDBOX_RESOURCE_HEADERS,
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    }).send(runtime.runtime());
  });

  app.get("/preview-runtime/:hash/index.html", async (req, res, next) => {
    try {
      const html = await runtime.index(String(req.params.hash));
      res.set({
        ...SANDBOX_RESOURCE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
      }).send(html);
    } catch (error) { next(error); }
  });

  app.get("/preview-runtime/:hash/{*assetPath}", async (req, res, next) => {
    try {
      const asset = await runtime.asset(String(req.params.hash), wildcardPath(req));
      res.set({ ...SANDBOX_RESOURCE_HEADERS, "Content-Type": asset.contentType, "Cache-Control": asset.cacheControl });
      if (asset.kind === "body") {
        res.set("ETag", asset.etag).send(asset.body);
        return;
      }
      res.sendFile(asset.file, (error) => { if (error && !res.headersSent) next(error); });
    } catch (error) { next(error); }
  });
}

function wildcardPath(req: Request): string {
  const value = req.params.assetPath as string | string[] | undefined;
  return Array.isArray(value) ? value.join("/") : value || "";
}
