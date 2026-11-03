/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ListPageSection from "../../components/list/ListPageSection";
import { ListActionButton } from "../../components/list/ListControls";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { S3ExecutionContextSelector } from "../../api/accountParams";
import { IAMUser, listIamUsersPage } from "../../api/managerIamUsers";
import { addIamGroupUser, listIamGroupUsers, removeIamGroupUser } from "../../api/managerIamGroups";
import { useExecutionContext } from "./ExecutionContextProvider";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import PageShell from "../../components/PageShell";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import { decodeRouteValue } from "../../utils/routeValues";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import ManagerIamAssociationPicker, {
  type ManagerIamAssociationFailure,
  type ManagerIamAssociationPickerItem,
} from "./ManagerIamAssociationPicker";
import { useManagerI18n } from "./managerI18n";
import { useManagerIamCursorCollection } from "./useManagerIamCursorCollection";

export default function ManagerGroupUsersPage({ embedded = false }: { embedded?: boolean }) {
  const { text } = useManagerI18n();
  const { groupName } = useParams<{ groupName: string }>();
  const { selectedContextKind, contextIdForApi, requiresContextSelection, accessMode } = useExecutionContext();
  const needsContextSelection = requiresContextSelection && !contextIdForApi;
  const isS3User = selectedContextKind === "s3_user";

  const [users, setUsers] = useState<IAMUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<IAMUser[]>([]);
  const [associationFailures, setAssociationFailures] = useState<ManagerIamAssociationFailure[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const memberConfirmation = useConfirmActionDialog();
  const userOptions = useManagerIamCursorCollection(listIamUsersPage);
  const { setItems: setUserOptions } = userOptions;

  const decodedGroup = decodeRouteValue(groupName);

  const load = useCallback(async (contextId: S3ExecutionContextSelector, targetGroup: string) => {
    setLoading(true);
    setError(null);
    try {
      const members = await listIamGroupUsers(contextId, targetGroup);
      setUsers(members);
    } catch (err) {
      setError(extractApiError(err, "Unexpected error"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPickerOpen(false);
    setSelectedUsers([]);
    setAssociationFailures([]);
    if (isS3User || needsContextSelection) {
      setUsers([]);
      setUserOptions([]);
      setLoading(false);
      return;
    }
    if (groupName) {
      load(contextIdForApi, groupName);
    }
  }, [accessMode, contextIdForApi, groupName, isS3User, load, needsContextSelection, setUserOptions]);

  const availableUsers = useMemo(
    () => userOptions.items.filter((u) => !users.some((member) => member.name === u.name)),
    [userOptions.items, users]
  );

  const openPicker = () => {
    setSelectedUsers([]);
    setAssociationFailures([]);
    setActionMessage(null);
    setPickerOpen(true);
    userOptions.load(contextIdForApi);
  };

  const closePicker = () => {
    if (busy === "add") return;
    setPickerOpen(false);
    setSelectedUsers([]);
    setAssociationFailures([]);
  };

  const toggleUser = (item: ManagerIamAssociationPickerItem, checked: boolean) => {
    if (checked) {
      const user = availableUsers.find((candidate) => candidate.name === item.id);
      if (user) setSelectedUsers((current) => [...current.filter((candidate) => candidate.name !== user.name), user]);
      return;
    }
    setSelectedUsers((current) => current.filter((user) => user.name !== item.id));
  };

  const handleAdd = async () => {
    if (needsContextSelection || !groupName || selectedUsers.length === 0 || busy) return;
    setBusy("add");
    setError(null);
    setActionMessage(null);
    setAssociationFailures([]);
    const results = await Promise.all(selectedUsers.map(async (user) => {
      try {
        await addIamGroupUser(contextIdForApi, groupName, user.name);
        return { user, error: null };
      } catch (err) {
        return { user, error: extractApiError(err, text("Unable to update IAM group membership.")) };
      }
    }));
    const failures = results.filter((result) => result.error !== null);
    await load(contextIdForApi, groupName);
    setBusy(null);
    if (failures.length === 0) {
      setPickerOpen(false);
      setSelectedUsers([]);
      setActionMessage(text("Members added"));
      return;
    }
    setSelectedUsers(failures.map((result) => result.user));
    setAssociationFailures(failures.map((result) => ({
      id: result.user.name,
      label: result.user.name,
      message: result.error ?? text("Unable to update IAM group membership."),
    })));
  };

  const removeUser = async (userName: string) => {
    if (needsContextSelection || !groupName) return;
    setBusy(userName);
    setError(null);
    setActionMessage(null);
    try {
      await removeIamGroupUser(contextIdForApi, groupName, userName);
      await load(contextIdForApi, groupName);
      setActionMessage(text("User removed from group"));
    } catch (err) {
      setError(extractApiError(err, "Unexpected error"));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = (userName: string) => {
    memberConfirmation.requestConfirmation({
      title: text("Remove user from group?"),
      description: text("Detach this IAM user from the selected group."),
      confirmLabel: text("Remove user"),
      details: [
        { label: text("Group"), value: decodedGroup },
        { label: text("User"), value: userName },
      ],
      impacts: ["Permissions inherited only through this group will no longer apply to the user."],
      onConfirm: () => removeUser(userName),
    });
  };

  if (isS3User) {
    if (embedded) {
      return <PageBanner tone="info">{text("IAM features are disabled for standalone S3 users. Select an S3 Account to continue.")}</PageBanner>;
    }
    return (
      <PageShell actionPresentation="listing"
          title={text("Group members")}
          description={text("Manage IAM group membership.")}
          breadcrumbs={managerPageBreadcrumbs(text, "groups", { label: text("Users") })}
      >
        <PageBanner tone="info">{text("IAM features are disabled for standalone S3 users. Select an S3 Account to continue.")}</PageBanner>
      </PageShell>
    );
  }

  if (!groupName) {
    return <div className="ui-body text-slate-600">{text("Group not specified.")}</div>;
  }

  if (needsContextSelection) {
    return <div className="ui-body text-slate-600">{text("Select a context before managing groups.")}</div>;
  }

  const handleRefresh = () => {
    if (needsContextSelection) return;
    if (groupName) {
      load(contextIdForApi, groupName);
    }
  };

  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: users.length,
  });
  const userColumns: Array<DataTableColumn<IAMUser>> = [
    {
      id: "user",
      label: text("User"),
      primary: true,
      render: (user) => user.name,
    },
    {
      id: "actions",
      label: text("Actions"),
      align: "right",
      mobileRole: "actions",
      render: (user) => (
        <ListActionButton variant="danger"
          type="button"
          onClick={() => handleRemove(user.name)}
          disabled={busy === user.name}
        >
          {text(busy === user.name ? "Removing..." : "Remove")}
        </ListActionButton>
      ),
    },
  ];

  const content = <>
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{text(error)}</PageBanner>}
      <ListPageSection
        variant="page"
        title={text("Members")}
        countLabel={text("Associated: {count}", { count: users.length })}
        actions={(
          <ListActionButton type="button" onClick={openPicker} disabled={pickerOpen || busy !== null}>
            {text("Add members")}
          </ListActionButton>
        )}
      >
        <DataTableShell
          columns={userColumns}
          rows={users}
          rowKey={(user) => user.name}
          status={tableStatus}
          loadingMessage={text("Loading members...")}
          errorMessage={text("Unable to load users.")}
          emptyMessage={text("No members in this group.")}
          tableClassName="ui-data-table"
          responsiveCards
        />
        {pickerOpen ? (
          <ManagerIamAssociationPicker
            title={text("Add members")}
            searchLabel={text("Search IAM users")}
            searchPlaceholder={text("Search users by name")}
            emptyMessage={userOptions.search.trim()
              ? text("No matching users.")
              : text("No IAM users available to add. Create one before managing this group.")}
            items={availableUsers.map((user) => ({ id: user.name, label: user.name, secondary: user.arn }))}
            selectedIds={selectedUsers.map((user) => user.name)}
            search={userOptions.search}
            loading={userOptions.loading}
            error={userOptions.error}
            failures={associationFailures}
            page={userOptions.page}
            pageSize={userOptions.pageSize}
            canPrevious={userOptions.canPrevious}
            canNext={userOptions.canNext}
            submitting={busy === "add"}
            submitLabel={text("Add")}
            onSearchChange={userOptions.setSearch}
            onToggle={toggleUser}
            onPreviousPage={userOptions.previousPage}
            onNextPage={userOptions.nextPage}
            onCancel={closePicker}
            onSubmit={() => void handleAdd()}
          />
        ) : null}
      </ListPageSection>
      {memberConfirmation.confirmationDialog}
    </>;

  if (embedded) return <div className="space-y-4">{content}</div>;

  return (
    <PageShell actionPresentation="listing"
      title={text("Group members")}
      description={
        <>
          {text("Manage users for")} <span className="font-semibold text-slate-700 dark:text-slate-100">{decodedGroup}</span>.
        </>
      }
      breadcrumbs={managerPageBreadcrumbs(text, "groups",
        { label: decodedGroup },
        { label: text("Users") },
      )}
      actions={[
        { label: text("← Back to groups"), to: "/manager/groups", variant: "ghost" },
        { label: text("Attached policies"), to: `/manager/groups/${encodeURIComponent(decodedGroup)}/policies`, variant: "ghost" },
        { label: text("Refresh"), onClick: handleRefresh, variant: "ghost" },
      ]}
    >
      {content}
    </PageShell>
  );
}
