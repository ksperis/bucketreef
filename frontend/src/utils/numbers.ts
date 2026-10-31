export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampedPercentageOf(
  value?: number | null,
  total?: number | null,
): number | null {
  if (value == null || total == null || total <= 0) return null;
  return clampNumber((value / total) * 100, 0, 100);
}
