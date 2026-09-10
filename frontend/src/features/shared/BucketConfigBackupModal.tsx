/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import Modal from "../../components/Modal";
import ModalActions from "../../components/ModalActions";
import ModalOptions from "../../components/ModalOptions";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { uiLabelClass, uiMutedTextClass } from "../../components/ui/styles";
import type { CephAdminBucketConfigBackupFeature } from "../../api/cephAdminBuckets";
import { extractApiError } from "../../utils/apiError";

export type BucketConfigBackupFeatureOption = {
  key: CephAdminBucketConfigBackupFeature;
  label: string;
  available: boolean;
  unavailableReason?: string;
};

type BucketConfigBackupModalProps = {
  bucketCount: number;
  featureOptions: BucketConfigBackupFeatureOption[];
  onClose: () => void;
  onCreate: (features: CephAdminBucketConfigBackupFeature[]) => Promise<void>;
};

export default function BucketConfigBackupModal({
  bucketCount,
  featureOptions,
  onClose,
  onCreate,
}: BucketConfigBackupModalProps) {
  const defaultSelected = useMemo(
    () => featureOptions.filter((feature) => feature.available).map((feature) => feature.key),
    [featureOptions]
  );
  const [selected, setSelected] = useState<Set<CephAdminBucketConfigBackupFeature>>(() => new Set(defaultSelected));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(new Set(defaultSelected));
    setError(null);
  }, [defaultSelected]);

  const selectedFeatures = useMemo(
    () => featureOptions.filter((feature) => selected.has(feature.key)).map((feature) => feature.key),
    [featureOptions, selected]
  );

  const toggleFeature = (feature: BucketConfigBackupFeatureOption, checked: boolean) => {
    if (!feature.available || loading) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(feature.key);
      } else {
        next.delete(feature.key);
      }
      return next;
    });
  };

  const submit = async () => {
    if (selectedFeatures.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      await onCreate(selectedFeatures);
      onClose();
    } catch (err) {
      setError(extractApiError(err, "Unable to create bucket configuration backup."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Backup bucket configs" onClose={onClose} maxWidthClass="max-w-xl">
      <div className="space-y-4">
        <p className={`ui-caption ${uiMutedTextClass}`}>
          {bucketCount} bucket{bucketCount > 1 ? "s" : ""} selected.
        </p>
        <fieldset className="min-w-0 space-y-2">
          <legend className={uiLabelClass}>
            Configurations
          </legend>
          <ModalOptions className="sm:grid-cols-2">
            {featureOptions.map((feature) => (
              <UiCheckboxField
                key={feature.key}
                checked={selected.has(feature.key) && feature.available}
                disabled={!feature.available || loading}
                onChange={(event) => toggleFeature(feature, event.target.checked)}
              >
                <span className="modal-option-copy">
                  <span>{feature.label}</span>
                  {!feature.available && feature.unavailableReason && (
                    <span className="modal-option-description">{feature.unavailableReason}</span>
                  )}
                </span>
              </UiCheckboxField>
            ))}
          </ModalOptions>
        </fieldset>
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
        <ModalActions>
          <UiButton type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </UiButton>
          <UiButton
            type="button"
            onClick={() => void submit()}
            disabled={loading || selectedFeatures.length === 0}
          >
            {loading ? "Preparing..." : "Download JSON"}
          </UiButton>
        </ModalActions>
      </div>
    </Modal>
  );
}
