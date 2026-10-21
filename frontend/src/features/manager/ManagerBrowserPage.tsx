/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import PageEmptyState from "../../components/PageEmptyState";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import BrowserEmbed from "../browser/BrowserEmbed";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useS3AccountContext } from "./S3AccountContext";
import { useManagerI18n } from "./managerI18n";

export default function ManagerBrowserPage() {
  const { text } = useManagerI18n();
  const {
    accounts,
    selectedContextId,
    hasS3AccountContext,
    contextIdForApi,
    selectedContextKind,
    accessError,
    iamIdentity,
    accessMode,
    managerBrowserEnabled,
    managerBrowserMessage,
  } = useS3AccountContext();
  const [selectedBrowserBucketName, setSelectedBrowserBucketName] = useState("");
  const selectedContext = accounts.find((context) => context.id === selectedContextId) ?? null;
  const breadcrumbs = selectedBrowserBucketName
    ? managerPageBreadcrumbs(text, "browser", { label: selectedBrowserBucketName })
    : managerPageBreadcrumbs(text, "browser");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title={text("Browser")}
        description={text("Object navigation using the active Manager context.")}
        breadcrumbs={breadcrumbs}
      />
      <div className="min-h-0 flex-1">
        {!hasS3AccountContext ? (
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
          <div className="flex h-full min-h-0 flex-col gap-3">
            {accessMode === "admin" || accessMode === "s3_user" ? (
              <PageBanner tone="warning">
                {text("RGW logs will attribute operations to")} {iamIdentity ?? selectedContext?.display_name ?? "this S3 identity"}{text(", not to the UI user.")}
              </PageBanner>
            ) : accessMode === "connection" && !iamIdentity ? (
              <PageBanner tone="warning">
                {text("The provider principal could not be resolved. This Browser uses the credentials of")} {selectedContext?.display_name ?? "the selected connection"}{text("; provider logs will attribute operations to that identity.")}
              </PageBanner>
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
