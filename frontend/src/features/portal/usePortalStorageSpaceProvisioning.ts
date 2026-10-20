/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  createPortalStorageSpace,
  importPortalStorageSpace,
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceGrantRole,
} from "../../api/portal";
import {
  listPortalShareCandidates,
  type PortalStorageSpaceShareCandidate,
} from "../../api/portalSharing";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { focusFirstInvalidField } from "../../utils/focusFirstInvalidField";
import { isValidS3BucketName } from "../../utils/s3BucketName";
import { stableSignature } from "../../utils/stableSignature";
import {
  portalAccessPayloadFromMode,
  selectedPortalShares,
  type PortalAccessMode,
} from "./PortalAccessControls";
import { storageSpacePath } from "./portalWorkspaceModel";

type UsePortalStorageSpaceProvisioningOptions = {
  accountId: S3AccountSelector;
  canCreatePrivate: boolean;
  canCreateTeam: boolean;
  canImport: boolean;
  canUseNamedBucket: boolean;
};

function updateRestrictedRole(
  current: Record<number, PortalStorageSpaceGrantRole>,
  userId: number,
  role: PortalStorageSpaceGrantRole | null,
) {
  const next = { ...current };
  if (!role) {
    delete next[userId];
  } else {
    next[userId] = role;
  }
  return next;
}

export function usePortalStorageSpaceProvisioning({
  accountId,
  canCreatePrivate,
  canCreateTeam,
  canImport,
  canUseNamedBucket,
}: UsePortalStorageSpaceProvisioningOptions) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAccessMode, setNewAccessMode] = useState<PortalAccessMode>("private");
  const [newAccountMemberRole, setNewAccountMemberRole] =
    useState<PortalStorageSpaceAccountMemberRole>("Editor");
  const [restrictedRolesByUserId, setRestrictedRolesByUserId] = useState<
    Record<number, PortalStorageSpaceGrantRole>
  >({});
  const [shareCandidateQuery, setShareCandidateQuery] = useState("");
  const [newNamingMode, setNewNamingMode] = useState<
    "generic_uuid" | "named_bucket"
  >("generic_uuid");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createValidationAttempted, setCreateValidationAttempted] = useState(false);
  const [importBucketName, setImportBucketName] = useState("");
  const [importDescription, setImportDescription] = useState("");
  const [importAccessMode, setImportAccessMode] =
    useState<PortalAccessMode>("private");
  const [importAccountMemberRole, setImportAccountMemberRole] =
    useState<PortalStorageSpaceAccountMemberRole>("Editor");
  const [importRestrictedRolesByUserId, setImportRestrictedRolesByUserId] =
    useState<Record<number, PortalStorageSpaceGrantRole>>({});
  const [importShareCandidateQuery, setImportShareCandidateQuery] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [shareCandidates, setShareCandidates] = useState<
    PortalStorageSpaceShareCandidate[]
  >([]);
  const [shareCandidatesLoading, setShareCandidatesLoading] = useState(false);
  const [shareCandidatesError, setShareCandidatesError] = useState<string | null>(
    null,
  );
  const createFocusReturnRef = useRef<HTMLElement | null>(null);
  const importFocusReturnRef = useRef<HTMLElement | null>(null);

  const canCreate = canCreatePrivate || canCreateTeam;
  const createAccessModes = useMemo<PortalAccessMode[]>(
    () => [
      ...(canCreatePrivate ? (["private"] as PortalAccessMode[]) : []),
      ...(canCreateTeam ? (["account", "restricted"] as PortalAccessMode[]) : []),
    ],
    [canCreatePrivate, canCreateTeam],
  );
  const importAccessModes = useMemo<PortalAccessMode[]>(
    () => [
      ...(canCreatePrivate ? (["private"] as PortalAccessMode[]) : []),
      "account",
      "restricted",
    ],
    [canCreatePrivate],
  );
  const effectiveNamingMode = canUseNamedBucket
    ? newNamingMode
    : "generic_uuid";
  const effectiveNewAccessMode: PortalAccessMode = createAccessModes.includes(
    newAccessMode,
  )
    ? newAccessMode
    : createAccessModes[0] ?? "private";
  const selectedRestrictedEntries = selectedPortalShares(
    restrictedRolesByUserId,
  );
  const selectedImportRestrictedEntries = selectedPortalShares(
    importRestrictedRolesByUserId,
  );
  const portalMemberCount = shareCandidates.length + 1;
  const newNameError =
    effectiveNamingMode === "named_bucket" &&
    newName &&
    !isValidS3BucketName(newName)
      ? t({
          en: "Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.",
          fr: "Nom invalide. 3 à 63 caractères : lettres minuscules, chiffres, points ou tirets.",
          de: "Ungültiger Name. 3–63 Zeichen: Kleinbuchstaben, Ziffern, Punkte oder Bindestriche.",
          zh: "名称无效。长度为 3–63 个字符，只能包含小写字母、数字、点或连字符。",
        })
      : createValidationAttempted && !newName.trim()
        ? t({
            en: "Space name is required.",
            fr: "Le nom de l'espace est obligatoire.",
            de: "Ein Bereichsname ist erforderlich.",
            zh: "空间名称为必填项。",
          })
        : undefined;

  const createFormSignature = useMemo(
    () =>
      stableSignature({
        name: newName,
        description: newDescription,
        namingMode: newNamingMode,
        accessMode: effectiveNewAccessMode,
        accountMemberRole: newAccountMemberRole,
        restrictedRolesByUserId,
      }),
    [
      effectiveNewAccessMode,
      newAccountMemberRole,
      newDescription,
      newName,
      newNamingMode,
      restrictedRolesByUserId,
    ],
  );
  const importFormSignature = useMemo(
    () =>
      stableSignature({
        bucketName: importBucketName,
        description: importDescription,
        accessMode: importAccessMode,
        accountMemberRole: importAccountMemberRole,
        restrictedRolesByUserId: importRestrictedRolesByUserId,
      }),
    [
      importAccessMode,
      importAccountMemberRole,
      importBucketName,
      importDescription,
      importRestrictedRolesByUserId,
    ],
  );

  const closeCreate = useCallback(
    (reason?: "navigation") => {
      const focusTarget = createFocusReturnRef.current;
      createFocusReturnRef.current = null;
      setShowCreate(false);
      setCreateError(null);
      if (reason !== "navigation" && searchParams.get("create") === "1") {
        const next = new URLSearchParams(searchParams);
        next.delete("create");
        setSearchParams(next, { replace: true });
      }
      window.requestAnimationFrame(() => {
        if (focusTarget?.isConnected) focusTarget.focus();
      });
    },
    [searchParams, setSearchParams],
  );

  const openCreate = useCallback(() => {
    createFocusReturnRef.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    setNewName("");
    setNewDescription("");
    setNewNamingMode("generic_uuid");
    setNewAccessMode(createAccessModes[0] ?? "private");
    setNewAccountMemberRole("Editor");
    setRestrictedRolesByUserId({});
    setShareCandidateQuery("");
    setCreateError(null);
    setCreateValidationAttempted(false);
    setShowCreate(true);
  }, [createAccessModes]);

  const closeImport = useCallback(() => {
    const focusTarget = importFocusReturnRef.current;
    importFocusReturnRef.current = null;
    setShowImport(false);
    setImportError(null);
    window.requestAnimationFrame(() => {
      if (focusTarget?.isConnected) focusTarget.focus();
    });
  }, []);

  const openImport = useCallback(() => {
    importFocusReturnRef.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    setImportBucketName("");
    setImportDescription("");
    setImportAccessMode(importAccessModes[0] ?? "private");
    setImportAccountMemberRole("Editor");
    setImportRestrictedRolesByUserId({});
    setImportShareCandidateQuery("");
    setImportError(null);
    setShowImport(true);
  }, [importAccessModes]);

  useEffect(() => {
    if (canCreate && searchParams.get("create") === "1") {
      openCreate();
    }
  }, [canCreate, openCreate, searchParams]);

  useEffect(() => {
    if (!createAccessModes.includes(newAccessMode) && createAccessModes[0]) {
      setNewAccessMode(createAccessModes[0]);
    }
  }, [createAccessModes, newAccessMode]);

  useEffect(() => {
    if (!importAccessModes.includes(importAccessMode) && importAccessModes[0]) {
      setImportAccessMode(importAccessModes[0]);
    }
  }, [importAccessMode, importAccessModes]);

  useEffect(() => {
    let cancelled = false;
    const needsCandidates =
      (showCreate && effectiveNewAccessMode !== "private") ||
      (showImport && importAccessMode !== "private" && canImport);
    if (!needsCandidates || !accountId) {
      setShareCandidates([]);
      setShareCandidatesLoading(false);
      setShareCandidatesError(null);
      return () => {
        cancelled = true;
      };
    }
    setShareCandidatesLoading(true);
    setShareCandidatesError(null);
    listPortalShareCandidates(accountId)
      .then((candidates) => {
        if (!cancelled) setShareCandidates(candidates);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setShareCandidates([]);
          setShareCandidatesError(
            extractApiError(
              err,
              t({
                en: "Unable to load people.",
                fr: "Impossible de charger les personnes.",
                de: "Personen können nicht geladen werden.",
                zh: "无法加载人员。",
              }),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setShareCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    canImport,
    effectiveNewAccessMode,
    importAccessMode,
    showCreate,
    showImport,
    t,
  ]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    setCreateValidationAttempted(true);
    if (!accountId || !canCreate || !newName.trim() || newNameError) {
      focusFirstInvalidField(event.currentTarget);
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const accessPayload = portalAccessPayloadFromMode(
        effectiveNewAccessMode,
        newAccountMemberRole,
      );
      const created = await createPortalStorageSpace(accountId, {
        name:
          effectiveNamingMode === "named_bucket" ? newName : newName.trim(),
        naming_mode: effectiveNamingMode,
        description: newDescription.trim() || null,
        ...accessPayload,
        initial_shares:
          accessPayload.share_scope === "restricted"
            ? selectedRestrictedEntries
            : [],
      });
      flushSync(() => setShowCreate(false));
      navigate(storageSpacePath({ id: created.id }), {
        state: { portalSpaceCreated: true },
      });
    } catch (err) {
      console.error(err);
      setCreateError(
        extractApiError(
          err,
          t({
            en: "Unable to create this space.",
            fr: "Impossible de créer cet espace.",
            de: "Dieser Bereich kann nicht erstellt werden.",
            zh: "无法创建此空间。",
          }),
        ),
      );
    } finally {
      setCreateBusy(false);
    }
  };

  const handleImport = async () => {
    if (!accountId || !importBucketName.trim()) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const accessPayload = portalAccessPayloadFromMode(
        importAccessMode,
        importAccountMemberRole,
      );
      const imported = await importPortalStorageSpace(accountId, {
        bucket_name: importBucketName.trim(),
        description: importDescription.trim() || null,
        ...accessPayload,
        initial_shares:
          accessPayload.share_scope === "restricted"
            ? selectedImportRestrictedEntries
            : [],
      });
      flushSync(() => setShowImport(false));
      navigate(storageSpacePath({ id: imported.id }), {
        state: { portalSpaceImported: true },
      });
    } catch (err) {
      console.error(err);
      setImportError(
        extractApiError(
          err,
          t({
            en: "Unable to add existing storage.",
            fr: "Impossible d'ajouter le stockage existant.",
            de: "Vorhandener Speicher kann nicht hinzugefügt werden.",
            zh: "无法添加现有存储。",
          }),
        ),
      );
    } finally {
      setImportBusy(false);
    }
  };

  return {
    candidates: {
      items: shareCandidates,
      loading: shareCandidatesLoading,
      error: shareCandidatesError,
      portalMemberCount,
    },
    create: {
      open: showCreate,
      openDialog: openCreate,
      closeDialog: closeCreate,
      accessModes: createAccessModes,
      name: newName,
      setName: setNewName,
      description: newDescription,
      setDescription: setNewDescription,
      accessMode: newAccessMode,
      setAccessMode: setNewAccessMode,
      effectiveAccessMode: effectiveNewAccessMode,
      accountMemberRole: newAccountMemberRole,
      setAccountMemberRole: setNewAccountMemberRole,
      namingMode: newNamingMode,
      setNamingMode: setNewNamingMode,
      effectiveNamingMode,
      restrictedRolesByUserId,
      setRestrictedRole: (
        userId: number,
        role: PortalStorageSpaceGrantRole | null,
      ) =>
        setRestrictedRolesByUserId((current) =>
          updateRestrictedRole(current, userId, role),
        ),
      candidateQuery: shareCandidateQuery,
      setCandidateQuery: setShareCandidateQuery,
      selectedRestrictedEntries,
      formSignature: createFormSignature,
      busy: createBusy,
      error: createError,
      nameError: newNameError,
      submit: handleCreate,
    },
    importFlow: {
      open: showImport,
      openDialog: openImport,
      closeDialog: closeImport,
      accessModes: importAccessModes,
      bucketName: importBucketName,
      setBucketName: setImportBucketName,
      description: importDescription,
      setDescription: setImportDescription,
      accessMode: importAccessMode,
      setAccessMode: setImportAccessMode,
      accountMemberRole: importAccountMemberRole,
      setAccountMemberRole: setImportAccountMemberRole,
      restrictedRolesByUserId: importRestrictedRolesByUserId,
      setRestrictedRole: (
        userId: number,
        role: PortalStorageSpaceGrantRole | null,
      ) =>
        setImportRestrictedRolesByUserId((current) =>
          updateRestrictedRole(current, userId, role),
        ),
      candidateQuery: importShareCandidateQuery,
      setCandidateQuery: setImportShareCandidateQuery,
      selectedRestrictedEntries: selectedImportRestrictedEntries,
      formSignature: importFormSignature,
      busy: importBusy,
      error: importError,
      submit: handleImport,
    },
  };
}
