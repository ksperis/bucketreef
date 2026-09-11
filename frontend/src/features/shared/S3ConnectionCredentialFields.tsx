/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId } from "react";
import UiInput from "../../components/ui/UiInput";
import { cx } from "../../components/ui/styles";

type S3ConnectionCredentialFieldsProps = {
  accessKeyId: string;
  secretAccessKey: string;
  onAccessKeyIdChange: (value: string) => void;
  onSecretAccessKeyChange: (value: string) => void;
  required?: boolean;
  accessKeyLabel?: string;
  secretAccessKeyLabel?: string;
  accessKeyPlaceholder?: string;
  secretAccessKeyPlaceholder?: string;
  className?: string;
  error?: string;
};

export default function S3ConnectionCredentialFields({
  accessKeyId,
  secretAccessKey,
  onAccessKeyIdChange,
  onSecretAccessKeyChange,
  required = false,
  accessKeyLabel,
  secretAccessKeyLabel,
  accessKeyPlaceholder = "AKIA...",
  secretAccessKeyPlaceholder = "********",
  className,
  error,
}: S3ConnectionCredentialFieldsProps) {
  const errorId = useId();
  const resolvedAccessKeyLabel = accessKeyLabel || `Access key ID${required ? " *" : ""}`;
  const resolvedSecretAccessKeyLabel = secretAccessKeyLabel || `Secret access key${required ? " *" : ""}`;

  return (
    <div className={cx("settings-fields sm:grid-cols-2", className)}>
      <UiInput
        label={resolvedAccessKeyLabel}
        value={accessKeyId}
        onChange={(event) => onAccessKeyIdChange(event.target.value)}
        placeholder={accessKeyPlaceholder}
        required={required}
        aria-invalid={error && !accessKeyId.trim() ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      <UiInput
        label={resolvedSecretAccessKeyLabel}
        type="password"
        value={secretAccessKey}
        onChange={(event) => onSecretAccessKeyChange(event.target.value)}
        placeholder={secretAccessKeyPlaceholder}
        required={required}
        aria-invalid={error && !secretAccessKey.trim() ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && <p id={errorId} role="alert" className="ui-caption text-rose-600 dark:text-rose-200 sm:col-span-2">{error}</p>}
    </div>
  );
}
