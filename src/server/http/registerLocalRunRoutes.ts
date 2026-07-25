import fs from "node:fs";
import type { Express } from "express";
import { z } from "zod";
import { LocalRunCancelSchema, LocalRunStartSchema } from "../../shared/contracts.js";
import type { InteractiveExportFormat, LocalRunService } from "../runtime/LocalRunService.js";
import { matplotlibInteractivePage } from "../runtime/MatplotlibInteractivePage.js";
import { IdempotencyStore } from "../security/idempotencyStore.js";
import { SANDBOX_RESOURCE_HEADERS } from "../security/sandboxResourceHeaders.js";
import { executeMutation } from "./idempotentMutation.js";

const IdSchema = z.string().uuid();
const FigureSchema = z.coerce.number().int().positive();
const ExportFormatSchema = z.enum(["png", "svg", "pdf"]);

export function registerLocalRunRoutes(app: Express, service: LocalRunService): void {
  const idempotency = new IdempotencyStore();
  app.post("/api/v1/local-runs/start", (req, res, next) =>
    executeMutation(req, res, next, LocalRunStartSchema, idempotency, (input) => service.start(input.code, input.workingDirectory, input.language)));
  app.get("/api/v1/local-runs/:runId", (req, res, next) => {
    try { res.json(service.get(IdSchema.parse(req.params.runId))); } catch (error) { next(error); }
  });
  app.post("/api/v1/local-runs/cancel", (req, res, next) =>
    executeMutation(req, res, next, LocalRunCancelSchema, idempotency, (input) => service.cancel(input.runId)));
  app.get("/api/v1/local-runs/:runId/artifacts/:artifactId", (req, res, next) => {
    try {
      const artifact = service.artifact(IdSchema.parse(req.params.runId), IdSchema.parse(req.params.artifactId));
      res.setHeader("Cache-Control", "no-store");
      res.type(artifact.mimeType);
      fs.createReadStream(artifact.path).on("error", next).pipe(res);
    } catch (error) { next(error); }
  });
  app.get("/internal/v1/local-runs/:runId/artifacts/:artifactId/path", (req, res, next) => {
    try {
      const artifact = service.artifact(IdSchema.parse(req.params.runId), IdSchema.parse(req.params.artifactId));
      res.json({ path: artifact.path });
    } catch (error) { next(error); }
  });
  app.get("/local-runs/:runId/interactive", (req, res, next) => {
    try {
      const runId = IdSchema.parse(req.params.runId);
      const token = queryToken(req.query.token);
      const figureId = FigureSchema.parse(req.query.figure);
      const snapshot = service.authorizeInteractive(runId, token, figureId);
      res.set({ ...SANDBOX_RESOURCE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).send(matplotlibInteractivePage({
        runId,
        token,
        figureId,
        detail: req.query.detail === "1",
        animated: snapshot.interactive?.animatedFigureIds.includes(figureId) === true,
      }));
    } catch (error) { next(error); }
  });
  app.get("/local-runs/:runId/interactive/mpl.js", (req, res, next) => {
    try {
      const file = service.interactiveJavaScript(IdSchema.parse(req.params.runId), queryToken(req.query.token));
      res.set({ ...SANDBOX_RESOURCE_HEADERS, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
      fs.createReadStream(file).on("error", next).pipe(res);
    } catch (error) { next(error); }
  });
  app.get("/local-runs/:runId/interactive/figures/:figureId/download.:format", async (req, res, next) => {
    try {
      const runId = IdSchema.parse(req.params.runId);
      const figureId = FigureSchema.parse(req.params.figureId);
      const format = ExportFormatSchema.parse(req.params.format) as InteractiveExportFormat;
      const exported = await service.exportInteractiveFigure(runId, queryToken(req.query.token), figureId, format);
      const contentType = exported.format === "svg" ? "image/svg+xml" : exported.format === "pdf" ? "application/pdf" : "image/png";
      res.set({
        ...SANDBOX_RESOURCE_HEADERS,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="figure-${figureId}.${exported.format}"`,
        "Cache-Control": "no-store",
      }).send(exported.body);
    } catch (error) { next(error); }
  });
}

function queryToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("Invalid interactive token.");
  return value;
}

