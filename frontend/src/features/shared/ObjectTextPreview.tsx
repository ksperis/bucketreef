/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Fragment, useMemo, useState } from "react";
import UiButton from "../../components/ui/UiButton";
import { useI18n } from "../../i18n";
import { parsePreviewCsv, parsePreviewJson } from "./objectTextParsers";

function JsonNode({ value, label }: { value: unknown; label?: string }) {
  if (value === null || typeof value !== "object") return <div>{label ? `${label}: ` : ""}{JSON.stringify(value)}</div>;
  const entries = Object.entries(value);
  return <details className="ml-3" open={label === undefined}>
    <summary className="cursor-pointer">{label ? `${label}: ` : ""}{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</summary>
    {entries.map(([key, child]) => <JsonNode key={key} label={key} value={child} />)}
  </details>;
}

export default function ObjectTextPreview({ name, contentType, content, truncated, heightClassName }: {
  name: string; contentType?: string | null; content: string; truncated: boolean; heightClassName: string;
}) {
  const { t } = useI18n();
  const [raw, setRaw] = useState(false);
  const [query, setQuery] = useState("");
  const structure = useMemo<null | { kind: "fallback" } | { kind: "csv"; rows: string[][] } | { kind: "json"; value: unknown }>(() => {
    const kind = /\.csv$/i.test(name) || contentType?.includes("csv") ? "csv" : /\.json$/i.test(name) || contentType?.includes("json") ? "json" : null;
    if (!kind) return null;
    if (truncated) return { kind: "fallback" as const };
    try {
      return kind === "csv" ? { kind, rows: parsePreviewCsv(content) } : { kind, value: parsePreviewJson(content) };
    } catch { return { kind: "fallback" as const }; }
  }, [name, contentType, content, truncated]);
  const matches = useMemo(() => {
    if (!query) return [];
    // Escape the user's literal query; no executable markup or regex input.
    const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...content.matchAll(new RegExp(pattern, "giu"))].map((match) => ({ index: match.index!, length: match[0].length }));
  }, [content, query]);
  const highlighted = () => {
    let cursor = 0;
    const segments = matches.slice(0, 200).map((match) => {
      const before = content.slice(cursor, match.index);
      cursor = match.index + match.length;
      return <Fragment key={match.index}>{before}<mark>{content.slice(match.index, cursor)}</mark></Fragment>;
    });
    return <>{segments}{content.slice(cursor)}</>;
  };
  const structured = structure && structure.kind !== "fallback";
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <input type="search" className="ui-input min-w-0 flex-1" value={query} onChange={(event) => setQuery(event.target.value)}
        aria-label={t({ en: "Find in displayed text", fr: "Rechercher dans le texte affiché", de: "Im angezeigten Text suchen", zh: "在显示的文本中搜索" })}
        placeholder={t({ en: "Find in displayed text", fr: "Rechercher dans le texte affiché", de: "Im angezeigten Text suchen", zh: "在显示的文本中搜索" })} />
      {structured ? <UiButton size="sm" variant="secondary" onClick={() => setRaw(!raw)} disabled={Boolean(query)}>
        {raw ? t({ en: "Structured view", fr: "Vue structurée", de: "Strukturansicht", zh: "结构视图" }) : t({ en: "Raw text", fr: "Texte brut", de: "Rohtext", zh: "原始文本" })}
      </UiButton> : null}
    </div>
    {query ? <p role="status" className="ui-caption">{matches.length} {t({ en: "matches in displayed text (first 200 highlighted)", fr: "occurrences dans le texte affiché (200 premières surlignées)", de: "Treffer im angezeigten Text (erste 200 markiert)", zh: "处匹配（突出显示前 200 处）" })}</p> : null}
    {structure?.kind === "fallback" ? <p className="ui-caption">{t({ en: "Raw text: invalid, truncated or too complex for a structured preview.", fr: "Texte brut : contenu invalide, tronqué ou trop complexe pour un aperçu structuré.", de: "Rohtext: ungültiger, gekürzter oder zu komplexer Inhalt.", zh: "原始文本：内容无效、已截断或过于复杂。" })}</p> : null}
    <div className={`${heightClassName} overflow-auto rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3 ui-caption`}>
      {raw || query || !structured ? <pre className="whitespace-pre-wrap break-words">{query ? highlighted() : content}</pre>
        : structure.kind === "csv" ? <table className="w-full text-left"><thead><tr>{structure.rows[0].map((cell, index) => <th className="border-b p-2" scope="col" key={index}>{cell}</th>)}</tr></thead><tbody>{structure.rows.slice(1).map((row, index) => <tr key={index}>{row.map((cell, column) => <td className="border-b p-2 whitespace-pre-wrap" key={column}>{cell}</td>)}</tr>)}</tbody></table>
          : <div className="font-mono"><JsonNode value={structure.value} /></div>}
    </div>
  </div>;
}
