/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type PendingProjectState = {
  selection: ProjectSelection;
  access: OpenStackProjectAccess | null;
  targetId: string;
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
  const [pendingProject, setPendingProject] = useState<PendingProjectState | null>(null);
  const [activation, setActivation] = useState<ActivationState | null>(null);
  const [activationLoading, setActivationLoading] = useState(false);
  const [activeAccess, setActiveAccess] = useState<OpenStackProjectAccess | null>(null);
  const [activeAccessLoading, setActiveAccessLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDiscoveryWarning, setHasDiscoveryWarning] = useState(false);
  const optionsRequestRef = useRef(0);
  const selectionRequestRef = useRef(0);
  const activationInFlightRef = useRef(false);

  const activeSelection = useMemo(
    () => activeContext ? selectionFromContext(activeContext) : null,
    [activeContext],
  );

  const reloadOptions = useCallback(async () => {
    const requestId = ++optionsRequestRef.current;
    if (!enabled) {
      setOptions([]);
      setHasDiscoveryWarning(false);
      setCandidatesLoaded(true);
      return [];
    }
    setCandidatesLoaded(false);
    try {
      const response = await listOpenStackProjectOptions();
      if (requestId !== optionsRequestRef.current) return [];
      setOptions(response.options);
      setHasDiscoveryWarning(response.warnings.length > 0);
      return response.options;
    } catch {
      if (requestId === optionsRequestRef.current) {
        setOptions([]);
        setHasDiscoveryWarning(false);
      }
      return [];
    } finally {
      if (requestId === optionsRequestRef.current) setCandidatesLoaded(true);
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
    accessKey?: string,
  ) => {
    if (activationInFlightRef.current) return;
    activationInFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const contextId = await activateOpenStackContext(
        selection.connectionId,
        selection.projectId,
        targetId,
        accessKey,
      );
      const refreshed = await refreshContexts();
      if (!refreshed.some((context) => context.id === contextId)) {
        throw new Error("The activated OpenStack context is not available.");
      }
      if (selection.candidateValue) {
        setOptions((current) => current.filter((item) => openStackProjectOptionValue(item) !== selection.candidateValue));
      }
      setPendingProject(null);
      setActivation(null);
      onActivated(contextId);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      activationInFlightRef.current = false;
      setBusy(false);
    }
  }, [errorText, onActivated, refreshContexts]);

  const beginSelection = useCallback(async (option: OpenStackProjectOption) => {
    if (activationInFlightRef.current) return;
    const requestId = ++selectionRequestRef.current;
    const selection = selectionFromOption(option);
    setActivationLoading(true);
    setPendingProject({ selection, access: null, targetId: "" });
    setActivation(null);
    setError(null);
    try {
      const access = await getOpenStackProjectAccess(selection.connectionId, selection.projectId);
      if (requestId !== selectionRequestRef.current) return;
      const allowedTargets = access.targets.filter((target) => target.allowed);
      const targetId = allowedTargets.length === 1 ? allowedTargets[0].target_id : "";
      const accessKey = access.selected_access_key ?? (access.access_keys.length === 1 ? access.access_keys[0] : "");
      setPendingProject({ selection, access, targetId });
      if (access.access_keys.length === 0) {
        setError(text("noKeys"));
      } else if (allowedTargets.length === 0) {
        setError(text("noRegions"));
      } else if (targetId && accessKey) {
        await activate(selection, targetId, accessKey);
      } else if (targetId && access.access_keys.length > 1) {
        setActivation({ selection, access, targetId, accessKey: "" });
      }
    } catch (failure) {
      if (requestId !== selectionRequestRef.current) return;
      setError(errorText(failure));
      setPendingProject(null);
    } finally {
      if (requestId === selectionRequestRef.current) setActivationLoading(false);
    }
  }, [activate, errorText, text]);

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
    if (activationInFlightRef.current) return;
    const option = optionByValue.get(value);
    if (!option) {
      selectionRequestRef.current += 1;
      setPendingProject(null);
      setActivation(null);
      setError(null);
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

  const pendingTarget = useMemo(() => {
    if (!pendingProject?.access || !pendingProject.targetId) return null;
    return pendingProject.access.targets.find((target) => target.target_id === pendingProject.targetId) ?? null;
  }, [pendingProject]);

  const regionAccess = pendingProject?.access ?? activeAccess;
  const regionSelection = pendingProject?.selection ?? activeSelection;
  const regionTarget = pendingProject ? pendingTarget : activeTarget;

  const regionOptions = useMemo<TopbarDropdownOption[]>(() => (
    regionAccess?.targets.map((target) => ({
      value: target.target_id,
      label: target.region_id,
      description: [target.storage_endpoint_name || target.service_name || target.service_type, target.interface, target.endpoint_url].filter(Boolean).join(" · "),
      disabled: !target.allowed,
      title: target.allowed ? undefined : text("unmanagedRegion"),
      searchText: `${target.region_id} ${target.service_name ?? ""} ${target.service_type} ${target.interface} ${target.endpoint_url}`,
    })) ?? []
  ), [regionAccess, text]);

  const handleRegionChange = useCallback((targetId: string) => {
    if (activationInFlightRef.current || activationLoading || !regionSelection || !regionAccess || targetId === regionTarget?.target_id) return;
    const target = regionAccess.targets.find((item) => item.target_id === targetId);
    if (!target || !target.allowed) return;
    if (pendingProject) {
      setPendingProject((current) => current ? { ...current, targetId: target.target_id } : current);
    }
    if (regionAccess.access_keys.length === 0) {
      setError(text("noKeys"));
      return;
    }
    const accessKey = regionAccess.selected_access_key ?? (regionAccess.access_keys.length === 1 ? regionAccess.access_keys[0] : "");
    if (accessKey) {
      void activate(regionSelection, target.target_id, accessKey);
      return;
    }
    setError(null);
    setActivation({ selection: regionSelection, access: regionAccess, targetId: target.target_id, accessKey: "" });
  }, [activate, activationLoading, pendingProject, regionAccess, regionSelection, regionTarget, text]);

  const confirmActivation = useCallback(() => {
    if (activationInFlightRef.current || !activation?.targetId || !activation.accessKey) return;
    void activate(activation.selection, activation.targetId, activation.accessKey);
  }, [activate, activation]);

  const dialog = activation ? (
    <SettingsDialog
      title={`${activation.selection.projectName} · OpenStack`}
      onClose={() => { if (!busy) setActivation(null); }}
      closeDisabled={busy}
    >
      <div className="space-y-4">
        <div className="ui-caption text-[var(--ui-text-muted)]">
          {activation.selection.cloudName} · {activation.selection.identityName}
        </div>
        <div className="ui-caption text-[var(--ui-text-muted)]">
          {text("projectContextHelp")}
        </div>
        {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}
        <div className="grid gap-3">
          <UiSelect
            label={text("key")}
            value={activation.accessKey}
            disabled={busy}
            onChange={(event) => setActivation((current) => current ? { ...current, accessKey: event.target.value } : current)}
          >
            <option value="">{text("choose")}</option>
            {activation.access.access_keys.map((key) => <option key={key} value={key}>{key}</option>)}
          </UiSelect>
        </div>
        <div className="flex justify-end gap-2">
          <UiButton variant="secondary" disabled={busy} onClick={() => setActivation(null)}>{text("cancel")}</UiButton>
          <UiButton
            loading={busy}
            disabled={!activation.targetId || !activation.accessKey}
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
    error: error ?? (hasDiscoveryWarning ? text("partialProjectDiscovery") : null),
    busy: busy || activationLoading,
    reloadOptions,
    region: {
      visible: pendingProject
        ? Boolean(
          pendingProject.access
          && pendingProject.access.access_keys.length > 0
          && pendingProject.access.targets.some((target) => target.allowed)
        )
        : Boolean(activeSelection && activeContext?.openstack),
      currentRegion: regionTarget?.region_id ?? (pendingProject ? null : activeContext?.openstack?.region_id ?? null),
      currentTargetId: regionTarget?.target_id ?? "",
      options: regionOptions,
      loading: busy || (pendingProject ? activationLoading : activeAccessLoading),
      onChange: handleRegionChange,
    },
  };
}
