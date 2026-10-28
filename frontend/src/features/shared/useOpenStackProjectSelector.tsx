/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ExecutionContext } from "../../api/executionContexts";
import {
  activateOpenStackContext,
  listOpenStackKeys,
  listOpenStackProjectOptions,
  openStackProjectOptionValue,
  type OpenStackProjectOption,
} from "../../api/openstack";
import type { TopbarDropdownOption } from "../../components/TopbarDropdownSelect";
import UiButton from "../../components/ui/UiButton";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiSelect from "../../components/ui/UiSelect";
import { SettingsDialog } from "../../components/settings/SettingsControls";
import { useOpenStackI18n } from "./openstackMessages";

type UseOpenStackProjectSelectorOptions = {
  enabled: boolean;
  refreshContexts: () => Promise<ExecutionContext[]>;
  onActivated: (contextId: string) => void;
};

type ActivationState = {
  option: OpenStackProjectOption;
  endpointId: string;
  accessKey: string;
};

export function useOpenStackProjectSelector({
  enabled,
  refreshContexts,
  onActivated,
}: UseOpenStackProjectSelectorOptions) {
  const { text, errorText } = useOpenStackI18n();
  const [options, setOptions] = useState<OpenStackProjectOption[]>([]);
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);
  const [activation, setActivation] = useState<ActivationState | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadOptions = useCallback(async () => {
    if (!enabled) {
      setOptions([]);
      setCandidatesLoaded(true);
      return [];
    }
    setCandidatesLoaded(false);
    try {
      const next = await listOpenStackProjectOptions();
      setOptions(next);
      return next;
    } catch {
      setOptions([]);
      return [];
    } finally {
      setCandidatesLoaded(true);
    }
  }, [enabled]);

  useEffect(() => {
    void reloadOptions();
  }, [reloadOptions]);

  const activate = useCallback(async (
    option: OpenStackProjectOption,
    endpointId: number,
    accessKey: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const contextId = await activateOpenStackContext(
        option.connection_id,
        option.project_id,
        endpointId,
        accessKey,
      );
      const refreshed = await refreshContexts();
      if (!refreshed.some((context) => context.id === contextId)) {
        throw new Error("The activated OpenStack context is not available.");
      }
      setOptions((current) => current.filter((item) => openStackProjectOptionValue(item) !== openStackProjectOptionValue(option)));
      setActivation(null);
      setKeys([]);
      onActivated(contextId);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }, [errorText, onActivated, refreshContexts]);

  const beginSelection = useCallback(async (option: OpenStackProjectOption) => {
    const endpointId = option.endpoints.length === 1 ? String(option.endpoints[0].id) : "";
    setActivation({ option, endpointId, accessKey: "" });
    setKeys([]);
    setError(null);
    setKeysLoading(true);
    try {
      const availableKeys = await listOpenStackKeys(option.connection_id, option.project_id);
      setKeys(availableKeys);
      if (option.endpoints.length === 1 && availableKeys.length === 1) {
        setActivation({ option, endpointId, accessKey: availableKeys[0] });
        await activate(option, option.endpoints[0].id, availableKeys[0]);
        return;
      }
      setActivation({
        option,
        endpointId,
        accessKey: availableKeys.length === 1 ? availableKeys[0] : "",
      });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setKeysLoading(false);
    }
  }, [activate, errorText]);

  const optionByValue = useMemo(
    () => new Map(options.map((option) => [openStackProjectOptionValue(option), option])),
    [options],
  );

  const selectorOptions = useMemo<TopbarDropdownOption[]>(
    () => options
      .map((option) => ({
        value: openStackProjectOptionValue(option),
        label: `${option.project_name} · OpenStack`,
        description: `${option.cloud_name} · ${option.identity_name}`,
        searchText: [
          option.project_id,
          option.project_domain_id,
          option.cloud_name,
          option.identity_name,
          option.keystone_user_id,
          ...option.endpoints.flatMap((endpoint) => [endpoint.name, endpoint.region]),
        ].filter(Boolean).join(" "),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" })),
    [options],
  );

  const handleContextChange = useCallback((value: string, fallback: (value: string) => void) => {
    const option = optionByValue.get(value);
    if (!option) {
      fallback(value);
      return;
    }
    void beginSelection(option);
  }, [beginSelection, optionByValue]);

  const confirmActivation = useCallback(() => {
    if (!activation?.endpointId || !activation.accessKey) return;
    void activate(activation.option, Number(activation.endpointId), activation.accessKey);
  }, [activate, activation]);

  const dialog = activation ? (
    <SettingsDialog
      title={`${activation.option.project_name} · OpenStack`}
      onClose={() => { if (!busy) setActivation(null); }}
      closeDisabled={busy}
    >
      <div className="space-y-4">
        <p className="ui-body text-[var(--ui-text-muted)]">{text("projectContextHelp")}</p>
        <div className="ui-caption text-[var(--ui-text-muted)]">
          {activation.option.cloud_name} · {activation.option.identity_name}
        </div>
        {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}
        {keysLoading ? <p role="status" className="ui-caption text-[var(--ui-text-muted)]">{text("loading")}</p> : null}
        {!keysLoading && keys.length === 0 && !error ? <UiInlineMessage tone="warning">{text("noKeys")}</UiInlineMessage> : null}
        <div className="grid gap-3">
          <UiSelect
            label={text("endpoint")}
            value={activation.endpointId}
            disabled={busy || activation.option.endpoints.length <= 1}
            onChange={(event) => setActivation((current) => current ? { ...current, endpointId: event.target.value } : current)}
          >
            {activation.option.endpoints.length > 1 ? <option value="">{text("choose")}</option> : null}
            {activation.option.endpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>{endpoint.name}{endpoint.region ? ` (${endpoint.region})` : ""}</option>
            ))}
          </UiSelect>
          {keys.length > 1 ? (
            <UiSelect
              label={text("key")}
              value={activation.accessKey}
              disabled={busy}
              onChange={(event) => setActivation((current) => current ? { ...current, accessKey: event.target.value } : current)}
            >
              <option value="">{text("choose")}</option>
              {keys.map((key) => <option key={key} value={key}>{key}</option>)}
            </UiSelect>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <UiButton variant="secondary" disabled={busy} onClick={() => setActivation(null)}>{text("cancel")}</UiButton>
          <UiButton
            loading={busy}
            disabled={keysLoading || !activation.endpointId || !activation.accessKey}
            onClick={confirmActivation}
          >
            {text("useProject")}
          </UiButton>
        </div>
      </div>
    </SettingsDialog>
  ) : null;

  return {
    candidateCount: options.length,
    candidatesLoaded,
    selectorOptions,
    handleContextChange,
    dialog,
    reloadOptions,
  };
}
