/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SettingsButton } from "../../../components/settings/SettingsControls";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { cx, uiInputClass } from "../../../components/ui/styles";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureSection from "./BucketFeatureSection";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketAclController } from "./useBucketAclController";

type BucketAclController = ReturnType<typeof useBucketAclController>;

type BucketAclFeatureProps = {
  controller: BucketAclController;
};

const aclOptions = [
  { value: "private", label: "Private (bucket owner full control)" },
  { value: "public-read", label: "Public read" },
  { value: "public-read-write", label: "Public read/write" },
  { value: "authenticated-read", label: "Authenticated users read" },
  { value: "bucket-owner-read", label: "Bucket owner read" },
  { value: "bucket-owner-full-control", label: "Bucket owner full control" },
  { value: "log-delivery-write", label: "Log delivery write" },
  { value: "custom", label: "Custom canned ACL" },
];

const inputClass = cx(uiInputClass, "settings-control");
const labelClass = "settings-label flex flex-col gap-1";
const hintClass = "settings-description";

export default function BucketAclFeature({ controller }: BucketAclFeatureProps) {
  const {
    acl,
    configured,
    custom,
    dirty,
    error,
    loading,
    preset,
    save,
    saving,
    status,
    updateCustom,
    updatePreset,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured,
    unsaved: dirty,
  });

  return (
    <BucketFeatureSection
      title="Access control list"
      description="Configure a canned ACL and review resulting grants."
      mode="graphical"
      visualState={visualState}
      presentation="workbench"
      successMessage={status}
      busy={saving || loading}
      testId="bucket-feature-acl"
      actions={
        <SettingsButton
          type="button"
          onClick={save}
          variant="primary"
          disabled={notImplemented || saving || loading || !dirty}
        >
          {saving ? "Saving..." : "Save"}
        </SettingsButton>
      }
    >
      {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelClass}>
          Canned ACL
          <select
            value={preset}
            onChange={(event) => updatePreset(event.target.value)}
            className={inputClass}
            disabled={notImplemented || loading || saving}
          >
            {aclOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {preset === "custom" && (
          <label className={labelClass}>
            Custom ACL
            <input
              type="text"
              value={custom}
              onChange={(event) => updateCustom(event.target.value)}
              className={inputClass}
              placeholder="e.g. private"
              disabled={notImplemented || loading || saving}
            />
          </label>
        )}
      </div>
      <p className={hintClass}>Saving a canned ACL replaces the current ACL grants.</p>
      {loading ? (
        <UiInlineMessage>Loading ACL...</UiInlineMessage>
      ) : (
        <div className="space-y-3">
          <p className={hintClass}>
            Owner:{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {acl?.owner ?? "Unknown"}
            </span>
          </p>
          {(acl?.grants?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto">
              <table className="ui-data-table min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                <thead className="bg-slate-50 ui-caption uppercase tracking-wide text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="text-left">Grantee</th>
                    <th className="text-left">Type</th>
                    <th className="text-left">Permission</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {acl?.grants.map((grant, index) => {
                    const { grantee } = grant;
                    const label =
                      grantee.display_name ||
                      grantee.id ||
                      (grantee.uri ? grantee.uri.split("/").pop() : null) ||
                      grantee.type;
                    return (
                      <tr key={`${grantee.type}-${grantee.id ?? grantee.uri ?? index}`}>
                        <td>{label}</td>
                        <td className="ui-table-secondary">{grantee.type}</td>
                        <td className="ui-table-primary">{grant.permission}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ui-body text-slate-600 dark:text-slate-300">No explicit ACL grants on this bucket.</p>
          )}
        </div>
      )}
    </BucketFeatureSection>
  );
}
