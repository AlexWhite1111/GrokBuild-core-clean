const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

export function terminalDimensions(columns: number, rows: number): { columns: number; rows: number } {
  return {
    columns: boundedInteger(columns, DEFAULT_COLUMNS, 20, 320),
    rows: boundedInteger(rows, DEFAULT_ROWS, 5, 120),
  };
}

function boundedInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum) return fallback;
  return Math.min(maximum, value);
}
