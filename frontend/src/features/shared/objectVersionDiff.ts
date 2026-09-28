/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type VersionDiffLine = { kind: "equal" | "added" | "removed"; text: string };

// Bounded LCS: retain common edges, and use a changed block for a large middle.
// A coarse block is still lossless: replaying removals/additions reconstructs either source.
export function objectVersionDiff(before: string, after: string): VersionDiffLine[] {
  const a = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const b = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const result: VersionDiffLine[] = a.slice(0, start).map(text => ({ kind: "equal", text }));
  const left = a.slice(start, a.length - end), right = b.slice(start, b.length - end);
  if ((left.length + 1) * (right.length + 1) > 2_000_000) {
    for (const text of left) result.push({ kind: "removed", text });
    for (const text of right) result.push({ kind: "added", text });
  } else {
    const width = right.length + 1;
    const lengths = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
      lengths[i * width + j] = left[i] === right[j] ? 1 + lengths[(i + 1) * width + j + 1] : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
    let i = 0, j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { result.push({ kind: "equal", text: left[i++] }); j++; }
      else if (i < left.length && (j === right.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) result.push({ kind: "removed", text: left[i++] });
      else result.push({ kind: "added", text: right[j++] });
    }
  }
  return result.concat(a.slice(a.length - end).map(text => ({ kind: "equal" as const, text })));
}
