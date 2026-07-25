import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

export interface ApplicationMenuActions {
  window: () => BrowserWindow | null;
  newWindow: () => void;
  newTask: () => void;
  openProject: () => void;
  toggleSidebar: () => void;
  commandPalette: () => void;
}

export function installApplicationMenu(actions: ApplicationMenuActions): void {
  const send = (channel: string) => actions.window()?.webContents.send(channel);
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Grok Build",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "CommandOrControl+,", click: () => send("grok-shell:settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Window", accelerator: "CommandOrControl+Shift+N", click: actions.newWindow },
        { label: "New Task", accelerator: "CommandOrControl+N", click: actions.newTask },
        { label: "Open Project…", accelerator: "CommandOrControl+O", click: actions.openProject },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
        { type: "separator" },
        { label: "Command Palette…", accelerator: "CommandOrControl+K", click: actions.commandPalette },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Sidebar", accelerator: "CommandOrControl+Shift+S", click: actions.toggleSidebar },
        { type: "separator" },
        { role: "reload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
