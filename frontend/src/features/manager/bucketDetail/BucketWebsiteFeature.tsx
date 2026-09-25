/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { SettingsButton, SettingsInput, SettingsSelect } from "../../../components/settings/SettingsControls";
import { SettingsAutocomplete } from "../../../components/settings/SettingsAutocomplete";
import SettingsJsonEditor from "../../../components/settings/SettingsJsonEditor";
import { SettingsChoiceRow } from "../../../components/settings/SettingsLayout";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureJsonExample from "./BucketFeatureJsonExample";
import BucketFeatureSection from "./BucketFeatureSection";
import BucketFeatureSettingsDialog from "./BucketFeatureSettingsDialog";
import EndpointFeatureDisabledNotice from "./EndpointFeatureDisabledNotice";
import { useBucketFeatureSuggestions } from "./BucketFeatureSuggestions";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { useBucketWebsiteController } from "./useBucketWebsiteController";

type BucketWebsiteController = ReturnType<typeof useBucketWebsiteController>;

type BucketWebsiteFeatureProps = {
  blocked: boolean;
  bucketName?: string;
  controller: BucketWebsiteController;
  onRequestDelete: () => void;
};

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
  const [editorOpen, setEditorOpen] = useState(false);
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
    reset,
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
  const { objectKeys } = useBucketFeatureSuggestions();
  const visualState = resolveFeatureVisualState({
    disabled: blocked || notImplemented,
    configured,
    unsaved: dirty,
  });
  const editorDisabled = notImplemented || loading || saving || clearing || blocked;
  const closeEditor = () => {
    reset();
    setEditorOpen(false);
  };

  return (
    <>
      <BucketFeatureSection
        title="Static website"
        description="Host website content directly from this bucket."
        mode="hybrid"
        visualState={visualState}
        stateLabel={dirty || blocked || notImplemented ? undefined : configured ? "Enabled" : "Inactive"}
        successMessage={status}
        busy={loading}
        testId="bucket-feature-website"
      >
        {blocked ? <EndpointFeatureDisabledNotice featureLabel="Static website" /> : null}
        {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}
        {!blocked ? (
          <div className="bucket-feature-summary-row">
            <div className={configured ? "bucket-feature-summary-value" : "bucket-feature-summary-muted"}>
              {configured ? (
                mode === "hosting" ? (
                  <>
                    <strong>{indexDocument || "Index document"}</strong>
                    {errorDocument ? ` · ${errorDocument}` : ""}
                    <div className="bucket-feature-summary-muted">Website hosting</div>
                  </>
                ) : (
                  <>
                    <strong>{redirectHost}</strong>
                    <div className="bucket-feature-summary-muted">
                      Redirect all requests{redirectProtocol ? ` · ${redirectProtocol}` : ""}
                    </div>
                  </>
                )
              ) : (
                "Static website hosting is not configured."
              )}
            </div>
            <SettingsButton
              type="button"
              variant="secondary"
              onClick={() => setEditorOpen(true)}
              disabled={editorDisabled}
            >
              {configured ? "Edit" : "Configure"}
            </SettingsButton>
          </div>
        ) : null}
      </BucketFeatureSection>

      {editorOpen ? (
        <BucketFeatureSettingsDialog
          title="Edit static website"
          dirty={dirty}
          busy={saving || clearing}
          error={error}
          saveDisabled={notImplemented || loading || blocked}
          onSave={save}
          onClose={closeEditor}
          dangerAction={
            <SettingsButton
              type="button"
              onClick={onRequestDelete}
              disabled={notImplemented || clearing || blocked || !configured}
              variant="danger"
            >
              {clearing ? "Deleting..." : "Delete"}
            </SettingsButton>
          }
        >
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
                <SettingsAutocomplete
                  label="Index document"
                  value={indexDocument}
                  onChange={updateIndexDocument}
                  placeholder="index.html"
                  disabled={editorDisabled}
                  {...objectKeys}
                />
                <SettingsAutocomplete
                  label="Error document (optional)"
                  value={errorDocument}
                  onChange={updateErrorDocument}
                  placeholder="error.html"
                  disabled={editorDisabled}
                  {...objectKeys}
                />
              </div>
              <div className="space-y-2">
                <SettingsJsonEditor
                  label="Routing rules (JSON array)"
                  value={routingRules}
                  onChange={updateRoutingRules}
                  rows={6}
                  placeholder="[]"
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
              <SettingsInput
                label="Redirect hostname"
                type="text"
                value={redirectHost}
                onChange={(event) => updateRedirectHost(event.target.value)}
                placeholder="www.example.com"
                disabled={editorDisabled}
              />
              <SettingsSelect
                label="Protocol (optional)"
                value={redirectProtocol}
                onChange={(event) => updateRedirectProtocol(event.target.value)}
                disabled={editorDisabled}
              >
                <option value="">Provider default</option>
                <option value="http">http</option>
                <option value="https">https</option>
              </SettingsSelect>
              <p className="md:col-span-2 ui-caption text-slate-500 dark:text-slate-400">
                All requests will redirect to the host above. Index and routing rules are ignored.
              </p>
            </div>
          )}
        </BucketFeatureSettingsDialog>
      ) : null}
    </>
  );
}
