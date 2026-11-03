/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { addIamGroupUser, listIamGroupsPage, removeIamGroupUser, type IAMGroup } from "../../api/managerIamGroups";
import { getIamUser } from "../../api/managerIamUsers";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActionButton } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import PageBanner from "../../components/PageBanner";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { extractApiError } from "../../utils/apiError";
import { decodeRouteValue } from "../../utils/routeValues";
import ManagerIamAssociationPicker, {
  type ManagerIamAssociationFailure,
  type ManagerIamAssociationPickerItem,
} from "./ManagerIamAssociationPicker";
import { useManagerI18n } from "./managerI18n";
import { useExecutionContext } from "./ExecutionContextProvider";
import { useManagerIamCursorCollection } from "./useManagerIamCursorCollection";

export default function ManagerUserGroupsPage() {
  const { text } = useManagerI18n();
  const { userName } = useParams<{ userName: string }>();
  const { selectedContextKind, contextIdForApi, requiresContextSelection, accessMode } = useExecutionContext();
  const needsContextSelection = requiresContextSelection && !contextIdForApi;
  const isS3User = selectedContextKind === "s3_user";
  const decodedUser = decodeRouteValue(userName);
  const [groups, setGroups] = useState<IAMGroup[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<IAMGroup[]>([]);
  const [associationFailures, setAssociationFailures] = useState<ManagerIamAssociationFailure[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const membershipConfirmation = useConfirmActionDialog();
  const groupOptions = useManagerIamCursorCollection(listIamGroupsPage);
  const { setItems: setGroupOptions } = groupOptions;

  const load = useCallback(async (contextId: S3ExecutionContextSelector, targetUser: string) => {
    setLoading(true);
    setError(null);
    try {
      const user = await getIamUser(contextId, targetUser);
      setGroups((user.groups ?? []).map((name) => ({ name })));
    } catch (err) {
      setError(extractApiError(err, text("Unable to load IAM groups.")));
    } finally {
      setLoading(false);
    }
  }, [text]);

  useEffect(() => {
    setPickerOpen(false);
    setSelectedGroups([]);
    setAssociationFailures([]);
    if (!userName || needsContextSelection || isS3User) {
      setGroups([]);
      setGroupOptions([]);
      setLoading(false);
      return;
    }
    void load(contextIdForApi, userName);
  }, [accessMode, contextIdForApi, isS3User, load, needsContextSelection, setGroupOptions, userName]);

  const availableGroups = useMemo(
    () => groupOptions.items.filter((group) => !groups.some((current) => current.name === group.name)),
    [groupOptions.items, groups],
  );

  const openPicker = () => {
    setSelectedGroups([]);
    setAssociationFailures([]);
    setActionMessage(null);
    setPickerOpen(true);
    groupOptions.load(contextIdForApi);
  };

  const closePicker = () => {
    if (busy === "add") return;
    setPickerOpen(false);
    setSelectedGroups([]);
    setAssociationFailures([]);
  };

  const toggleGroup = (item: ManagerIamAssociationPickerItem, checked: boolean) => {
    if (checked) {
      const group = availableGroups.find((candidate) => candidate.name === item.id);
      if (group) setSelectedGroups((current) => [...current.filter((candidate) => candidate.name !== group.name), group]);
      return;
    }
    setSelectedGroups((current) => current.filter((group) => group.name !== item.id));
  };

  const handleAdd = async () => {
    if (!userName || selectedGroups.length === 0 || busy) return;
    setBusy("add");
    setError(null);
    setActionMessage(null);
    setAssociationFailures([]);
    const results = await Promise.all(selectedGroups.map(async (group) => {
      try {
        await addIamGroupUser(contextIdForApi, group.name, userName);
        return { group, error: null };
      } catch (err) {
        return { group, error: extractApiError(err, text("Unable to update IAM group membership.")) };
      }
    }));
    const failures = results.filter((result) => result.error !== null);
    await load(contextIdForApi, userName);
    setBusy(null);
    if (failures.length === 0) {
      setPickerOpen(false);
      setSelectedGroups([]);
      setActionMessage(text("Group memberships updated"));
      return;
    }
    setSelectedGroups(failures.map((result) => result.group));
    setAssociationFailures(failures.map((result) => ({
      id: result.group.name,
      label: result.group.name,
      message: result.error ?? text("Unable to update IAM group membership."),
    })));
  };

  const removeGroup = async (groupName: string) => {
    if (!userName) return;
    setBusy(groupName);
    setError(null);
    setActionMessage(null);
    try {
      await removeIamGroupUser(contextIdForApi, groupName, userName);
      await load(contextIdForApi, userName);
      setActionMessage(text("User removed from group"));
    } catch (err) {
      setError(extractApiError(err, text("Unable to update IAM group membership.")));
    } finally {
      setBusy(null);
    }
  };

  const tableStatus = resolveListTableStatus({ loading, error, rowCount: groups.length });
  const columns: Array<DataTableColumn<IAMGroup>> = [
    { id: "group", label: text("Group"), primary: true, render: (group) => group.name },
    {
      id: "actions",
      label: text("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (group) => (
        <ListActionButton
          type="button"
          variant="danger"
          disabled={busy === group.name}
          onClick={() => membershipConfirmation.requestConfirmation({
            title: text("Remove user from group?"),
            description: text("Detach this IAM user from the selected group."),
            confirmLabel: text("Remove user"),
            details: [
              { label: text("User"), value: decodedUser },
              { label: text("Group"), value: group.name },
            ],
            impacts: [text("Permissions inherited only through this group will no longer apply to the user.")],
            onConfirm: () => removeGroup(group.name),
          })}
        >
          {text(busy === group.name ? "Removing..." : "Remove")}
        </ListActionButton>
      ),
    },
  ];

  if (isS3User) {
    return <PageBanner tone="info">{text("IAM users are not available for standalone S3 users. Select an S3 Account to continue.")}</PageBanner>;
  }
  if (!userName) return <div className="ui-body text-slate-600">{text("User not specified.")}</div>;
  if (needsContextSelection) return <div className="ui-body text-slate-600">{text("Select a context before managing groups.")}</div>;

  return (
    <div className="space-y-4">
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{text(error)}</PageBanner>}
      <ListPageSection
        variant="page"
        title={text("Groups")}
        countLabel={text("Associated: {count}", { count: groups.length })}
        actions={(
          <ListActionButton type="button" onClick={openPicker} disabled={pickerOpen || busy !== null}>
            {text("Add to groups")}
          </ListActionButton>
        )}
      >
        <DataTableShell
          columns={columns}
          rows={groups}
          rowKey={(group) => group.name}
          status={tableStatus}
          loadingMessage={text("Loading groups...")}
          errorMessage={text("Unable to load groups.")}
          emptyMessage={text("This user is not a member of any group.")}
          responsiveCards
        />
        {pickerOpen ? (
          <ManagerIamAssociationPicker
            title={text("Add to groups")}
            searchLabel={text("Search IAM groups")}
            searchPlaceholder={text("Search groups by name")}
            emptyMessage={groupOptions.search.trim()
              ? text("No matching groups.")
              : text("No IAM groups available to add. Create one before managing this user.")}
            items={availableGroups.map((group) => ({ id: group.name, label: group.name, secondary: group.arn }))}
            selectedIds={selectedGroups.map((group) => group.name)}
            search={groupOptions.search}
            loading={groupOptions.loading}
            error={groupOptions.error}
            failures={associationFailures}
            page={groupOptions.page}
            pageSize={groupOptions.pageSize}
            canPrevious={groupOptions.canPrevious}
            canNext={groupOptions.canNext}
            submitting={busy === "add"}
            submitLabel={text("Add")}
            onSearchChange={groupOptions.setSearch}
            onToggle={toggleGroup}
            onPreviousPage={groupOptions.previousPage}
            onNextPage={groupOptions.nextPage}
            onCancel={closePicker}
            onSubmit={() => void handleAdd()}
          />
        ) : null}
      </ListPageSection>
      {membershipConfirmation.confirmationDialog}
    </div>
  );
}
