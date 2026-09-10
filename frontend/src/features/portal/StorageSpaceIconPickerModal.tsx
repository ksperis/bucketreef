/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  updatePortalStorageSpaceIcon,
  uploadPortalStorageSpaceIcon,
} from "../../api/portal";
import type {
  StorageSpaceIconPreset,
  StorageSpaceIconSource,
} from "../../api/storageSpaceIcons";
import { SettingsDialog as Modal, SettingsButton as UiButton, useSettingsCloseGuard } from "../../components/settings/SettingsControls";
import { settingsLabels } from "../../components/settings/settingsLabels";
import StorageSpaceIcon, {
  storageSpaceIconPresets,
} from "../../components/StorageSpaceIcon";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { cx, uiMutedTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import type { PortalWorkspaceSpace } from "./portalWorkspaceModel";

const MAX_ICON_BYTES = 1024 * 1024;
const ALLOWED_ICON_TYPES = new Set(["image/png", "image/jpeg"]);

const presetLabels: Record<StorageSpaceIconPreset, { en: string; fr: string; de: string }> = {
  bucket: { en: "Bucket", fr: "Seau", de: "Bucket" },
  folder: { en: "Folder", fr: "Dossier", de: "Ordner" },
  archive: { en: "Archive", fr: "Archive", de: "Archiv" },
  database: { en: "Database", fr: "Base de données", de: "Datenbank" },
  media: { en: "Media", fr: "Médias", de: "Medien" },
};

export default function StorageSpaceIconPickerModal({
  accountId,
  space,
  onClose,
  onSaved,
  onDirtyChange,
}: {
  accountId: S3AccountSelector;
  space: PortalWorkspaceSpace;
  onClose: () => void;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const initialSource: StorageSpaceIconSource = space.icon?.source ?? "preset";
  const [source, setSource] = useState<StorageSpaceIconSource>(initialSource);
  const [preset, setPreset] = useState<StorageSpaceIconPreset>(space.icon?.preset ?? "bucket");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const labels = settingsLabels(t);
  const dirty = source !== initialSource || (source === "preset" && preset !== (space.icon?.preset ?? "bucket")) || file !== null;
  const [preview, setPreview] = useState<string | null>(null);
  const active = useRef(true);
  const pending = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const initialFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const guard = useSettingsCloseGuard({ hasUnsavedChanges: dirty, onClose, disabled: busy,
    title: labels.discardTitle, description: labels.discardDescription,
    cancelLabel: labels.keepEditing, confirmLabel: labels.discard, closeLabel: labels.close });

  const save = async () => {
    if (pending.current || !dirty) return;
    if (source === "uploaded" && !file && initialSource !== "uploaded") {
      setError(t({
        en: "Choose a PNG or JPEG image.",
        fr: "Choisissez une image PNG ou JPEG.",
        de: "Wählen Sie ein PNG- oder JPEG-Bild.",
      }));
      fileInput.current?.focus();
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (source === "uploaded" && file) {
        await uploadPortalStorageSpaceIcon(accountId, space.id, file);
      } else {
        await updatePortalStorageSpaceIcon(accountId, space.id, {
          source,
          preset: source === "preset" ? preset : null,
        });
      }
      if (!active.current) return;
      onSaved();
      onClose();
    } catch (err) {
      if (active.current) setError(extractApiError(err, t({
        en: "Unable to update the Storage Space icon.",
        fr: "Impossible de mettre à jour l’icône de l’espace.",
        de: "Das Symbol des Speicherbereichs konnte nicht aktualisiert werden.",
      })));
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };

  return (
    <>
    <Modal
      title={t({ en: "Storage Space icon", fr: "Icône de l’espace", de: "Speicherbereichssymbol" })}
      onClose={guard.requestClose}
      initialFocusRef={initialFocus}
      closeLabel={labels.close}
      closeAriaLabel={labels.close}
      maxWidthClass="max-w-xl"
      closeOnBackdropClick={!busy}
      closeOnEscape={!busy}
    >
      <div className="settings-stack" ref={(node) => { initialFocus.current = node?.querySelector('input:checked') ?? null; }}>
        {source === "uploaded" && !preview && initialSource === "uploaded" && <StorageSpaceIcon icon={space.icon} name={space.name} size="md" decorative />}
        {source === "uploaded" && preview && <img src={preview} alt={t({ en: "Icon preview", fr: "Aperçu de l’icône", de: "Symbolvorschau" })} className="h-16 w-16 rounded object-contain" />}
        <p className={cx("settings-body", uiMutedTextClass)}>
          {t({
            en: "Choose a pictogram or upload a custom PNG/JPEG image (1 MiB maximum).",
            fr: "Choisissez un pictogramme ou importez une image PNG/JPEG personnalisée (1 Mio maximum).",
            de: "Wählen Sie ein Piktogramm oder laden Sie ein eigenes PNG-/JPEG-Bild hoch (maximal 1 MiB).",
          })}
        </p>

        <fieldset>
          <legend className="mb-2 settings-label">
            {t({ en: "Pictograms", fr: "Pictogrammes", de: "Piktogramme" })}
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {storageSpaceIconPresets.map((candidate) => {
              const selected = source === "preset" && preset === candidate;
              return (
                <label
                  key={candidate}
                  className={cx(
                    "flex cursor-pointer flex-col items-center gap-2 rounded-md border p-3 text-xs font-semibold transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary",
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-[color:var(--ui-border-soft)] hover:border-primary/50",
                  )}
                >
                  <input
                    disabled={busy}
                    type="radio"
                    name="storage-space-icon"
                    value={candidate}
                    checked={selected}
                    onChange={() => {
                      setSource("preset");
                      setPreset(candidate);
                      setError(null);
                    }}
                    className="sr-only peer"
                  />
                  <StorageSpaceIcon
                    icon={{ source: "preset", preset: candidate }}
                    name={presetLabels[candidate].en}
                    size="md"
                    decorative
                  />
                  <span>{t(presetLabels[candidate])}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <label
          className={cx(
            "block rounded-md border p-3",
            source === "uploaded"
              ? "border-primary bg-primary/5"
              : "border-[color:var(--ui-border-soft)]",
          )}
        >
          <span className="flex items-center gap-2 settings-label">
            <input
              disabled={busy}
              type="radio"
              name="storage-space-icon"
              checked={source === "uploaded"}
              onChange={() => {
                setSource("uploaded");
                setError(null);
              }}
            />
            {t({ en: "Custom image", fr: "Image personnalisée", de: "Eigenes Bild" })}
          </span>
          <input
            type="file"
            ref={fileInput}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "space-icon-error" : undefined}
            disabled={busy}
            accept="image/png,image/jpeg"
            aria-label={t({ en: "Custom image file", fr: "Fichier image personnalisé", de: "Eigene Bilddatei" })}
            className="mt-3 block w-full settings-body"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              setSource("uploaded");
              setError(null);
              if (nextFile && !ALLOWED_ICON_TYPES.has(nextFile.type)) {
                setFile(null);
                setError(t({ en: "The image must be a PNG or JPEG file.", fr: "L’image doit être un fichier PNG ou JPEG.", de: "Das Bild muss eine PNG- oder JPEG-Datei sein." }));
                return;
              }
              if (nextFile && nextFile.size > MAX_ICON_BYTES) {
                setFile(null);
                setError(t({ en: "The image must be 1 MiB or smaller.", fr: "L’image ne doit pas dépasser 1 Mio.", de: "Das Bild darf höchstens 1 MiB groß sein." }));
                return;
              }
              setFile(nextFile);
            }}
          />
        </label>

        {error ? <div id="space-icon-error"><UiInlineMessage tone="error" role="alert">{error}</UiInlineMessage></div> : null}

        <div className="flex justify-end gap-2">
          <UiButton variant="secondary" onClick={guard.requestClose} disabled={busy}>
            {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
          </UiButton>
          <UiButton onClick={save} loading={busy} disabled={!dirty || busy}>
            {t({ en: "Save icon", fr: "Enregistrer l’icône", de: "Symbol speichern" })}
          </UiButton>
        </div>
      </div>
    </Modal>
    {guard.confirmationDialog}
    </>
  );
}
