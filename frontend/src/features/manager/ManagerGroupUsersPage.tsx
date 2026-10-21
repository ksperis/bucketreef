/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ListPageSection from "../../components/list/ListPageSection";
import { ListActionButton } from "../../components/list/ListControls";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { S3ExecutionContextSelector } from "../../api/accountParams";
import { IAMUser, listIamUsers } from "../../api/managerIamUsers";
import { addIamGroupUser, listIamGroupUsers, removeIamGroupUser } from "../../api/managerIamGroups";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import PageShell from "../../components/PageShell";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import UiButton from "../../components/ui/UiButton";
import UiSelect from "../../components/ui/UiSelect";
import { useManagerI18n } from "./managerI18n";

export default function ManagerGroupUsersPage({ embedded = false }: { embedded?: boolean }) {
  const { text } = useManagerI18n();
  const { groupName } = useParams<{ groupName: string }>();
  const { selectedContextKind, contextIdForApi, requiresContextSelection, accessMode } = useS3AccountContext();
  const needsContextSelection = requiresContextSelection && !contextIdForApi;
  const isS3User = selectedContextKind === "s3_user";

  const [users, setUsers] = useState<IAMUser[]>([]);
  const [allUsers, setAllUsers] = useState<IAMUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newUser, setNewUser] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const memberConfirmation = useConfirmActionDialog();

  const decodedGroup = useMemo(() => {
    if (!groupName) return "";
    try {
      return decodeURIComponent(groupName);
    } catch {
      return groupName;
    }
  }, [groupName]);

  const load = useCallback(async (accountId: S3ExecutionContextSelector, targetGroup: string) => {
    setLoading(true);
    setError(null);
    try {
      const [members, existingUsers] = await Promise.all([
        listIamGroupUsers(accountId, targetGroup),
        listIamUsers(accountId),
      ]);
      setUsers(members);
      setAllUsers(existingUsers);
    } catch (err) {
      setError(extractApiError(err, "Unexpected error"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isS3User || needsContextSelection) {
      setUsers([]);
      setAllUsers([]);
      setLoading(false);
      return;
    }
    if (groupName) {
      load(contextIdForApi, groupName);
    }
  }, [contextIdForApi, isS3User, needsContextSelection, groupName, accessMode, load]);

  const availableUsers = useMemo(
    () => allUsers.filter((u) => !users.some((member) => member.name === u.name)),
    [allUsers, users]
  );
  const noAvailableUsers = availableUsers.length === 0;

  useEffect(() => {
    if (newUser && !availableUsers.some((u) => u.name === newUser)) {
      setNewUser("");
    }
  }, [availableUsers, newUser]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (needsContextSelection || !groupName || !newUser.trim()) return;
    setBusy("add");
    setError(null);
    setActionMessage(null);
    try {
      await addIamGroupUser(contextIdForApi, groupName, newUser.trim());
      setNewUser("");
      await load(contextIdForApi, groupName);
      setActionMessage(text("User added to group"));
    } catch (err) {
      setError(extractApiError(err, "Unexpected error"));
    } finally {
      setBusy(null);
    }
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
    return <div className="ui-body text-slate-600">{text("Select an account before managing groups.")}</div>;
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
      id: "arn",
      label: text("ARN"),
      cellClassName: "break-all font-mono text-[11px]",
      render: (user) => user.arn ?? "-",
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
      {embedded && (
        <div className="flex justify-end">
          <ListActionButton type="button" onClick={handleRefresh} disabled={loading}>
            {text("Refresh")}
          </ListActionButton>
        </div>
      )}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{text(error)}</PageBanner>}
      {noAvailableUsers && (
        <PageBanner tone="warning">{text("No IAM users available to add. Create one before managing this group.")}</PageBanner>
      )}

      <form
        onSubmit={handleAdd}
        className="space-y-3 ui-surface-card p-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <UiSelect
            label={text("IAM user")}
            fieldClassName="flex-1"
            className="w-full"
            value={newUser}
            onChange={(e) => setNewUser(e.target.value)}
          >
            <option value="">{text("Select an existing user")}</option>
            {availableUsers.map((u) => (
              <option key={u.name} value={u.name}>
                {u.name}
              </option>
            ))}
          </UiSelect>
          <UiButton
            type="submit"
            disabled={busy !== null || !newUser}
            loading={busy === "add"}
          >
            {text("Add")}
          </UiButton>
        </div>
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          {text("Users come from IAM. Add them here to attach them to the group.")}
        </p>
      </form>

      <ListPageSection variant="section" title={text("Users")} description={text("Members of this group.")}>
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
