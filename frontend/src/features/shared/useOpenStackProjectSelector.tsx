/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ExecutionContext } from "../../api/executionContexts";
import {
  activateOpenStackContext,
  getOpenStackProjectAccess,
  listOpenStackProjectOptions,
  openStackProjectOptionValue,
  type OpenStackProjectAccess,
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
  activeContext?: ExecutionContext | null;
  refreshContexts: (preferredContextId?: string) => Promise<ExecutionContext[]>;
  onActivated: (contextId: string) => void;
};

type ProjectSelection = {
  connectionId: string;
  cloudName: string;
  identityName: string;
  projectId: string;
  projectName: string;
  candidateValue?: string;
};

type ActivationState = {
  selection: ProjectSelection;
  access: OpenStackProjectAccess;
  targetId: string;
  accessKey: string;
};

function selectionFromOption(option: OpenStackProjectOption): ProjectSelection {
  return {
    connectionId: option.connection_id,
    cloudName: option.cloud_name,
    identityName: option.identity_name,
    projectId: option.project_id,
    projectName: option.project_name,
    candidateValue: openStackProjectOptionValue(option),
  };
}

function selectionFromContext(context: ExecutionContext): ProjectSelection | null {
  if (context.kind !== "openstack_project" || !context.openstack) return null;
  return {
    connectionId: context.openstack.connection_id,
    cloudName: context.openstack.cloud_name,
    identityName: context.openstack.identity_name,
    projectId: context.openstack.project_id,
    projectName: context.openstack.project_name,
  };
}

export function useOpenStackProjectSelector({
  enabled,
  activeContext = null,
  refreshContexts,
  onActivated,
}: UseOpenStackProjectSelectorOptions) {
  const { text, errorText } = useOpenStackI18n();
  const [options, setOptions] = useState<OpenStackProjectOption[]>([]);
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);
  const [activation, setActivation] = useState<ActivationState | null>(null);
  const [activationLoading, setActivationLoading] = useState(false);
  const [activeAccess, setActiveAccess] = useState<OpenStackProjectAccess | null>(null);
  const [activeAccessLoading, setActiveAccessLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSelection = useMemo(
    () => activeContext ? selectionFromContext(activeContext) : null,
    [activeContext],
  );

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

  useEffect(() => {
    if (!enabled || !activeSelection) {
      setActiveAccess(null);
      setActiveAccessLoading(false);
      return;
    }
    let cancelled = false;
    setActiveAccessLoading(true);
    getOpenStackProjectAccess(activeSelection.connectionId, activeSelection.projectId)
      .then((access) => {
        if (!cancelled) setActiveAccess(access);
      })
      .catch(() => {
        if (!cancelled) setActiveAccess(null);
      })
      .finally(() => {
        if (!cancelled) setActiveAccessLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeSelection, enabled]);

  const activate = useCallback(async (
    selection: ProjectSelection,
    targetId: string,
    accessKey: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const contextId = await activateOpenStackContext(
        selection.connectionId,
        selection.projectId,
        targetId,
        accessKey,
      );
      const refreshed = await refreshContexts(contextId);
      if (!refreshed.some((context) => context.id === contextId)) {
        throw new Error("The activated OpenStack context is not available.");
      }
      if (selection.candidateValue) {
        setOptions((current) => current.filter((item) => openStackProjectOptionValue(item) !== selection.candidateValue));
      }
      setActivation(null);
      onActivated(contextId);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }, [errorText, onActivated, refreshContexts]);

  const beginSelection = useCallback(async (option: OpenStackProjectOption) => {
    const selection = selectionFromOption(option);
    setActivationLoading(true);
    setError(null);
    try {
      const access = await getOpenStackProjectAccess(selection.connectionId, selection.projectId);
      const allowedTargets = access.targets.filter((target) => target.allowed);
      const targetId = allowedTargets.length === 1 ? allowedTargets[0].target_id : "";
      const accessKey = access.access_keys.length === 1 ? access.access_keys[0] : "";
      setActivation({ selection, access, targetId, accessKey });
      if (targetId && accessKey) {
        await activate(selection, targetId, accessKey);
      }
    } catch (failure) {
      setError(errorText(failure));
      setActivation({ selection, access: { targets: [], access_keys: [] }, targetId: "", accessKey: "" });
    } finally {
      setActivationLoading(false);
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
        label: option.project_name,
        description: `OpenStack · ${option.cloud_name} · ${option.identity_name}`,
        searchText: [
          option.project_id,
          option.project_domain_id,
          option.cloud_name,
          option.identity_name,
          option.keystone_user_id,
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

  const activeTarget = useMemo(() => {
    if (!activeContext?.openstack || !activeAccess) return null;
    return activeAccess.targets.find((target) => (
      target.region_id === activeContext.openstack?.region_id
      && target.endpoint_url === activeContext.endpoint_url
    )) ?? activeAccess.targets.find((target) => target.region_id === activeContext.openstack?.region_id) ?? null;
  }, [activeAccess, activeContext]);

  const regionOptions = useMemo<TopbarDropdownOption[]>(() => (
    activeAccess?.targets.map((target) => ({
      value: target.target_id,
      label: target.region_id,
      description: [target.storage_endpoint_name || target.service_name || target.service_type, target.interface, target.endpoint_url].filter(Boolean).join(" · "),
      disabled: !target.allowed,
      title: target.allowed ? undefined : text("unmanagedRegion"),
      searchText: `${target.region_id} ${target.service_name ?? ""} ${target.service_type} ${target.interface} ${target.endpoint_url}`,
    })) ?? []
  ), [activeAccess, text]);

  const handleRegionChange = useCallback((targetId: string) => {
    if (!activeSelection || !activeAccess || targetId === activeTarget?.target_id) return;
    const target = activeAccess.targets.find((item) => item.target_id === targetId);
    if (!target || !target.allowed) return;
    const accessKey = activeAccess.access_keys.length === 1 ? activeAccess.access_keys[0] : "";
    if (accessKey) {
      void activate(activeSelection, target.target_id, accessKey);
      return;
    }
    setError(null);
    setActivation({ selection: activeSelection, access: activeAccess, targetId: target.target_id, accessKey: "" });
  }, [activate, activeAccess, activeSelection, activeTarget]);

  const confirmActivation = useCallback(() => {
    if (!activation?.targetId || !activation.accessKey) return;
    void activate(activation.selection, activation.targetId, activation.accessKey);
  }, [activate, activation]);

  const dialog = activation ? (
    <SettingsDialog
      title={`${activation.selection.projectName} · OpenStack`}
      onClose={() => { if (!busy) setActivation(null); }}
      closeDisabled={busy}
    >
      <div className="space-y-4">
        <p className="ui-body text-[var(--ui-text-muted)]">{text("projectContextHelp")}</p>
        <div className="ui-caption text-[var(--ui-text-muted)]">
          {activation.selection.cloudName} · {activation.selection.identityName}
        </div>
        {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}
        {activationLoading ? <p role="status" className="ui-caption text-[var(--ui-text-muted)]">{text("loading")}</p> : null}
        {!activationLoading && activation.access.targets.length === 0 && !error ? <UiInlineMessage tone="warning">{text("noRegions")}</UiInlineMessage> : null}
        {!activationLoading && activation.access.access_keys.length === 0 && !error ? <UiInlineMessage tone="warning">{text("noKeys")}</UiInlineMessage> : null}
        <div className="grid gap-3">
          {activation.access.targets.length > 0 ? (
            <UiSelect
              label={text("endpoint")}
              value={activation.targetId}
              disabled={busy || activation.access.targets.length <= 1}
              onChange={(event) => setActivation((current) => current ? { ...current, targetId: event.target.value } : current)}
            >
              {activation.access.targets.length > 1 || !activation.targetId ? <option value="">{text("choose")}</option> : null}
              {activation.access.targets.map((target) => (
                <option key={target.target_id} value={target.target_id} disabled={!target.allowed}>
                  {target.region_id}{target.service_name ? ` · ${target.service_name}` : ""}{target.interface !== "public" ? ` · ${target.interface}` : ""}
                </option>
              ))}
            </UiSelect>
          ) : null}
          {activation.access.access_keys.length > 1 ? (
            <UiSelect
              label={text("key")}
              value={activation.accessKey}
              disabled={busy}
              onChange={(event) => setActivation((current) => current ? { ...current, accessKey: event.target.value } : current)}
            >
              <option value="">{text("choose")}</option>
              {activation.access.access_keys.map((key) => <option key={key} value={key}>{key}</option>)}
            </UiSelect>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <UiButton variant="secondary" disabled={busy} onClick={() => setActivation(null)}>{text("cancel")}</UiButton>
          <UiButton
            loading={busy}
            disabled={activationLoading || !activation.targetId || !activation.accessKey}
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
    region: {
      visible: Boolean(activeSelection && activeContext?.openstack),
      currentRegion: activeContext?.openstack?.region_id ?? null,
      currentTargetId: activeTarget?.target_id ?? "",
      options: regionOptions,
      loading: activeAccessLoading,
      onChange: handleRegionChange,
    },
  };
}
