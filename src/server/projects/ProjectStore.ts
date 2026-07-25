import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ProjectDefaultsSchema,
  type ProjectDefaults,
  type ProjectSummary,
} from "../../shared/contracts.js";
import { AppProblem } from "../security/problemResponse.js";
import type { JsonStateStore } from "../storage/JsonStateStore.js";

interface StoredProject {
  projectId: string;
  canonicalPath: string;
  displayPath: string;
  name: string;
  active: boolean;
  updatedAt: string;
  defaults: ProjectDefaults;
}

const DEFAULTS: ProjectDefaults = {
  modelId: null,
  effort: null,
  workMode: "normal",
  permission: "ask",
  sandbox: "workspace",
  systemPromptPresetId: null,
};

export class ProjectStore {
  constructor(private readonly state: JsonStateStore) {}

  addProject(directory: string, name?: string): ProjectSummary {
    const canonicalPath = this.#canonicalDirectory(directory);
    const existing = this.#projects().find((project) => project.canonicalPath === canonicalPath);
    if (existing) return this.activate(existing.projectId);
    const now = new Date().toISOString();
    const project: StoredProject = {
      projectId: `project_${createHash("sha256").update(canonicalPath).digest("hex").slice(0, 24)}`,
      canonicalPath,
      displayPath: this.#displayPath(canonicalPath),
      name: name?.trim() || path.basename(canonicalPath) || "Project",
      active: true,
      updatedAt: now,
      defaults: { ...DEFAULTS },
    };
    this.#save([...this.#projects().map((item) => ({ ...item, active: false })), project]);
    return this.#summary(project);
  }

  list(): ProjectSummary[] {
    return this.#projects()
      .sort((left, right) => Number(right.active) - Number(left.active) || right.updatedAt.localeCompare(left.updatedAt))
      .map((project) => this.#summary(project));
  }

  get(projectId: string): ProjectSummary {
    return this.#summary(this.#required(projectId));
  }

  getCanonicalPath(projectId: string): string {
    return this.#required(projectId).canonicalPath;
  }

  projectIdForCanonicalPath(directory: string): string | null {
    let canonicalPath: string;
    try { canonicalPath = fs.realpathSync.native(directory); } catch { return null; }
    return this.#projects().find((project) => project.canonicalPath === canonicalPath)?.projectId ?? null;
  }

  hasCanonicalPath(directory: string): boolean {
    return this.projectIdForCanonicalPath(directory) !== null;
  }

  activate(projectId: string): ProjectSummary {
    const projects = this.#projects();
    const project = projects.find((item) => item.projectId === projectId);
    if (!project) throw new AppProblem(404, "NOT_FOUND", "Project not found.");
    const now = new Date().toISOString();
    for (const item of projects) {
      item.active = item === project;
      if (item === project) item.updatedAt = now;
    }
    this.#save(projects);
    return this.#summary(project);
  }

  remove(projectId: string): void {
    const remaining = this.#projects().filter((project) => project.projectId !== projectId);
    if (remaining.length && !remaining.some((project) => project.active)) remaining[0]!.active = true;
    this.#save(remaining);
  }

  updateDefaults(projectId: string, defaults: ProjectDefaults): ProjectSummary {
    const projects = this.#projects();
    const project = projects.find((item) => item.projectId === projectId);
    if (!project) throw new AppProblem(404, "NOT_FOUND", "Project not found.");
    project.defaults = ProjectDefaultsSchema.parse(defaults);
    project.updatedAt = new Date().toISOString();
    this.#save(projects);
    return this.#summary(project);
  }

  createHandle(): string {
    return randomUUID();
  }

  #projects(): StoredProject[] {
    const values = this.state.get<StoredProject[]>("projects");
    return Array.isArray(values) ? structuredClone(values) : [];
  }

  #save(projects: StoredProject[]): void {
    this.state.set("projects", projects);
  }

  #required(projectId: string): StoredProject {
    const project = this.#projects().find((item) => item.projectId === projectId);
    if (!project) throw new AppProblem(404, "NOT_FOUND", "Project not found.");
    return project;
  }

  #canonicalDirectory(directory: string): string {
    try {
      const real = fs.realpathSync.native(path.resolve(directory));
      if (fs.statSync(real).isDirectory()) return real;
    } catch {
      // Converted to a public path error below.
    }
    throw new AppProblem(400, "PATH_REJECTED", "The selected project directory does not exist.");
  }

  #displayPath(directory: string): string {
    const home = os.homedir();
    return directory === home || directory.startsWith(`${home}${path.sep}`)
      ? `~${directory.slice(home.length)}`
      : directory;
  }

  #summary(project: StoredProject): ProjectSummary {
    return {
      projectId: project.projectId,
      name: project.name,
      displayPath: project.displayPath,
      active: project.active,
      taskCount: 0,
      updatedAt: project.updatedAt,
      defaults: ProjectDefaultsSchema.parse(project.defaults),
    };
  }
}
