/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { addIamGroupUser, listIamGroups, removeIamGroupUser, type IAMGroup } from "../../api/managerIamGroups";
import { getIamUser } from "../../api/managerIamUsers";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListActionButton } from "../../components/list/ListControls";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiSelect from "../../components/ui/UiSelect";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { extractApiError } from "../../utils/apiError";
import { useManagerI18n } from "./managerI18n";
import { useS3AccountContext } from "./S3AccountContext";

export default function ManagerUserGroupsPage() {
  const { text } = useManagerI18n();
  const { userName } = useParams<{ userName: string }>();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  const decodedUser = useMemo(() => {
    if (!userName) return "";
    try { return decodeURIComponent(userName); } catch { return userName; }
  }, [userName]);
  const [groups, setGroups] = useState<IAMGroup[]>([]);
  const [allGroups, setAllGroups] = useState<IAMGroup[]>([]);
  const [newGroup, setNewGroup] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const membershipConfirmation = useConfirmActionDialog();

  const load = useCallback(async (accountId: S3ExecutionContextSelector, targetUser: string) => {
    setLoading(true);
    setError(null);
    try {
      const [user, availableGroups] = await Promise.all([
        getIamUser(accountId, targetUser),
        listIamGroups(accountId),
      ]);
      const membership = new Set(user.groups ?? []);
      setAllGroups(availableGroups);
      setGroups(availableGroups.filter((group) => membership.has(group.name)));
    } catch (err) {
      setError(extractApiError(err, text("Unable to load IAM groups.")));
    } finally {
      setLoading(false);
    }
  }, [text]);

  useEffect(() => {
    if (!userName || needsS3AccountSelection || isS3User) {
      setGroups([]);
      setAllGroups([]);
      setLoading(false);
      return;
    }
    void load(accountIdForApi, userName);
  }, [accessMode, accountIdForApi, isS3User, load, needsS3AccountSelection, userName]);

  const availableGroups = useMemo(
    () => allGroups.filter((group) => !groups.some((current) => current.name === group.name)),
    [allGroups, groups],
  );

  useEffect(() => {
    if (newGroup && !availableGroups.some((group) => group.name === newGroup)) setNewGroup("");
  }, [availableGroups, newGroup]);

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (!userName || !newGroup || busy) return;
    setBusy("add");
    setError(null);
    setActionMessage(null);
    try {
      await addIamGroupUser(accountIdForApi, newGroup, userName);
      setNewGroup("");
      await load(accountIdForApi, userName);
      setActionMessage(text("User added to group"));
    } catch (err) {
      setError(extractApiError(err, text("Unable to update IAM group membership.")));
    } finally {
      setBusy(null);
    }
  };

  const removeGroup = async (groupName: string) => {
    if (!userName) return;
    setBusy(groupName);
    setError(null);
    setActionMessage(null);
    try {
      await removeIamGroupUser(accountIdForApi, groupName, userName);
      await load(accountIdForApi, userName);
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
    { id: "arn", label: text("ARN"), cellClassName: "break-all font-mono text-[11px]", render: (group) => group.arn ?? "-" },
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
  if (needsS3AccountSelection) return <div className="ui-body text-slate-600">{text("Select an account before managing groups.")}</div>;

  return (
    <div className="space-y-4">
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {error && <PageBanner tone="error">{text(error)}</PageBanner>}
      {availableGroups.length === 0 && (
        <PageBanner tone="warning">{text("No IAM groups available to add. Create one before managing this user.")}</PageBanner>
      )}
      <form onSubmit={handleAdd} className="space-y-3 ui-surface-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <UiSelect
            label={text("IAM group")}
            fieldClassName="flex-1"
            className="w-full"
            value={newGroup}
            onChange={(event) => setNewGroup(event.target.value)}
          >
            <option value="">{text("Select an existing group")}</option>
            {availableGroups.map((group) => <option key={group.name} value={group.name}>{group.name}</option>)}
          </UiSelect>
          <UiButton type="submit" disabled={busy !== null || !newGroup} loading={busy === "add"}>
            {text("Add")}
          </UiButton>
        </div>
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          {text("Add the user to an existing IAM group to inherit that group's permissions.")}
        </p>
      </form>
      <ListPageSection variant="section" title={text("Groups")} description={text("Groups this user belongs to.")}>
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
      </ListPageSection>
      {membershipConfirmation.confirmationDialog}
    </div>
  );
}
