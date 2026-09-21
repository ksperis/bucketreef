/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ObjectMetadata, ObjectTag } from "../../api/browserContracts";
import PageBanner from "../../components/PageBanner";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { formatBytes } from "../../utils/format";
import type { BrowserItem } from "./browserTypes";
import { formatDateTime } from "./browserUtils";
import DetailsList from "../shared/DetailsList";

type BrowserObjectReadOnlyDetailsTabProps = {
  bucketName: string;
  error: string | null;
  item: BrowserItem;
  loaded: boolean;
  loading: boolean;
  metadata: ObjectMetadata | null;
  onRefresh: () => Promise<unknown> | void;
  tags: ObjectTag[];
};

function PairList({ emptyLabel, items }: { emptyLabel: string; items: ObjectTag[] }) {
  if (items.length === 0) {
    return <p className="ui-caption text-[var(--ui-text-muted)]">{emptyLabel}</p>;
  }
  return (
    <dl className="grid gap-2 ui-caption">
      {items.map((item, index) => (
        <div key={`${item.key}-${index}`} className="grid min-w-0 gap-1 sm:grid-cols-2 sm:gap-3">
          <dt className="min-w-0 break-all font-semibold text-[var(--ui-text)]">{item.key}</dt>
          <dd className="min-w-0 break-all text-[var(--ui-text-muted)] sm:text-right">{item.value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BrowserObjectFactsSection({
  bucketName,
  item,
  metadata,
}: Pick<BrowserObjectReadOnlyDetailsTabProps, "bucketName" | "item" | "metadata">) {
  const facts: Array<[string, string]> = [
    ["Bucket", bucketName],
    ["Size", formatBytes(metadata?.size ?? item.sizeBytes ?? null)],
    [
      "Last modified",
      metadata?.last_modified
        ? formatDateTime(metadata.last_modified)
        : item.modified,
    ],
    ["Owner", item.owner || "-"],
    ["Storage class", metadata?.storage_class ?? item.storageClass ?? "-"],
    ["ETag", metadata?.etag ?? item.etag ?? "-"],
    ["Version ID", metadata?.version_id ?? "-"],
  ];

  return (
    <div className="settings-compact">
      <SettingsSection title="Object facts" presentation="compact">
      <DetailsList
        compact
        valueAlign="end"
        items={facts.map(([label, value]) => ({ label, value, title: value }))}
      />
      </SettingsSection>
    </div>
  );
}

export default function BrowserObjectReadOnlyDetailsTab({
  bucketName,
  error,
  item,
  loaded,
  loading,
  metadata,
  onRefresh,
  tags,
}: BrowserObjectReadOnlyDetailsTabProps) {
  const headers: Array<[string, string]> = [
    ["Content type", metadata?.content_type ?? "-"],
    ["Cache control", metadata?.cache_control ?? "-"],
    ["Content disposition", metadata?.content_disposition ?? "-"],
    ["Content encoding", metadata?.content_encoding ?? "-"],
    ["Content language", metadata?.content_language ?? "-"],
    ["Expires", metadata?.expires ? formatDateTime(metadata.expires) : "-"],
  ];
  const customMetadata = Object.entries(metadata?.metadata ?? {}).map(([key, value]) => ({ key, value }));

  return (
    <div className="settings-compact">
      {loading && !loaded ? <p className="ui-caption text-[var(--ui-text-muted)]">Loading object details...</p> : null}
      {error ? (
        <PageBanner
          tone="error"
          className="flex flex-wrap items-center justify-between gap-2 font-semibold"
        >
          <span>{error}</span>
          <SettingsButton variant="secondary" onClick={() => void onRefresh()} disabled={loading}>Retry</SettingsButton>
        </PageBanner>
      ) : null}
      <BrowserObjectFactsSection bucketName={bucketName} item={item} metadata={metadata} />
      <SettingsSection title="HTTP headers" presentation="compact">
        <DetailsList
          compact
          valueAlign="end"
          items={headers.map(([label, value]) => ({ label, value, title: value }))}
        />
      </SettingsSection>
      <SettingsSection title="Custom metadata" presentation="compact">
        <PairList items={customMetadata} emptyLabel="No custom metadata defined." />
      </SettingsSection>
      <SettingsSection title="Tags" presentation="compact">
        <PairList items={tags} emptyLabel="No tags defined." />
      </SettingsSection>
    </div>
  );
}
