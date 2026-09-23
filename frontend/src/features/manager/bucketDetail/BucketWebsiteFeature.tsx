/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { SettingsButton } from "../../../components/settings/SettingsControls";
import { SettingsChoiceRow } from "../../../components/settings/SettingsLayout";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import UiTextarea from "../../../components/ui/UiTextarea";
import { cx, uiInputClass } from "../../../components/ui/styles";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureJsonExample from "./BucketFeatureJsonExample";
import BucketFeatureSection from "./BucketFeatureSection";
import EndpointFeatureDisabledNotice from "./EndpointFeatureDisabledNotice";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketWebsiteController } from "./useBucketWebsiteController";

type BucketWebsiteController = ReturnType<typeof useBucketWebsiteController>;

type BucketWebsiteFeatureProps = {
  blocked: boolean;
  bucketName?: string;
  controller: BucketWebsiteController;
  onRequestDelete: () => void;
};

const inputClass = cx(uiInputClass, "settings-control");
const labelClass = "settings-label flex flex-col gap-1";
const twoColumnGridClass = "grid gap-3 md:grid-cols-2";
const routingRulesExample = `[
  {
    "Condition": { "KeyPrefixEquals": "docs/" },
    "Redirect": { "ReplaceKeyPrefixWith": "documents/" }
  },
  {
    "Condition": { "HttpErrorCodeReturnedEquals": "404" },
    "Redirect": { "ReplaceKeyWith": "error.html" }
  }
]`;

export default function BucketWebsiteFeature({
  blocked,
  bucketName,
  controller,
  onRequestDelete,
}: BucketWebsiteFeatureProps) {
  const [showRoutingRulesExample, setShowRoutingRulesExample] = useState(false);
  const {
    clearing,
    configured,
    dirty,
    error,
    errorDocument,
    indexDocument,
    loading,
    mode,
    redirectHost,
    redirectProtocol,
    routingRules,
    save,
    saving,
    status,
    updateErrorDocument,
    updateIndexDocument,
    updateMode,
    updateRedirectHost,
    updateRedirectProtocol,
    updateRoutingRules,
  } = controller;
  const notImplemented = isApiFeatureNotImplemented(error);
  const visualState = resolveFeatureVisualState({
    disabled: blocked || notImplemented,
    configured,
    unsaved: dirty,
  });
  const editorDisabled = notImplemented || loading || saving || clearing || blocked;

  return (
    <BucketFeatureSection
      title="Static website"
      description="Host a static website from this bucket or redirect all requests."
      mode="hybrid"
      visualState={visualState}
      presentation="workbench"
      successMessage={status}
      busy={saving || clearing || loading}
      testId="bucket-feature-website"
      actions={
        <div className="flex flex-wrap gap-2">
          <SettingsButton
            type="button"
            onClick={onRequestDelete}
            disabled={notImplemented || clearing || blocked || !configured}
            variant="danger"
          >
            {clearing ? "Deleting..." : "Delete"}
          </SettingsButton>
          <SettingsButton
            type="button"
            onClick={save}
            disabled={notImplemented || saving || loading || blocked || !dirty}
            variant="primary"
          >
            {saving ? "Saving..." : "Save"}
          </SettingsButton>
        </div>
      }
    >
      {blocked && <EndpointFeatureDisabledNotice featureLabel="Static website" />}
      {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
      <fieldset className="space-y-2">
        <legend className="settings-label">Website mode</legend>
        <SettingsChoiceRow
          type="radio"
          name={`website-mode-${bucketName}`}
          title="Host a website"
          description="Serve index and error documents from this bucket."
          checked={mode === "hosting"}
          onChange={() => updateMode("hosting")}
          disabled={editorDisabled}
        />
        <SettingsChoiceRow
          type="radio"
          name={`website-mode-${bucketName}`}
          title="Redirect all requests"
          description="Point every request to another host or domain."
          checked={mode === "redirect"}
          onChange={() => updateMode("redirect")}
          disabled={editorDisabled}
        />
      </fieldset>
      {mode === "hosting" ? (
        <div className="space-y-3">
          <div className={twoColumnGridClass}>
            <label className={labelClass}>
              Index document
              <input
                type="text"
                value={indexDocument}
                onChange={(event) => updateIndexDocument(event.target.value)}
                className={inputClass}
                placeholder="index.html"
                disabled={editorDisabled}
              />
            </label>
            <label className={labelClass}>
              Error document (optional)
              <input
                type="text"
                value={errorDocument}
                onChange={(event) => updateErrorDocument(event.target.value)}
                className={inputClass}
                placeholder="error.html"
                disabled={editorDisabled}
              />
            </label>
          </div>
          <div className="space-y-2">
            <UiTextarea
              label="Routing rules (JSON array)"
              value={routingRules}
              onChange={(event) => updateRoutingRules(event.target.value)}
              rows={6}
              className="settings-control font-mono"
              placeholder="[]"
              spellCheck={false}
              disabled={editorDisabled}
            />
            <div className="ui-caption">
              <BucketFeatureJsonExample
                show={showRoutingRulesExample}
                onToggle={() => setShowRoutingRulesExample((current) => !current)}
                example={routingRulesExample}
                onUseExample={() => updateRoutingRules(routingRulesExample)}
                disabled={notImplemented}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className={twoColumnGridClass}>
          <label className={labelClass}>
            Redirect hostname
            <input
              type="text"
              value={redirectHost}
              onChange={(event) => updateRedirectHost(event.target.value)}
              className={inputClass}
              placeholder="www.example.com"
              disabled={editorDisabled}
            />
          </label>
          <label className={labelClass}>
            Protocol (optional)
            <input
              type="text"
              value={redirectProtocol}
              onChange={(event) => updateRedirectProtocol(event.target.value)}
              className={inputClass}
              placeholder="https"
              disabled={editorDisabled}
            />
          </label>
          <p className="md:col-span-2 ui-caption text-slate-500 dark:text-slate-400">
            All requests will redirect to the host above. Index and routing rules are ignored.
          </p>
        </div>
      )}
    </BucketFeatureSection>
  );
}
