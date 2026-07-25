const COLLAPSED_OPTION_LINES = 3;
const PROTECTED_CONTEXT_LINES = 6;

export interface QuestionOptionLayoutInput {
  viewportHeight: number;
  headerHeight: number;
  tabsHeight: number;
  noteHeight: number;
  lineHeight: number;
}

export function expandedOptionHeight(input: QuestionOptionLayoutInput): number {
  const lineHeight = Math.max(1, input.lineHeight);
  const panelBudget = Math.max(1, Math.min(680, input.viewportHeight - 12));
  const fixedHeight = Math.max(0, input.headerHeight) + Math.max(0, input.tabsHeight) + Math.max(0, input.noteHeight) + 18;
  const protectedContext = lineHeight * PROTECTED_CONTEXT_LINES;
  return Math.max(lineHeight * COLLAPSED_OPTION_LINES, Math.floor(panelBudget - fixedHeight - protectedContext));
}
