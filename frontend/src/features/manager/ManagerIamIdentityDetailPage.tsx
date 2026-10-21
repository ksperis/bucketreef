/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getIamUser, type IAMUser, updateIamUser } from "../../api/managerIamUsers";
import { getIamGroup, type IAMGroup, updateIamGroup } from "../../api/managerIamGroups";
import PageShell from "../../components/PageShell";
import SettingsWorkflowForm from "../../components/settings/SettingsWorkflowForm";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import { extractApiError } from "../../utils/apiError";
import { iamNameFormatError } from "../../utils/resourceNames";
import { stableSignature } from "../../utils/stableSignature";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { useS3AccountContext } from "./S3AccountContext";
import { iamPathFormatError } from "./iamIdentityForm";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { useManagerI18n } from "./managerI18n";

type Identity = IAMUser | IAMGroup;

export default function ManagerIamIdentityDetailPage({ kind, embedded = false }: { kind: "user" | "group"; embedded?: boolean }) {
  const { text } = useManagerI18n();
  const params = useParams<{ userName?: string; groupName?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedContextKind, contextIdForApi, requiresContextSelection, accessMode } = useS3AccountContext();
  const needsSelection = requiresContextSelection && !contextIdForApi;
  const isS3User = selectedContextKind === "s3_user";
  const encodedName = kind === "user" ? params.userName : params.groupName;
  const entityName = useMemo(() => {
    if (!encodedName) return "";
    try { return decodeURIComponent(encodedName); } catch { return encodedName; }
  }, [encodedName]);
  const [entity, setEntity] = useState<Identity | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState("/");
  const [initial, setInitial] = useState(() => stableSignature({ name: "", path: "/" }));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const listRoute = kind === "user" ? "/manager/users" : "/manager/groups";

  useEffect(() => {
    if (!entityName || needsSelection || isS3User) return;
    let cancelled = false;
    setLoading(true); setError(null); setSaved(false);
    const request = kind === "user" ? getIamUser(contextIdForApi, entityName) : getIamGroup(contextIdForApi, entityName);
    void request.then((loaded) => {
      if (cancelled) return;
      setEntity(loaded);
      setName(loaded.name);
      setPath(loaded.path ?? "/");
      setInitial(stableSignature({ name: loaded.name, path: loaded.path ?? "/" }));
    }).catch((err) => {
      if (!cancelled) setError(extractApiError(err, kind === "user" ? "Unable to load IAM user." : "Unable to load IAM group."));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessMode, contextIdForApi, entityName, isS3User, kind, needsSelection]);

  if (isS3User || needsSelection || !entityName) {
    return <PageShell title={text(kind === "user" ? "IAM user details" : "IAM group details")}
      description={text("Select an IAM-capable Manager context to continue.")}
      breadcrumbs={managerPageBreadcrumbs(text, kind === "user" ? "users" : "groups")} />;
  }

  const nameError = iamNameFormatError(name.trim(), kind);
  const pathError = iamPathFormatError(path.trim());
  const current = stableSignature({ name: name.trim(), path: path.trim() });
  const managed = Boolean(entity?.is_bucketreef_managed);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    if (saving || loading || managed || nameError || pathError || !name.trim()) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    setSaving(true); setError(null); setSaved(false);
    try {
      const updated = kind === "user"
        ? await updateIamUser(contextIdForApi, entityName, { name: name.trim(), path: path.trim() })
        : await updateIamGroup(contextIdForApi, entityName, { name: name.trim(), path: path.trim() });
      setEntity(updated); setName(updated.name); setPath(updated.path ?? "/");
      setInitial(stableSignature({ name: updated.name, path: updated.path ?? "/" }));
      setSaved(true);
      if (updated.name !== entityName) {
        const currentBase = `${listRoute}/${encodeURIComponent(entityName)}`;
        const suffix = location.pathname.startsWith(currentBase) ? location.pathname.slice(currentBase.length) : "";
        navigate(`${listRoute}/${encodeURIComponent(updated.name)}${suffix}`, { replace: true });
      }
    } catch (err) {
      setError(extractApiError(err, kind === "user" ? "Unable to update IAM user." : "Unable to update IAM group."));
    } finally { setSaving(false); }
  };

  return <SettingsWorkflowForm
    title={text(kind === "user" ? "IAM user details" : "IAM group details")}
    description={text(kind === "user" ? "Review and update the native IAM user identity." : "Review and update the native IAM group identity.")}
    breadcrumbs={managerPageBreadcrumbs(text, kind === "user" ? "users" : "groups", { label: entity?.name ?? entityName })}
    backLabel={text(kind === "user" ? "Back to users" : "Back to groups")}
    embedded={embedded}
    contentVariant="plain" dirty={current !== initial} loading={loading} busy={saving} readOnly={managed}
    error={error} onSubmit={submit} onClose={() => navigate(listRoute)} persistentEdit
    submitLabel={text("Save changes")} busyLabel={text("Saving...")}>
    {saved && <UiInlineMessage tone="success" role="status">{text("Changes saved")}</UiInlineMessage>}
    {managed && <UiInlineMessage tone="info">{text("This identity is managed by BucketReef and cannot be renamed or moved here.")}</UiInlineMessage>}
    <SettingsSection title={text("Identity")} presentation="compact">
      <div className="settings-fields md:grid-cols-2">
        <UiInput label={text(kind === "user" ? "User name" : "Group name")} value={name} required
          readOnly={managed} onChange={(event) => { setName(event.target.value); setSaved(false); }} error={nameError ? text(nameError) : undefined} />
        <UiInput label={text("IAM path")} value={path} required
          readOnly={managed} onChange={(event) => { setPath(event.target.value); setSaved(false); }} error={pathError ? text(pathError) : undefined}
          hint={text("Use '/' or a path that starts and ends with '/'.")} />
        <UiInput label="ARN" value={entity?.arn ?? ""} readOnly />
      </div>
    </SettingsSection>
  </SettingsWorkflowForm>;
}
