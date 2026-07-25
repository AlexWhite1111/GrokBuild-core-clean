import type { SVGProps } from "react";

/** Conversation branching mark: deliberately node-free so it is not confused
 * with the Git fork/branch family of icons used by Source Control. */
export function ConversationForkIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M3.5 2.25v5.7c0 3.15 1.85 5.05 5.05 5.05h3.9" />
    <path d="M3.5 6.35h2.15c3.05 0 4.65-1.35 4.65-4.1" />
    <path d="M8.55 2.25h3.5" />
  </svg>;
}
