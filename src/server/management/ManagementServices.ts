import { AccountModelService } from "../account/AccountModelService.js";
import { AuthJobService } from "../account/AuthJobService.js";
import { GrokRunner } from "../cli/GrokRunner.js";
import { ExtensionInventoryService } from "../extensions/ExtensionInventoryService.js";
import { MemoryService } from "../memory/MemoryService.js";
import { CustomModelService } from "../models/CustomModelService.js";
import { HeadlessRunService } from "../runtime/HeadlessRunService.js";
import { RuntimeCliService } from "../runtime/RuntimeCliService.js";
import { ConfigService } from "../settings/ConfigService.js";
import type { WorkspaceSource } from "../projects/workspaceSource.js";
import type { OwnedProcessRegistry } from "../runtime/OwnedProcessRegistry.js";

export interface ManagementServices {
  account: AccountModelService;
  auth: AuthJobService;
  customModels: CustomModelService;
  memory: MemoryService;
  config: ConfigService;
  headless: HeadlessRunService;
  runtime: RuntimeCliService;
  extensions: ExtensionInventoryService;
  stop(): void;
}

export function createManagementServices(
  binary: string,
  workspace: WorkspaceSource,
  grokHome: string,
  processes?: OwnedProcessRegistry,
): ManagementServices {
  const auth = new AuthJobService(binary, workspace, grokHome, processes);
  const headless = new HeadlessRunService(binary, workspace, grokHome, processes);
  return {
    account: new AccountModelService(new GrokRunner(binary, processes), workspace, grokHome),
    auth,
    customModels: new CustomModelService(binary, workspace, grokHome, processes),
    memory: new MemoryService(binary, workspace, grokHome, process.env, processes),
    config: new ConfigService(grokHome),
    headless,
    runtime: new RuntimeCliService(binary, workspace, grokHome, processes),
    extensions: new ExtensionInventoryService(binary, workspace, grokHome, undefined, processes),
    stop() { auth.stop(); headless.stop(); },
  };
}
