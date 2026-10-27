/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import { tableCompactIconActionButtonClasses } from "../../components/tableActionClasses";
import UiActionMenu, { type UiActionMenuSection } from "../../components/ui/UiActionMenu";
import type { BucketAdminOpsKind } from "../cephAdmin/CephAdminAdminOpsModal";
import { bucketAction, BUCKET_ACTION_GROUP_LABELS } from "./bucketActionCatalog";
import { useSharedI18n } from "./sharedI18n";

type BucketOpsRowActionsMenuProps = {
  bucket: CephAdminBucket;
  isStorageOps: boolean;
  selectedEndpointId: number | null | undefined;
  cephAdminBrowserEnabled: boolean;
  onOpenInBrowser: (bucket: CephAdminBucket) => void;
  onConfigure: (bucket: CephAdminBucket) => void;
  onAdminOps?: (bucket: CephAdminBucket, kind: BucketAdminOpsKind) => void;
  onOpenInManager?: (bucket: CephAdminBucket) => void;
  onOpenMultisite?: (bucket: CephAdminBucket) => void;
};

export default function BucketOpsRowActionsMenu({
  bucket,
  isStorageOps,
  selectedEndpointId,
  cephAdminBrowserEnabled,
  onOpenInBrowser,
  onConfigure,
  onAdminOps,
  onOpenInManager,
  onOpenMultisite,
}: BucketOpsRowActionsMenuProps) {
  const { text: surfaceText } = useSharedI18n();
  const action = (id: Parameters<typeof bucketAction>[0]) => {
    const descriptor = bucketAction(id);
    return { ...descriptor, label: surfaceText(descriptor.label) };
  };
  const sections: UiActionMenuSection[] = isStorageOps
    ? [
        {
          id: "navigation",
          label: surfaceText(BUCKET_ACTION_GROUP_LABELS.navigation),
          items: [
            {
              ...action("open-manager"),
              disabled: !onOpenInManager,
              disabledReason: surfaceText("Manager action unavailable for this bucket context."),
              onSelect: () => onOpenInManager?.(bucket),
            },
          ],
        },
        {
          id: "s3",
          label: surfaceText(BUCKET_ACTION_GROUP_LABELS.s3),
          items: [{ ...action("configure-one"), onSelect: () => onConfigure(bucket) }],
        },
      ]
    : [
        {
          id: "navigation",
          label: surfaceText(BUCKET_ACTION_GROUP_LABELS.navigation),
          items: [
            {
              ...action("open-browser"),
              disabled: !selectedEndpointId || !cephAdminBrowserEnabled,
              disabledReason: surfaceText("Ceph Admin Browser is disabled in application settings."),
              onSelect: () => onOpenInBrowser(bucket),
            },
            ...(onOpenMultisite ? [{
              id: "multisite",
              label: surfaceText("Multisite"),
              disabled: !selectedEndpointId,
              onSelect: () => onOpenMultisite(bucket),
            }] : []),
          ],
        },
        {
          id: "s3",
          label: surfaceText(BUCKET_ACTION_GROUP_LABELS.s3),
          items: [{ ...action("configure-one"), onSelect: () => onConfigure(bucket) }],
        },
        {
          id: "rgw",
          label: surfaceText(BUCKET_ACTION_GROUP_LABELS.rgw),
          items: [
            { ...action("check-index-one"), onSelect: () => onAdminOps?.(bucket, "index-check") },
            { ...action("link-bucket"), onSelect: () => onAdminOps?.(bucket, "link-bucket") },
          ],
        },
        {
          id: "destructive-rgw",
          label: surfaceText(BUCKET_ACTION_GROUP_LABELS["destructive-rgw"]),
          items: [
            { ...action("unlink-bucket"), onSelect: () => onAdminOps?.(bucket, "unlink-bucket") },
            { ...action("delete-bucket"), onSelect: () => onAdminOps?.(bucket, "delete-bucket") },
          ],
        },
      ];

  return (
    <UiActionMenu
      ariaLabel={surfaceText("Actions for bucket {bucket}", { bucket: bucket.name })}
      trigger={<span aria-hidden="true">⋮</span>}
      triggerClassName={tableCompactIconActionButtonClasses}
      sections={sections}
      minWidth={240}
      menuClassName="w-60"
    />
  );
}
