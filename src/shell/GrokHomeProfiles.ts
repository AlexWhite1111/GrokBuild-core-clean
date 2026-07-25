import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GrokHomeProfileStatus, GrokHomeProfileSummary } from "../shared/contracts.js";

interface StoredProfiles {
  version: 1;
  activePath: string;
  customPaths: string[];
}

export interface ActiveGrokHomeProfile {
  grokHome: string;
  appHome: string;
  summary: GrokHomeProfileSummary;
}

export class GrokHomeProfiles {
  readonly #file: string;
  readonly #nativeHome: string;
  readonly #legacyHome: string;
  #state: StoredProfiles;

  constructor(private readonly shellHome: string, home = os.homedir()) {
    this.#file = path.join(shellHome, "grok-home-profiles.json");
    this.#nativeHome = canonicalExistingDirectory(path.join(home, ".grok"));
    this.#legacyHome = path.join(shellHome, "grok-home");
    this.#state = this.#read();
  }

  active(): ActiveGrokHomeProfile {
    let activePath = canonicalDirectory(this.#state.activePath);
    if (!isDirectory(activePath)) {
      activePath = this.#nativeHome;
      this.#state = { ...this.#state, activePath };
      this.#write();
    }
    const summary = this.#summary(activePath, true);
    return {
      grokHome: activePath,
      appHome: this.shellHome,
      summary,
    };
  }

  status(): GrokHomeProfileStatus {
    const active = this.active().summary;
    const paths = uniquePaths([this.#nativeHome, active.path, ...this.#state.customPaths])
      .filter((item) => !samePath(item, this.#legacyHome) || samePath(item, active.path));
    return {
      activeId: active.id,
      profiles: paths.map((item) => this.#summary(item, samePath(item, active.path))),
    };
  }

  select(profileId: string): boolean {
    const profile = this.status().profiles.find((item) => item.id === profileId);
    if (!profile || !profile.available) throw new Error("The selected Grok Home is not available.");
    if (profile.active) return false;
    this.#state = { ...this.#state, activePath: profile.path };
    this.#write();
    return true;
  }

  registerAndSelect(directory: string): boolean {
    const selected = canonicalExistingDirectory(directory);
    const paths = uniquePaths([...this.#state.customPaths, selected]);
    const changed = !samePath(selected, this.active().grokHome);
    this.#state = { version: 1, activePath: selected, customPaths: paths.filter((item) => !samePath(item, this.#nativeHome)) };
    this.#write();
    return changed;
  }

  #read(): StoredProfiles {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#file, "utf8")) as Partial<StoredProfiles>;
      const activePath = typeof parsed.activePath === "string" ? canonicalDirectory(parsed.activePath) : this.#nativeHome;
      const customPaths = Array.isArray(parsed.customPaths)
        ? parsed.customPaths.filter((item): item is string => typeof item === "string").map(canonicalDirectory)
        : [];
      return {
        version: 1,
        activePath,
        customPaths: uniquePaths(customPaths).filter((item) => !samePath(item, this.#legacyHome)),
      };
    } catch {
      return { version: 1, activePath: this.#nativeHome, customPaths: [] };
    }
  }

  #write(): void {
    fs.mkdirSync(this.shellHome, { recursive: true, mode: 0o700 });
    const temporary = `${this.#file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.#file);
  }

  #summary(directory: string, active: boolean): GrokHomeProfileSummary {
    const canonical = canonicalDirectory(directory);
    const kind = samePath(canonical, this.#nativeHome)
      ? "native"
      : samePath(canonical, this.#legacyHome) ? "legacy" : "custom";
    return {
      id: kind === "native" ? "native" : `custom-${digest(canonical)}`,
      kind,
      path: canonical,
      active,
      available: isDirectory(canonical),
    };
  }

}

function canonicalExistingDirectory(directory: string): string {
  const resolved = canonicalDirectory(directory);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const stats = fs.statSync(resolved);
  if (!stats.isDirectory()) throw new Error("A Grok Home must be a directory.");
  return fs.realpathSync.native(resolved);
}

function canonicalDirectory(directory: string): string {
  if (!directory || !path.isAbsolute(directory)) throw new Error("A Grok Home path must be absolute.");
  return path.resolve(directory);
}

function isDirectory(directory: string): boolean {
  try { return fs.statSync(directory).isDirectory(); }
  catch { return false; }
}

function samePath(left: string, right: string): boolean {
  return canonicalComparisonPath(left) === canonicalComparisonPath(right);
}

function canonicalComparisonPath(directory: string): string {
  const resolved = canonicalDirectory(directory);
  try { return fs.realpathSync.native(resolved); }
  catch { return resolved; }
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((item) => {
    const key = canonicalDirectory(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
