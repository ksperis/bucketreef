/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { SettingsButton, SettingsInput, SettingsSelect } from "../../../components/settings/SettingsControls";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureSection from "./BucketFeatureSection";
import BucketFeatureSettingsDialog from "./BucketFeatureSettingsDialog";
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

const hintClass = "settings-description";

export default function BucketAclFeature({ controller }: BucketAclFeatureProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const {
    acl,
    custom,
    dirty,
    error,
    loading,
    preset,
    reset,
    save,
    saving,
    status,
    updateCustom,
    updatePreset,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const visualState = resolveFeatureVisualState({
    disabled: notImplemented,
    configured: Boolean(acl),
    unsaved: dirty,
  });
  const closeEditor = () => {
    reset();
    setEditorOpen(false);
  };
  const presetLabel = aclOptions.find((option) => option.value === preset)?.label.split(" (")[0] ?? "Custom";
  const primaryGrant = acl?.grants?.[0];

  return (
    <>
      <BucketFeatureSection
        title="Access control list"
        description="Canned ACL and resulting grants."
        mode="graphical"
        visualState={visualState}
        stateLabel={dirty ? undefined : acl ? presetLabel : "Unavailable"}
        successMessage={status}
        busy={loading}
        testId="bucket-feature-acl"
      >
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
        <div className="bucket-feature-summary-row">
          <div className="bucket-feature-summary-value">
            <strong>{acl?.owner ?? "Unknown owner"}</strong>
            <div className="bucket-feature-summary-muted">
              {primaryGrant
                ? `${primaryGrant.grantee.display_name || primaryGrant.grantee.id || primaryGrant.grantee.type} · ${primaryGrant.permission}`
                : "No explicit ACL grants"}
            </div>
          </div>
          <SettingsButton
            type="button"
            variant="secondary"
            onClick={() => setEditorOpen(true)}
            disabled={notImplemented || saving || loading}
          >
            Edit ACL
          </SettingsButton>
        </div>
      </BucketFeatureSection>

      {editorOpen ? (
        <BucketFeatureSettingsDialog
          title="Edit access control list"
          dirty={dirty}
          busy={saving}
          error={error}
          saveDisabled={notImplemented || loading}
          onSave={save}
          onClose={closeEditor}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <SettingsSelect
              label="Canned ACL"
              value={preset}
              onChange={(event) => updatePreset(event.target.value)}
              disabled={notImplemented || loading || saving}
            >
              {aclOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SettingsSelect>
            {preset === "custom" && (
              <SettingsInput
                label="Custom ACL"
                type="text"
                value={custom}
                onChange={(event) => updateCustom(event.target.value)}
                placeholder="e.g. private"
                disabled={notImplemented || loading || saving}
              />
            )}
          </div>
          <p className={hintClass}>Saving a canned ACL replaces the current ACL grants.</p>
          <div className="space-y-3">
            <p className={hintClass}>
              Owner:{" "}
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {acl?.owner ?? "Unknown"}
              </span>
            </p>
            {(acl?.grants?.length ?? 0) > 0 ? (
              <div className="overflow-x-auto rounded-md border border-[color:var(--ui-border-soft)]">
                <table className="ui-data-table min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                  <thead>
                    <tr>
                      <th className="text-left">Grantee</th>
                      <th className="text-left">Type</th>
                      <th className="text-left">Permission</th>
                    </tr>
                  </thead>
                  <tbody>
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
        </BucketFeatureSettingsDialog>
      ) : null}
    </>
  );
}
