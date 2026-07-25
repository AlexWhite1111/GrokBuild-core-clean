import type { Express } from "express";
import { z } from "zod";
import type { CapabilityRegistry } from "../grok/CapabilityRegistry.js";
import type { ManagementServices } from "../management/ManagementServices.js";
import { IdempotencyStore } from "../security/idempotencyStore.js";
import { executeMutation } from "./idempotentMutation.js";

const AuthStartSchema = z.object({ requestId: z.string().uuid(), action: z.enum(["login-oauth", "login-device"]) });
const JobCancelSchema = z.object({ requestId: z.string().uuid(), id: z.string().min(1).max(200) });
const HeadlessStartSchema = z.object({
  requestId: z.string().uuid(),
  prompt: z.string().min(1).max(100_000),
  permissionMode: z.enum(["default", "bypassPermissions"]).optional(),
  acknowledgeBypass: z.boolean().optional(),
}).passthrough();
const InputSchema = z.record(z.string().min(1).max(120), z.unknown()).refine((value) => Object.keys(value).length <= 100, "Too many input fields");
const PreviewSchema = z.object({ requestId: z.string().uuid(), input: InputSchema });
const ApplySchema = PreviewSchema.extend({ confirmation: z.string().min(1).max(2_000) });
const LogoutSchema = z.object({ requestId: z.string().uuid(), confirmation: z.literal("logout") });

export function registerManagementV1Routes(
  app: Express,
  services: ManagementServices,
  capabilities: CapabilityRegistry,
): void {
  const idempotency = new IdempotencyStore();
  app.get("/api/v1/management/account-status", async (_req, res, next) => {
    try {
      const snapshot = await capabilities.get();
      res.json(await services.account.accountStatus(snapshot.acp.authMethods));
    } catch (error) { next(error); }
  });
  app.get("/api/v1/management/account", async (_req, res, next) => {
    try {
      const snapshot = await capabilities.get();
      res.json(await services.account.snapshot(snapshot.acp.authMethods));
    } catch (error) { next(error); }
  });
  app.get("/api/v1/management/auth-job", (_req, res) => res.json({ job: services.auth.get() }));
  app.post("/api/v1/management/auth-job/start", (req, res, next) => executeMutation(req, res, next, AuthStartSchema, idempotency, (input) => ({ job: services.auth.start(input.action) })));
  app.post("/api/v1/management/auth-job/cancel", (req, res, next) => executeMutation(req, res, next, JobCancelSchema, idempotency, (input) => ({ job: services.auth.cancel(input.id) })));
  app.get("/api/v1/management/logout-preview", async (_req, res, next) => {
    try {
      const snapshot = await capabilities.get();
      const account = await services.account.snapshot(snapshot.acp.authMethods);
      res.json(await services.auth.logoutPreview(account.account.authenticated, account.account.authFile.credentialEntries));
    } catch (error) { next(error); }
  });
  app.post("/api/v1/management/logout", (req, res, next) => executeMutation(req, res, next, LogoutSchema, idempotency, async (input) => ({ result: await services.auth.logout(input.confirmation), capabilities: await capabilities.refresh() })));

  app.get("/api/v1/management/custom-models", async (_req, res, next) => {
    try { res.json(await services.customModels.inventory()); } catch (error) { next(error); }
  });
  app.post("/api/v1/management/custom-models/preview", (req, res, next) => executeMutation(req, res, next, PreviewSchema, idempotency, (value) => services.customModels.preview(value.input)));
  app.post("/api/v1/management/custom-models/apply", (req, res, next) => executeMutation(req, res, next, ApplySchema, idempotency, async (value) => ({ result: await services.customModels.apply(value.input, value.confirmation), capabilities: await capabilities.refresh() })));
  app.get("/api/v1/management/custom-models/:name/diagnose", async (req, res, next) => {
    try { res.json(await services.customModels.diagnose(req.params.name)); } catch (error) { next(error); }
  });
  app.get("/api/v1/management/memory", async (_req, res, next) => {
    try { res.json(await services.memory.inventory()); } catch (error) { next(error); }
  });
  app.get("/api/v1/management/memory/search", async (req, res, next) => {
    try { res.json(await services.memory.search(req.query.query)); } catch (error) { next(error); }
  });
  app.get("/api/v1/management/memory/file/:id", async (req, res, next) => {
    try { res.json(await services.memory.previewFile(req.params.id)); } catch (error) { next(error); }
  });
  app.post("/api/v1/management/memory/preview", (req, res, next) => executeMutation(req, res, next, PreviewSchema, idempotency, (value) => services.memory.previewMutation(value.input)));
  app.post("/api/v1/management/memory/apply", (req, res, next) => executeMutation(req, res, next, ApplySchema, idempotency, async (value) => ({ result: await services.memory.applyMutation(value.input, value.confirmation), capabilities: await capabilities.refresh() })));
  app.get("/api/v1/management/config", async (_req, res, next) => {
    try { res.json(await services.config.inventory()); } catch (error) { next(error); }
  });
  app.post("/api/v1/management/config/preview", (req, res, next) => executeMutation(req, res, next, PreviewSchema, idempotency, (value) => services.config.preview(value.input)));
  app.post("/api/v1/management/config/apply", (req, res, next) => executeMutation(req, res, next, ApplySchema, idempotency, async (value) => ({ result: await services.config.apply(value.input, value.confirmation), capabilities: await capabilities.refresh() })));
  app.get("/api/v1/management/extensions", async (_req, res, next) => {
    try { res.json(await services.extensions.inventory()); } catch (error) { next(error); }
  });
  app.get("/api/v1/management/marketplace", async (req, res, next) => {
    try { res.json(await services.extensions.catalog(req.query.refresh === "true")); } catch (error) { next(error); }
  });
  app.get("/api/v1/management/extensions/mcp/doctor", async (req, res, next) => {
    try { res.json(await services.extensions.doctor(typeof req.query.name === "string" ? req.query.name : undefined)); } catch (error) { next(error); }
  });
  app.get("/api/v1/management/extensions/mcp/:name", async (req, res, next) => {
    try { res.json(await services.extensions.mcpDetail(req.params.name, req.query.scope)); } catch (error) { next(error); }
  });
  app.get("/api/v1/management/extensions/document/:id", async (req, res, next) => {
    try { res.json(await services.extensions.document(req.params.id)); } catch (error) { next(error); }
  });
  app.post("/api/v1/management/extensions/plugin/preview", (req, res, next) => executeMutation(req, res, next, PreviewSchema, idempotency, (value) => services.extensions.previewPlugin(value.input)));
  app.post("/api/v1/management/extensions/plugin/apply", (req, res, next) => executeMutation(req, res, next, ApplySchema, idempotency, async (value) => ({ result: await services.extensions.applyPlugin(value.input, value.confirmation), capabilities: await capabilities.refresh() })));
  app.post("/api/v1/management/extensions/mcp/preview", (req, res, next) => executeMutation(req, res, next, PreviewSchema, idempotency, (value) => services.extensions.previewMcp(value.input)));
  app.post("/api/v1/management/extensions/mcp/apply", (req, res, next) => executeMutation(req, res, next, ApplySchema, idempotency, async (value) => ({ result: await services.extensions.applyMcp(value.input, value.confirmation), capabilities: await capabilities.refresh() })));
  app.post("/api/v1/management/extensions/document/preview", (req, res, next) => executeMutation(req, res, next, PreviewSchema, idempotency, (value) => services.extensions.previewDocument(value.input)));
  app.post("/api/v1/management/extensions/document/apply", (req, res, next) => executeMutation(req, res, next, ApplySchema, idempotency, async (value) => ({ result: await services.extensions.applyDocument(value.input, value.confirmation), capabilities: await capabilities.refresh() })));
  app.get("/api/v1/management/runtime", async (_req, res, next) => {
    try { res.json(await services.runtime.snapshot()); } catch (error) { next(error); }
  });
  app.post("/api/v1/management/runtime/preview", (req, res, next) => executeMutation(req, res, next, PreviewSchema, idempotency, (value) => services.runtime.preview(value.input)));
  app.post("/api/v1/management/runtime/apply", (req, res, next) => executeMutation(req, res, next, ApplySchema, idempotency, async (value) => ({ result: await services.runtime.apply(value.input, value.confirmation), capabilities: await capabilities.refresh() })));
  app.get("/api/v1/management/headless", (_req, res) => res.json({ job: services.headless.get() }));
  app.post("/api/v1/management/headless/start", (req, res, next) => executeMutation(req, res, next, HeadlessStartSchema, idempotency, (input) => {
    const { requestId: _requestId, ...options } = input;
    return { job: services.headless.start(options) };
  }));
  app.post("/api/v1/management/headless/cancel", (req, res, next) => executeMutation(req, res, next, JobCancelSchema, idempotency, (input) => ({ job: services.headless.cancel(input.id) })));
}
