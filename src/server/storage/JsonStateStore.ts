import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

interface StateDocument {
  version: 1;
  values: Record<string, unknown>;
}

/** Small atomic store for app preferences only. Conversation data never belongs here. */
export class JsonStateStore {
  #document: StateDocument;

  constructor(private readonly file: string) {
    this.#document = this.#read();
  }

  get<T>(key: string): T | undefined {
    return structuredClone(this.#document.values[key]) as T | undefined;
  }

  set(key: string, value: unknown): void {
    const next = structuredClone(value);
    if (isDeepStrictEqual(this.#document.values[key], next)) return;
    this.#document.values[key] = next;
    this.#write();
  }

  delete(key: string): void {
    if (!(key in this.#document.values)) return;
    delete this.#document.values[key];
    this.#write();
  }

  entries<T>(prefix: string): Array<[string, T]> {
    return Object.entries(this.#document.values)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key, structuredClone(value) as T]);
  }

  update<T>(key: string, change: (current: T | undefined) => T | undefined): T | undefined {
    const next = change(this.get<T>(key));
    if (next === undefined) this.delete(key);
    else this.set(key, next);
    return next;
  }

  #read(): StateDocument {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<StateDocument>;
      if (parsed.version === 1 && parsed.values && typeof parsed.values === "object" && !Array.isArray(parsed.values)) {
        return { version: 1, values: parsed.values };
      }
    } catch {
      // Missing or invalid state falls back to clean defaults.
    }
    return { version: 1, values: {} };
  }

  #write(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(this.#document, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      fs.renameSync(temporary, this.file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
}
