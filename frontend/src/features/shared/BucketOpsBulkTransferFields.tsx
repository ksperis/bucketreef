/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiSelect from "../../components/ui/UiSelect";
import {
  BULK_COPY_FEATURE_LABELS,
  type BulkConfigClipboard,
  type BulkCopyFeatureKey,
  type BulkOperation,
  type BulkPastePlan,
} from "./bucketBulkOperationsModel";
import { normalizeBucketName } from "./bucketOpsPresentation";
import type { useBucketOpsBulkForm } from "./useBucketOpsBulkForm";
import { useSharedI18n } from "./sharedI18n";

type BulkFormController = Pick<
  ReturnType<typeof useBucketOpsBulkForm>,
  | "bulkCopyFeatures"
  | "bulkOperation"
  | "bulkPasteMapping"
  | "setBulkCopyFeatures"
  | "setBulkOperation"
  | "setBulkPasteMapping"
>;

type BucketOpsBulkTransferFieldsProps = {
  clipboard: BulkConfigClipboard | null;
  clipboardSameEndpoint: boolean;
  controller: BulkFormController;
  isStorageOps: boolean;
  pastePlan: BulkPastePlan;
  quotaDisabledReason: string | null;
  scopeDisplayName: string;
  selectedBucketNames: string[];
  selectedCount: number;
  snsFeatureEnabled: boolean;
};

export default function BucketOpsBulkTransferFields({
  clipboard,
  clipboardSameEndpoint,
  controller,
  isStorageOps,
  pastePlan,
  quotaDisabledReason,
  scopeDisplayName,
  selectedBucketNames,
  selectedCount,
  snsFeatureEnabled,
}: BucketOpsBulkTransferFieldsProps) {
  const { text: surfaceText } = useSharedI18n();
  const {
    bulkCopyFeatures,
    bulkOperation,
    bulkPasteMapping,
    setBulkCopyFeatures,
    setBulkOperation,
    setBulkPasteMapping,
  } = controller;
  const clipboardSourceBuckets = useMemo(
    () => clipboard?.buckets.map((bucket) => bucket.name) ?? [],
    [clipboard],
  );
  const clipboardCopiedAtLabel = useMemo(() => {
    if (!clipboard) return null;
    const parsed = new Date(clipboard.copiedAt);
    if (Number.isNaN(parsed.getTime())) return clipboard.copiedAt;
    return parsed.toLocaleString();
  }, [clipboard]);
  const clipboardFeatureLabels = useMemo(() => {
    if (!clipboard) return [];
    return (Object.keys(clipboard.features) as BulkCopyFeatureKey[])
      .filter((feature) => clipboard.features[feature])
      .map((feature) => BULK_COPY_FEATURE_LABELS[feature]);
  }, [clipboard]);
  const clipboardSummary = useMemo(() => {
    if (!clipboard) return null;
    const endpoint =
      clipboard.sourceEndpointName ??
      `${scopeDisplayName} #${clipboard.sourceEndpointId}`;
    const singular = clipboard.buckets.length === 1;
    if (clipboardCopiedAtLabel) {
      return surfaceText(
        singular
          ? "Clipboard contains configuration from {count} bucket on {endpoint} (copied {date})."
          : "Clipboard contains configuration from {count} buckets on {endpoint} (copied {date}).",
        {
          count: clipboard.buckets.length,
          endpoint,
          date: clipboardCopiedAtLabel,
        },
      );
    }
    return surfaceText(
      singular
        ? "Clipboard contains configuration from {count} bucket on {endpoint}."
        : "Clipboard contains configuration from {count} buckets on {endpoint}.",
      { count: clipboard.buckets.length, endpoint },
    );
  }, [clipboard, clipboardCopiedAtLabel, scopeDisplayName, surfaceText]);

  return (
    <>
      <p className="ui-body text-slate-700 dark:text-slate-200">
        {surfaceText(
          selectedCount === 1
            ? "Apply configuration to {count} bucket."
            : "Apply configuration to {count} buckets.",
          { count: selectedCount },
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <UiSelect
          id="bucket-ops-bulk-operation"
          label={surfaceText("Operation")}
          value={bulkOperation}
          onChange={(event) =>
            setBulkOperation(event.target.value as BulkOperation)
          }
        >
            <option value="">{surfaceText("Select an S3 API operation")}</option>
            <optgroup label={surfaceText("Configuration transfer")}>
              <option value="copy_configs">{surfaceText("Copy configurations")}</option>
              <option value="paste_configs" disabled={!clipboard}>
                {surfaceText(
                  clipboard
                    ? "Paste copied configurations"
                    : "Paste copied configurations (nothing copied)",
                )}
              </option>
            </optgroup>
            <optgroup label={surfaceText("Access and quota")}>
              {!isStorageOps && (
                <option
                  value="set_quota"
                  disabled={Boolean(quotaDisabledReason)}
                >
                  {quotaDisabledReason
                    ? surfaceText("Set bucket quota ({reason})", { reason: quotaDisabledReason })
                    : surfaceText("Set bucket quota")}
                </option>
              )}
              <option value="add_public_access_block">
                {surfaceText("Add block public access")}</option>
              <option value="remove_public_access_block">
                {surfaceText("Remove block public access")}</option>
            </optgroup>
            <optgroup label={surfaceText("Versioning")}>
              <option value="enable_versioning">{surfaceText("Enable versioning")}</option>
              <option value="disable_versioning">{surfaceText("Disable versioning")}</option>
            </optgroup>
            <optgroup label={surfaceText("Rules and policies")}>
              <option value="add_lifecycle">
                {surfaceText("Add or update lifecycle rules")}</option>
              <option value="delete_lifecycle">{surfaceText("Delete lifecycle rules")}</option>
              <option value="add_notifications" disabled={!snsFeatureEnabled}>
                {surfaceText(
                  snsFeatureEnabled
                    ? "Add or update notification configurations"
                    : "Add or update notification configurations (SNS unavailable)",
                )}
              </option>
              <option
                value="delete_notifications"
                disabled={!snsFeatureEnabled}
              >
                {surfaceText(
                  snsFeatureEnabled
                    ? "Delete notification configurations"
                    : "Delete notification configurations (SNS unavailable)",
                )}
              </option>
              <option value="add_cors">{surfaceText("Add or update CORS rules")}</option>
              <option value="delete_cors">{surfaceText("Delete CORS rules")}</option>
              <option value="add_policy">
                {surfaceText("Add or update policy statements")}</option>
              <option value="delete_policy">{surfaceText("Delete policy statements")}</option>
            </optgroup>
        </UiSelect>
      </div>

      {bulkOperation === "copy_configs" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {surfaceText("Configurations to copy")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(BULK_COPY_FEATURE_LABELS) as BulkCopyFeatureKey[])
                .filter((feature) => !isStorageOps || feature !== "quota")
                .map((feature) => (
                  <UiCheckboxField
                    key={feature}
                    checked={bulkCopyFeatures[feature]}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setBulkCopyFeatures((previous) => ({
                        ...previous,
                        [feature]: checked,
                      }));
                    }}
                    className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100"
                  >
                    {BULK_COPY_FEATURE_LABELS[feature]}
                  </UiCheckboxField>
                ))}
            </div>
          </div>
          {clipboard && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
              <p className="ui-caption text-slate-600 dark:text-slate-300">
                {clipboardSummary}
              </p>
              {clipboardFeatureLabels.length > 0 && (
                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                  {surfaceText("Features: {features}.", {
                    features: clipboardFeatureLabels.join(", "),
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {bulkOperation === "paste_configs" && (
        <div className="space-y-4">
          {!clipboard ? (
            <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
              {surfaceText("No copied configuration available. Use \"Copy configs\" first.")}</p>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                <p className="ui-caption text-slate-700 dark:text-slate-200">
                  {surfaceText("Source:")}{" "}
                  <span className="font-semibold">
                    {clipboard.sourceEndpointName ??
                      `${scopeDisplayName} #${clipboard.sourceEndpointId}`}
                  </span>{" "}
                  · {surfaceText(
                    clipboard.buckets.length === 1 ? "{count} bucket" : "{count} buckets",
                    { count: clipboard.buckets.length },
                  )} ·
                  {clipboardCopiedAtLabel
                    ? surfaceText(" copied {date}", { date: clipboardCopiedAtLabel })
                    : surfaceText(" copied recently")}
                </p>
                <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                  {surfaceText(
                    selectedBucketNames.length === 1
                      ? "Destination selection: {count} bucket."
                      : "Destination selection: {count} buckets.",
                    { count: selectedBucketNames.length },
                  )}
                </p>
                {clipboardFeatureLabels.length > 0 && (
                  <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                    {surfaceText("Pasted features:")}{clipboardFeatureLabels.join(", ")}.
                  </p>
                )}
              </div>
              {pastePlan.mode === "one_to_many" && (
                <div className="space-y-1 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">
                    {surfaceText("Proposed mapping: 1 source to all selected destinations.")}</p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    {surfaceText("Source bucket:")}{" "}
                    <span className="font-semibold">
                      {clipboard.buckets[0]?.name ?? "-"}
                    </span>
                  </p>
                </div>
              )}
              {pastePlan.mode === "one_to_one" && (
                <div className="space-y-2">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {surfaceText("Proposed mapping (1:1)")}</p>
                  <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="ui-data-table min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                      <thead className="bg-slate-100 dark:bg-slate-900/60">
                        <tr>
                          <th className="text-left">
                            {surfaceText("Source bucket")}</th>
                          <th className="text-left">
                            {surfaceText("Destination bucket")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {clipboardSourceBuckets.map((sourceBucket) => {
                          const usedByOther = new Set(
                            Object.entries(bulkPasteMapping)
                              .filter(
                                ([otherSource, destination]) =>
                                  otherSource !== sourceBucket &&
                                  destination.trim(),
                              )
                              .map(([, destination]) =>
                                normalizeBucketName(destination),
                              ),
                          );
                          return (
                            <tr key={sourceBucket}>
                              <td className="ui-table-primary">
                                {sourceBucket}
                              </td>
                              <td>
                                <UiSelect
                                  aria-label={surfaceText("Destination bucket for {bucket}", { bucket: sourceBucket })}
                                  value={bulkPasteMapping[sourceBucket] ?? ""}
                                  onChange={(event) => {
                                    const destination = event.target.value;
                                    setBulkPasteMapping((previous) => ({
                                      ...previous,
                                      [sourceBucket]: destination,
                                    }));
                                  }}
                                  size="compact"
                                >
                                  <option value="">
                                    {surfaceText("Select destination bucket")}</option>
                                  {selectedBucketNames.map(
                                    (destinationBucket) => {
                                      const normalizedDestination =
                                        normalizeBucketName(destinationBucket);
                                      const isUsed =
                                        usedByOther.has(normalizedDestination);
                                      const isSameBucketConflict =
                                        clipboardSameEndpoint &&
                                        normalizeBucketName(sourceBucket) ===
                                          normalizedDestination;
                                      return (
                                        <option
                                          key={`${sourceBucket}-${destinationBucket}`}
                                          value={destinationBucket}
                                          disabled={
                                            isUsed || isSameBucketConflict
                                          }
                                        >
                                          {destinationBucket}
                                          {isSameBucketConflict
                                            ? " (same bucket not allowed)"
                                            : isUsed
                                              ? " (already used)"
                                              : ""}
                                        </option>
                                      );
                                    },
                                  )}
                                </UiSelect>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {!pastePlan.mode && (
                <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
                  {surfaceText("Mapping impossible with current source/destination selections.")}</p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
