import { z } from "zod";
import { NewTaskDraftKeySchema } from "./task.js";

export const TextClipOwnerKeySchema = z.union([
  z.string().regex(/^task:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  NewTaskDraftKeySchema,
]);
export const TextClipReferenceIdSchema = z.string().uuid();

const TextClipAuthorityOwnerSchema = z.object({
  ownerKey: TextClipOwnerKeySchema,
  refIds: z.array(TextClipReferenceIdSchema).max(10_000),
}).strict();

/**
 * The backend's durable view of live text-clip references. Filesystem paths
 * stay in the shell; only opaque owner and path-reference IDs cross the route.
 */
export const TextClipAuthoritySnapshotSchema = z.object({
  version: z.literal(1),
  owners: z.array(TextClipAuthorityOwnerSchema).max(10_000),
}).strict();

export type TextClipAuthoritySnapshot = z.infer<typeof TextClipAuthoritySnapshotSchema>;
