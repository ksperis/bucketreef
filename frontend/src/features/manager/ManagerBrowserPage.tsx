/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import PageEmptyState from "../../components/PageEmptyState";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import UiDetails from "../../components/ui/UiDetails";
import { cx, uiToneBannerClasses } from "../../components/ui/styles";
import BrowserEmbed from "../browser/BrowserEmbed";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useExecutionContext } from "./ExecutionContextProvider";
import { useManagerI18n } from "./managerI18n";

export default function ManagerBrowserPage() {
  const { text } = useManagerI18n();
  const {
    contexts,
    selectedContextId,
    hasExecutionContext,
    contextIdForApi,
    selectedContextKind,
    accessError,
    iamIdentity,
    accessMode,
    managerBrowserEnabled,
    managerBrowserMessage,
  } = useExecutionContext();
  const [selectedBrowserBucketName, setSelectedBrowserBucketName] = useState("");
  const selectedContext = contexts.find((context) => context.id === selectedContextId) ?? null;
  const breadcrumbs = selectedBrowserBucketName
    ? managerPageBreadcrumbs(text, "browser", { label: selectedBrowserBucketName })
    : managerPageBreadcrumbs(text, "browser");
  const attributionIdentity =
    iamIdentity ?? selectedContext?.display_name ??
    (accessMode === "connection" ? "the selected connection" : "this S3 identity");
  const attributionMessage =
    accessMode === "admin" || accessMode === "s3_user"
      ? `${text("RGW logs will attribute operations to")} ${attributionIdentity}${text(", not to the UI user.")}`
      : accessMode === "connection" && !iamIdentity
        ? `${text("The provider principal could not be resolved. This Browser uses the credentials of")} ${selectedContext?.display_name ?? "the selected connection"}${text("; provider logs will attribute operations to that identity.")}`
        : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2 md:gap-4">
      <div className="hidden md:block">
        <PageHeader
          title={text("Browser")}
          description={text("Object navigation using the active Manager context.")}
          breadcrumbs={breadcrumbs}
        />
      </div>
      <h1 className="sr-only md:hidden">{text("Browser")}</h1>
      <div className="min-h-0 flex-1">
        {!hasExecutionContext ? (
          <PageEmptyState
            title={text("Select a Manager context")}
            description={accessError ?? "Use the Manager selector in the topbar to choose a context."}
            secondaryAction={{ label: text("Open Manager dashboard"), to: "/manager" }}
            tone="warning"
            className="h-full"
          />
        ) : managerBrowserEnabled !== true ? (
          <PageEmptyState
            title={managerBrowserEnabled === null ? text("Checking Browser access") : text("Browser unavailable for this context")}
            description={managerBrowserMessage ?? "This active Manager context is not authorized for Browser data access."}
            secondaryAction={{ label: text("Open Manager dashboard"), to: "/manager" }}
            tone="warning"
            className="h-full"
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-2 md:gap-3">
            {attributionMessage ? (
              <>
                <PageBanner tone="warning" className="hidden md:block">
                  {attributionMessage}
                </PageBanner>
                <UiDetails
                  className={cx(
                    "overflow-hidden rounded-md border md:hidden",
                    uiToneBannerClasses.warning,
                  )}
                >
                  <summary
                    aria-label={`RGW: ${attributionIdentity}`}
                    className="flex min-h-[44px] cursor-pointer items-center gap-2 px-3 py-2 ui-caption"
                  >
                    <span className="shrink-0 font-semibold">RGW</span>
                    <span aria-hidden="true">·</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {attributionIdentity}
                    </span>
                    <span aria-hidden="true" className="shrink-0">ⓘ</span>
                  </summary>
                  <div className="border-t border-current/15 px-3 py-2 ui-caption">
                    {attributionMessage}
                  </div>
                </UiDetails>
              </>
            ) : null}
            <div className="min-h-0 flex-1">
              <BrowserEmbed
                contextIdForApi={contextIdForApi}
                executionContextKind={selectedContextKind}
                hasContext
                workspaceSurface="manager"
                functionalProfile="advanced"
                density="compact"
                capabilityFacts={{
                  canWriteObjects: true,
                  canDeleteObjects: true,
                  canRestoreObjects: true,
                  canCreatePublicLinks: false,
                }}
                storageEndpointCapabilities={selectedContext?.storage_endpoint_capabilities ?? null}
                onSelectedBucketNameChange={setSelectedBrowserBucketName}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
