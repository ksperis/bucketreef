/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { SettingsButton, SettingsInput } from "../../../components/settings/SettingsControls";
import { SettingsChoiceRow } from "../../../components/settings/SettingsLayout";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import UiTextarea from "../../../components/ui/UiTextarea";
import { isApiFeatureNotImplemented } from "../../../utils/apiError";
import BucketFeatureJsonExample from "./BucketFeatureJsonExample";
import BucketFeatureSection from "./BucketFeatureSection";
import BucketFeatureSettingsDialog from "./BucketFeatureSettingsDialog";
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
                <SettingsInput
                  label="Index document"
                  type="text"
                  value={indexDocument}
                  onChange={(event) => updateIndexDocument(event.target.value)}
                  placeholder="index.html"
                  disabled={editorDisabled}
                />
                <SettingsInput
                  label="Error document (optional)"
                  type="text"
                  value={errorDocument}
                  onChange={(event) => updateErrorDocument(event.target.value)}
                  placeholder="error.html"
                  disabled={editorDisabled}
                />
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
              <SettingsInput
                label="Redirect hostname"
                type="text"
                value={redirectHost}
                onChange={(event) => updateRedirectHost(event.target.value)}
                placeholder="www.example.com"
                disabled={editorDisabled}
              />
              <SettingsInput
                label="Protocol (optional)"
                type="text"
                value={redirectProtocol}
                onChange={(event) => updateRedirectProtocol(event.target.value)}
                placeholder="https"
                disabled={editorDisabled}
              />
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
