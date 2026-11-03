/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useState } from "react";
import { SettingsButton } from "../../components/settings/SettingsControls";
import UiInput from "../../components/ui/UiInput";
import { copyTextToClipboard } from "../../utils/clipboard";
import { useManagerI18n } from "./managerI18n";

export default function ManagerIamArnField({ arn }: { arn: string }) {
  const { text } = useManagerI18n();
  const [status, setStatus] = useState<"copied" | "error" | null>(null);

  const copyArn = async () => {
    try {
      await copyTextToClipboard(arn);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-end gap-2">
        <UiInput label="ARN" value={arn} readOnly fieldClassName="min-w-0 flex-1" />
        <SettingsButton type="button" variant="secondary" disabled={!arn} onClick={() => void copyArn()}>
          {text("Copy ARN")}
        </SettingsButton>
      </div>
      {status === "copied" && <p role="status" className="ui-caption mt-1 text-emerald-700 dark:text-emerald-300">{text("ARN copied")}</p>}
      {status === "error" && <p role="alert" className="ui-caption mt-1 text-red-700 dark:text-red-300">{text("Unable to copy ARN.")}</p>}
    </div>
  );
}
