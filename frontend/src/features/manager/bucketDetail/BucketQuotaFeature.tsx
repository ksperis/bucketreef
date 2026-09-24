/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { FormEvent } from "react";
import { ListBadge } from "../../../components/list/ListControls";
import { SettingsButton, SettingsInput, SettingsSelect } from "../../../components/settings/SettingsControls";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import BucketFeatureSection from "./BucketFeatureSection";
import EndpointFeatureDisabledNotice from "./EndpointFeatureDisabledNotice";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { BucketQuotaUnit, useBucketQuotaController } from "./useBucketQuotaController";

type BucketQuotaController = ReturnType<typeof useBucketQuotaController>;

type BucketQuotaFeatureProps = {
  controller: BucketQuotaController;
  editable: boolean;
  featureEnabled: boolean;
  loading: boolean;
};

const formId = "bucket-quota-form";

export default function BucketQuotaFeature({
  controller,
  editable,
  featureEnabled,
  loading,
}: BucketQuotaFeatureProps) {
  const {
    configured,
    dirty,
    error,
    maxObjects,
    maxSize,
    save,
    saving,
    status,
    unit,
    updateMaxObjects,
    updateMaxSize,
    updateUnit,
  } = controller;
  const restricted = featureEnabled && !editable;
  const visualState = resolveFeatureVisualState({
    disabled: !featureEnabled || restricted,
    configured,
    unsaved: dirty,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };

  return (
    <BucketFeatureSection
      title="Quota"
      description="Allowed bucket size and object count."
      mode="graphical"
      visualState={visualState}
      successMessage={status}
      busy={saving || loading}
      testId="bucket-feature-quota"
      actions={
        restricted ? (
          <ListBadge tone="neutral">Restricted</ListBadge>
        ) : editable ? (
          <SettingsButton type="submit" form={formId} disabled={saving || !dirty} variant="primary">
            {saving ? "Saving..." : "Save"}
          </SettingsButton>
        ) : null
      }
    >
      {!featureEnabled && <EndpointFeatureDisabledNotice featureLabel="Quota" />}
      <form
        id={formId}
        className={`mt-2 space-y-2 ${restricted ? "pointer-events-none" : ""}`}
        onSubmit={submit}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-wrap items-end gap-2">
            <SettingsInput
              label="Size"
              type="number"
              min={0}
              step="0.1"
              value={maxSize}
              onChange={(event) => updateMaxSize(event.target.value)}
              fieldClassName="min-w-36 flex-1"
              placeholder="e.g. 100"
              disabled={!editable}
            />
            <SettingsSelect
              value={unit}
              aria-label="Quota size unit"
              onChange={(event) => updateUnit(event.target.value as BucketQuotaUnit)}
              className="w-20"
              disabled={!editable}
            >
              <option value="MiB">MiB</option>
              <option value="GiB">GiB</option>
              <option value="TiB">TiB</option>
            </SettingsSelect>
          </div>
          <SettingsInput
            label="Object count"
            type="number"
            min={0}
            step="1"
            value={maxObjects}
            onChange={(event) => updateMaxObjects(event.target.value)}
            placeholder="e.g. 1000000"
            disabled={!editable}
          />
        </div>
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
      </form>
      <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
        {featureEnabled
          ? `Leave empty to remove the quota. ${editable ? "" : "(Privileged Ceph access required.)"}`
          : "Quota management is unavailable on this endpoint."}
      </p>
    </BucketFeatureSection>
  );
}
