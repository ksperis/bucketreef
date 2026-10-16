/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import BrowserEmbed from "../browser/BrowserEmbed";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import { useCephAdminI18n } from "./cephAdminI18n";

export default function CephAdminBrowserPage() {
  const { text: surfaceText } = useCephAdminI18n();
  const navigate = useNavigate();
  const { selectedEndpointId, selectedEndpoint } = useCephAdminEndpoint();
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const [showRiskModal, setShowRiskModal] = useState(true);
  const [selectedBrowserBucketName, setSelectedBrowserBucketName] = useState("");
  const browserSelector = acceptedRisk && selectedEndpointId ? `ceph-admin-${selectedEndpointId}` : null;
  const breadcrumbs = selectedBrowserBucketName
    ? cephAdminPageBreadcrumbs("browser", { label: selectedBrowserBucketName })
    : cephAdminPageBreadcrumbs("browser");

  const handleCloseModal = () => {
    setShowRiskModal(false);
    navigate("/ceph-admin");
  };

  const handleAcceptRisk = () => {
    setAcceptedRisk(true);
    setShowRiskModal(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Browser"
        description={surfaceText("Endpoint-wide object browser for Ceph admin workflows.")}
        breadcrumbs={breadcrumbs}
      />
      <div className="min-h-0 flex-1">
        {!selectedEndpointId ? (
          <PageEmptyState
            title={surfaceText("Select a Ceph endpoint")}
            description={surfaceText("Choose an endpoint before opening the Ceph Admin browser.")}
            primaryAction={{ label: surfaceText("Return to Ceph Admin"), to: "/ceph-admin" }}
            tone="warning"
            className="h-full"
          />
        ) : (
          <BrowserEmbed
            contextIdForApi={browserSelector}
            executionContextKind="ceph_admin"
            hasContext={Boolean(browserSelector)}
            workspaceSurface="ceph-admin"
            functionalProfile="advanced"
            density="compact"
            capabilityFacts={{
              canWriteObjects: true,
              canDeleteObjects: true,
              canRestoreObjects: true,
              canCreatePublicLinks: false,
            }}
            storageEndpointCapabilities={selectedEndpoint?.capabilities ?? null}
            onSelectedBucketNameChange={setSelectedBrowserBucketName}
          />
        )}
      </div>
      {showRiskModal && selectedEndpointId != null && (
        <ConfirmActionDialog
          title={surfaceText("Ceph Admin browser warning")}
          description={surfaceText("This browser uses endpoint-wide ceph-admin credentials. Bucket and object operations may execute with an owner identity different from the expected tenant owner.")}
          confirmLabel={surfaceText("I understand the risks")}
          tone="primary"
          details={[
            { label: surfaceText("Endpoint"), value: selectedEndpoint?.name ?? surfaceText("Unavailable") },
            { label: surfaceText("Execution"), value: surfaceText("Endpoint-wide ceph-admin credentials") },
          ]}
          impacts={[
            surfaceText("Bucket and object actions may not match the tenant owner you expect."),
            surfaceText("Prefer an S3 Connection with the correct owner credentials for regular object work."),
          ]}
          onCancel={handleCloseModal}
          onConfirm={handleAcceptRisk}
          maxWidthClass="max-w-2xl"
        />
      )}
    </div>
  );
}
