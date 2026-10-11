import { ListActionButton } from "../../components/list/ListControls";
import type { ComponentType } from "react";

import {
  contextMenuItemClasses,
  contextMenuItemDisabledClasses,
} from "./browserConstants";
import {
  CopyIcon,
  CutIcon,
  DownloadIcon,
  EyeIcon,
  FolderIcon,
  FolderPlusIcon,
  HistoryIcon,
  InfoIcon,
  LinkIcon,
  ListIcon,
  OpenIcon,
  PasteIcon,
  RefreshIcon,
  SettingsIcon,
  SlidersIcon,
  TrashIcon,
  UploadIcon,
} from "./browserIcons";
import type { BrowserActionId, BrowserActionState } from "./browserActions";
import { useBrowserI18n } from "./browserI18n";

type ActionIconComponent = ComponentType<{ className?: string }>;

const actionIconById = {
  uploadFiles: UploadIcon,
  uploadFolder: FolderIcon,
  newFolder: FolderPlusIcon,
  paste: PasteIcon,
  versions: ListIcon,
  restoreToDate: HistoryIcon,
  cleanOldVersions: TrashIcon,
  multipartUploads: UploadIcon,
  configureBucket: SettingsIcon,
  copyPath: CopyIcon,
  refresh: RefreshIcon,
  toggleShowFolders: FolderIcon,
  toggleShowDeleted: TrashIcon,
  details: InfoIcon,
  properties: InfoIcon,
  open: OpenIcon,
  preview: EyeIcon,
  download: DownloadIcon,
  downloadZip: DownloadIcon,
  createPublicLink: LinkIcon,
  restore: HistoryIcon,
  copyUrl: LinkIcon,
  copy: CopyIcon,
  cut: CutIcon,
  bulkAttributes: SlidersIcon,
  advanced: SettingsIcon,
  delete: TrashIcon,
} satisfies Record<BrowserActionId, ActionIconComponent>;

type BrowserActionIconProps = {
  actionId: BrowserActionId;
  className?: string;
};

export function BrowserActionIcon({
  actionId,
  className = "h-3.5 w-3.5",
}: BrowserActionIconProps) {
  const Icon = actionIconById[actionId];
  return <Icon className={className} />;
}

type BrowserDirectItemActionButtonProps = {
  action: BrowserActionState;
  itemName: string;
  onSelect: () => void;
};

export function BrowserDirectItemActionButton({
  action,
  itemName,
  onSelect,
}: BrowserDirectItemActionButtonProps) {
  const { text } = useBrowserI18n();
  const accessibleLabel = text("{action} {name}", { action: text(action.label), name: itemName });
  const disabledLabel =
    !action.enabled && action.disabledReason
      ? text("{action}. Unavailable: {reason}", { action: accessibleLabel, reason: text(action.disabledReason) })
      : accessibleLabel;
  return (
    <ListActionButton iconOnly variant={action.id === "delete" ? "danger" : "secondary"}
      aria-label={disabledLabel}
      title={action.enabled ? text(action.label) : action.disabledReason ? text(action.disabledReason) : undefined}
      disabled={!action.enabled}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <BrowserActionIcon actionId={action.id} />
    </ListActionButton>
  );
}

type BrowserToolbarActionMenuItemProps = {
  action: BrowserActionState;
  onSelect: () => void;
};

export function BrowserToolbarActionMenuItem({
  action,
  onSelect,
}: BrowserToolbarActionMenuItemProps) {
  const { text } = useBrowserI18n();
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={text(action.label)}
      className={`${contextMenuItemClasses} ${
        !action.enabled ? contextMenuItemDisabledClasses : ""
      }`}
      onClick={onSelect}
      disabled={!action.enabled}
      title={action.disabledReason ? text(action.disabledReason) : undefined}
    >
      <BrowserActionIcon actionId={action.id} />
      {text(action.label)}
    </button>
  );
}
