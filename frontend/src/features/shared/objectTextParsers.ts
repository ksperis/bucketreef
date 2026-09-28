/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
// Parse quoted fields without interpreting markup or spreadsheet formulas.
export function parsePreviewCsv(text: string): string[][] {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (inQuotes && text[i + 1] === '"') { i++; continue; }
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (text[i] === "\n" || text[i] === "\r") break;
      if (text[i] in counts) counts[text[i]]++;
    }
  }
  const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const pushField = () => { row.push(field); field = ""; closed = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === delimiter) pushField();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error("Invalid CSV quoting");
      field += char;
    }
    if (rows.length > 2000 || row.length > 200) throw new Error("CSV table too large");
  }
  if (quoted) throw new Error("Unterminated CSV field");
  if (field || row.length || closed) pushRow();
  if (!rows.length || rows.some((entry) => entry.length !== rows[0].length)) {
    throw new Error("Inconsistent CSV columns");
  }
  return rows;
}

export function parsePreviewJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++nodes > 5000 || entry.depth > 32) throw new Error("JSON tree too large");
    if (entry.value && typeof entry.value === "object") {
      for (const child of Object.values(entry.value)) pending.push({ value: child, depth: entry.depth + 1 });
    }
  }
  return value;
}

export function truncatePreviewText(text: string, limit: number) {
  const bytes = new TextEncoder().encode(text);
  // Streaming decoding omits an incomplete UTF-8 code point at the byte boundary.
  return { content: new TextDecoder().decode(bytes.slice(0, limit), { stream: bytes.length > limit }), truncated: bytes.length > limit };
}
