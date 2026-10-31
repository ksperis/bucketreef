export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampPercentage(value: number): number {
  return clampNumber(value, 0, 100);
}

export function clampedPercentageOf(
  value?: number | null,
  total?: number | null,
): number | null {
  if (value == null || total == null || total <= 0) return null;
  return clampPercentage((value / total) * 100);
}
