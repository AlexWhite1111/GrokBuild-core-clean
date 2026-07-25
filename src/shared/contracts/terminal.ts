import { z } from "zod";

const TerminalShellSchema = z.enum(["bash", "sh", "zsh"]);
export type TerminalShell = z.infer<typeof TerminalShellSchema>;

export const TerminalRunRequestSchema = z.object({
  shell: TerminalShellSchema,
  code: z.string().min(1).max(1_000_000),
});
export type TerminalRunRequest = z.infer<typeof TerminalRunRequestSchema>;
