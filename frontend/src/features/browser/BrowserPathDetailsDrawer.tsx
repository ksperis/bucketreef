/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiCard from "../../components/ui/UiCard";
import UiButton from "../../components/ui/UiButton";
import { cx, uiMutedTextClass } from "../../components/ui/styles";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import ObjectDetailsDrawer from "../shared/ObjectDetailsDrawer";
import DetailsList from "../shared/DetailsList";
import { useBrowserContextCounts } from "./useBrowserContextCounts";
import type { ListAllBrowserObjectsForPrefix } from "./useBrowserRecursiveObjectListing";
import { buildPrefixBreadcrumbs, normalizePrefix } from "./browserUtils";
import { useBrowserI18n } from "./browserI18n";

type BrowserPathDetailsDrawerProps = {
  contextId: S3ExecutionContextSelector;
  bucketName: string;
  listAllObjectsForPrefix: ListAllBrowserObjectsForPrefix;
  prefix: string;
  requestOptions?: BrowserRequestOptions;
  versioningEnabled: boolean;
  onClose: () => void;
  onCopyPath: (path: string) => void;
};

export default function BrowserPathDetailsDrawer({
  contextId,
  bucketName,
  listAllObjectsForPrefix,
  prefix,
  requestOptions,
  versioningEnabled,
  onClose,
  onCopyPath,
}: BrowserPathDetailsDrawerProps) {
  const { text } = useBrowserI18n();
  const recursivePrefix = normalizePrefix(prefix);
  const name = buildPrefixBreadcrumbs(recursivePrefix).at(-1)?.label ?? "Bucket root";
  const path = recursivePrefix ? `${bucketName}/${recursivePrefix.slice(0, -1)}` : bucketName;
  const { count, counts, error, loading } = useBrowserContextCounts({
    contextId,
    bucketName,
    enabled: true,
    listAllObjectsForPrefix,
    prefix: recursivePrefix,
    requestOptions,
    versioningEnabled,
  });

  return (
    <ObjectDetailsDrawer
      name={name}
      path={path}
      copyPathLabel="Copy path"
      moreLabel="More"
      onCopyPath={() => onCopyPath(path)}
      onClose={onClose}
    >
      <UiCard
        title={text("Path details")}
        description={text("Inspect this location without leaving the current Browser context.")}
      >
        <DetailsList
          items={[
            { label: text("Bucket"), value: bucketName },
            { label: text("Path"), value: path, mono: true },
            {
              label: text("Kind"),
              value: recursivePrefix ? "Folder prefix" : "Bucket root",
            },
            {
              label: text("S3 prefix"),
              value: recursivePrefix || "(empty)",
              mono: true,
            },
          ]}
        />
        <p className={cx("mt-4 text-xs leading-5", uiMutedTextClass)}>
          {text("S3 folders are virtual: this path represents the common prefix of the object keys displayed in the Browser.")}</p>
      </UiCard>
      <UiCard
        className="mt-4"
        title={text("Recursive contents")}
        description={text("Count every object below this path, including nested prefixes.")}
        actions={
          <UiButton
            size="xs"
            variant="secondary"
            loading={loading}
            onClick={() => void count()}
          >
            {loading ? text("Counting...") : counts ? text("Count again") : text("Count contents")}
          </UiButton>
        }
      >
        <div aria-live="polite">
          {loading && !counts ? (
            <p className={cx("text-xs", uiMutedTextClass)}>
              {text("Scanning the full prefix. Large paths may take a while.")}</p>
          ) : error ? (
            <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">
              {error}
            </p>
          ) : counts ? (
            <DetailsList
              items={[
                {
                  label: text("Current objects"),
                  value: counts.objects.toLocaleString(),
                },
                ...(versioningEnabled
                  ? [
                      {
                        label: text("Versions"),
                        value: counts.versions.toLocaleString(),
                      },
                      {
                        label: text("Delete markers"),
                        value: counts.deleteMarkers.toLocaleString(),
                      },
                    ]
                  : []),
              ]}
            />
          ) : (
            <p className={cx("text-xs", uiMutedTextClass)}>
              {text("The count runs only when requested and does not change the current list.")}</p>
          )}
        </div>
      </UiCard>
    </ObjectDetailsDrawer>
  );
}
