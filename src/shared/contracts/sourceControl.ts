import { z } from "zod";
import { MutationRequestSchema } from "./api.js";

const RelativeGitPathSchema = z.string().min(1).max(4_096).refine(
  (value) => !value.startsWith("/") && !value.split("/").includes("..") && !value.includes("\0"),
  "Git paths must stay inside the repository.",
);
const GitBranchNameSchema = z.string().trim().min(1).max(240).refine(
  (value) => !/[\u0000-\u001f\u007f]/.test(value),
  "Branch names contain invalid control characters.",
);
const WorktreeIdSchema = z.string().regex(/^[a-f0-9]{24}$/);
const SourceControlStateTokenSchema = z.string().regex(/^sc1_[A-Za-z0-9_-]{43}$/);

export interface SourceControlFile {
  path: string;
  previousPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface SourceControlBranch {
  name: string;
  current: boolean;
  upstream: string | null;
}

export interface SourceControlWorktree {
  id: string;
  label: string;
  branch: string | null;
  current: boolean;
  indexedProject: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface SourceControlSnapshot {
  scannedAt: string;
  projectId: string;
  stateToken: string;
  repository: boolean;
  writeLocked: boolean;
  headOid: string | null;
  branch: {
    current: string | null;
    detached: boolean;
    upstream: string | null;
    ahead: number;
    behind: number;
  };
  clean: boolean;
  files: SourceControlFile[];
  branches: SourceControlBranch[];
  remotes: string[];
  worktrees: SourceControlWorktree[];
  reason: string | null;
}

export interface SourceControlDiff {
  path: string;
  staged: boolean;
  patch: string;
  truncated: boolean;
}

export const SourceControlDiffQuerySchema = z.object({
  path: RelativeGitPathSchema,
  staged: z.union([z.literal("0"), z.literal("1")]).default("0"),
});

const PathsMutation = MutationRequestSchema.extend({
  paths: z.array(RelativeGitPathSchema).min(1).max(200),
  expectedStateToken: SourceControlStateTokenSchema,
});

const ExpectedState = {
  expectedStateToken: SourceControlStateTokenSchema,
};

export const SourceControlMutationSchema = z.discriminatedUnion("action", [
  PathsMutation.extend({ action: z.literal("stage") }),
  PathsMutation.extend({ action: z.literal("unstage") }),
  PathsMutation.extend({
    action: z.literal("discard"),
    paths: z.array(RelativeGitPathSchema).length(1),
    confirmation: z.literal("discard"),
  }),
  MutationRequestSchema.extend({
    action: z.literal("createAndCheckoutBranch"),
    requestedName: GitBranchNameSchema,
    collision: z.enum(["reject", "suffix"]),
    ...ExpectedState,
  }),
  MutationRequestSchema.extend({ action: z.literal("switchBranch"), name: GitBranchNameSchema, ...ExpectedState }),
  MutationRequestSchema.extend({
    action: z.literal("commit"),
    message: z.string().trim().min(1).max(10_000),
    includeUnstaged: z.boolean(),
    ...ExpectedState,
  }),
  MutationRequestSchema.extend({
    action: z.literal("push"),
    remote: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/).optional(),
    ...ExpectedState,
  }),
  MutationRequestSchema.extend({
    action: z.literal("removeWorktree"),
    worktreeId: WorktreeIdSchema,
    confirmation: z.literal("remove"),
    expectedStateToken: SourceControlStateTokenSchema,
  }),
  MutationRequestSchema.extend({
    action: z.literal("gcWorktrees"),
    expectedStateToken: SourceControlStateTokenSchema,
  }),
]);

export type SourceControlMutation = z.infer<typeof SourceControlMutationSchema>;
export type SourceControlMutationInput = SourceControlMutation extends infer Item
  ? Item extends { requestId: string }
    ? Omit<Item, "requestId">
    : never
  : never;

interface SourceControlReceiptBase<Action extends SourceControlMutation["action"]> {
  requestId: string;
  action: Action;
  completedAt: string;
}

export type SourceControlMutationReceipt =
  | (SourceControlReceiptBase<"stage"> & { paths: string[] })
  | (SourceControlReceiptBase<"unstage"> & { paths: string[] })
  | (SourceControlReceiptBase<"discard"> & { paths: string[] })
  | (SourceControlReceiptBase<"createAndCheckoutBranch"> & {
      branch: string;
      basedOnHead: string | null;
    })
  | (SourceControlReceiptBase<"switchBranch"> & {
      branch: string;
      headOid: string | null;
    })
  | (SourceControlReceiptBase<"commit"> & {
      branch: string | null;
      headOid: string;
      includeUnstaged: boolean;
    })
  | (SourceControlReceiptBase<"push"> & {
      branch: string;
      headOid: string;
      remote: string;
      upstream: string;
    })
  | (SourceControlReceiptBase<"removeWorktree"> & { worktreeId: string })
  | SourceControlReceiptBase<"gcWorktrees">;

export interface SourceControlMutationResult {
  receipt: SourceControlMutationReceipt;
  snapshot: SourceControlSnapshot | null;
  refreshRequired: boolean;
}
