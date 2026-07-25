import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { screen, type Rectangle } from "electron";

export const MIN_WINDOW_WIDTH = 720;
export const MIN_WINDOW_HEIGHT = 620;
export const MAX_WINDOW_COUNT = 12;

export interface SavedWindowState {
  windowId: string;
  route: string;
  bounds: Rectangle;
  maximized: boolean;
}

export function loadWindowStates(file: string, legacyFile?: string): SavedWindowState[] {
  const primary = readJson(file);
  if (primary) return parseWindowStates(primary);
  const legacy = legacyFile ? readJson(legacyFile) : null;
  const bounds = rectangle(legacy);
  return bounds ? [{ windowId: randomUUID(), route: "/new", bounds, maximized: false }] : [];
}

export function initialWindowBounds(saved?: Rectangle, ordinal = 0): Rectangle {
  if (saved && visibleOnAnyDisplay(saved)) return saved;
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1520, Math.max(980, Math.round(workArea.width * 0.84)));
  const height = Math.min(1040, Math.max(680, Math.round(workArea.height * 0.86)));
  const offset = Math.min(ordinal, 7) * 24;
  return {
    x: Math.min(workArea.x + workArea.width - width, Math.round(workArea.x + (workArea.width - width) / 2) + offset),
    y: Math.min(workArea.y + workArea.height - height, Math.round(workArea.y + (workArea.height - height) / 2) + offset),
    width,
    height,
  };
}

export function persistWindowStates(file: string, states: SavedWindowState[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 2, windows: states.slice(0, MAX_WINDOW_COUNT) }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function normalizedWindowRoute(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "/new";
  if (value === "/new" || /^\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  return /^\/settings(?:\/[a-z0-9_-]+){0,2}$/i.test(value) ? value : "/new";
}

function parseWindowStates(value: unknown): SavedWindowState[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { windows?: unknown }).windows)) {
    const bounds = rectangle(value);
    return bounds ? [{ windowId: randomUUID(), route: "/new", bounds, maximized: false }] : [];
  }
  return (value as { windows: unknown[] }).windows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const bounds = rectangle(record.bounds);
    if (!bounds) return [];
    const windowId = typeof record.windowId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.windowId) ? record.windowId : randomUUID();
    return [{ windowId, route: normalizedWindowRoute(record.route), bounds, maximized: record.maximized === true }];
  }).slice(0, MAX_WINDOW_COUNT);
}

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as unknown; }
  catch { return null; }
}

function rectangle(value: unknown): Rectangle | null {
  if (!value || typeof value !== "object") return null;
  const bounds = value as Partial<Rectangle>;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null;
  if (bounds.width! < MIN_WINDOW_WIDTH || bounds.height! < MIN_WINDOW_HEIGHT) return null;
  return bounds as Rectangle;
}

function visibleOnAnyDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapWidth = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const overlapHeight = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    return overlapWidth * overlapHeight >= 20_000;
  });
}
