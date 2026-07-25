import { randomUUID } from "node:crypto";
import { app, dialog, type BrowserWindow, type Event } from "electron";
import type { TaskListItem } from "../shared/contracts.js";
import type { BackendProcess } from "./BackendProcess.js";

export interface QuitCoordinator {
  relaunch(beforeRelaunch: () => void): Promise<boolean>;
}

export function installQuitCoordinator(
  backend: BackendProcess,
  window: () => BrowserWindow | null,
  beforeApprovedExit: () => void = () => undefined,
): QuitCoordinator {
  let approved = false;
  let checking = false;
  app.on("before-quit", (event) => {
    if (approved) {
      backend.stop();
      return;
    }
    event.preventDefault();
    if (checking) return;
    checking = true;
    void confirmQuit(event).finally(() => { checking = false; });
  });

  async function confirmQuit(_event: Event): Promise<void> {
    if (!await approveExit()) return;
    beforeApprovedExit();
    approved = true;
    backend.stop();
    app.quit();
  }

  async function approveExit(): Promise<boolean> {
    let tasks: TaskListItem[] = [];
    try {
      const response = await backend.request<{ tasks: TaskListItem[] }>("GET", "/api/v1/system/active-for-quit");
      tasks = response.tasks;
    } catch {
      // A stopped backend has no running agents to preserve.
    }
    if (tasks.length) {
      const target = window();
      const options = {
        type: "warning" as const,
        title: "Quit Grok Build?",
        message: `${tasks.length} task${tasks.length === 1 ? " is" : "s are"} still running or waiting for you.`,
        detail: tasks.slice(0, 8).map((task) => `• ${task.title}`).join("\n"),
        buttons: ["Keep Running", "Cancel Tasks and Quit"],
        defaultId: 0,
        cancelId: 0,
      };
      const result = target
        ? await dialog.showMessageBox(target, options)
        : await dialog.showMessageBox(options);
      if (result.response !== 1) return false;
    }
    try {
      await backend.request("POST", "/api/v1/system/prepare-quit", { requestId: randomUUID() });
    } catch {
      // The utility process is terminated below even if graceful preparation failed.
    }
    return true;
  }

  return {
    async relaunch(beforeRelaunch) {
      if (checking) return false;
      checking = true;
      try {
        if (!await approveExit()) return false;
        beforeApprovedExit();
        beforeRelaunch();
        approved = true;
        backend.stop();
        app.relaunch();
        app.quit();
        return true;
      } finally {
        checking = false;
      }
    },
  };
}
