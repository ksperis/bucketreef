/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { KeyboardEvent } from "react";
import type { LDAPProviderInfo } from "../../api/auth";
import type { LdapImportSearchItem } from "../../api/users";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { SettingsChoiceRow, SettingsSection } from "../../components/settings/SettingsLayout";
import UiBadge from "../../components/ui/UiBadge";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { uiPanelMutedClass } from "../../components/ui/styles";
import type { UsersText } from "./usersMessage";

export type UserCreationSource = "local" | "ldap";

export default function AdminUserLdapImportFields({
  source,
  onSourceChange,
  providers,
  providersLoading,
  providerId,
  onProviderChange,
  query,
  onQueryChange,
  onSearch,
  searchLoading,
  searchError,
  items,
  truncated,
  searchPerformed,
  selected,
  onSelect,
  onLinkExisting,
  onRestore,
  busy,
  text,
}: {
  source: UserCreationSource;
  onSourceChange: (source: UserCreationSource) => void;
  providers: LDAPProviderInfo[];
  providersLoading: boolean;
  providerId: string;
  onProviderChange: (providerId: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  searchLoading: boolean;
  searchError: string | null;
  items: LdapImportSearchItem[];
  truncated: boolean;
  searchPerformed: boolean;
  selected: LdapImportSearchItem | null;
  onSelect: (item: LdapImportSearchItem) => void;
  onLinkExisting: (item: LdapImportSearchItem) => void;
  onRestore: (item: LdapImportSearchItem) => void;
  busy: boolean;
  text: UsersText;
}) {
  const canSearch = !busy && !searchLoading && Boolean(providerId) && query.trim().length >= 2;

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !canSearch) return;
    event.preventDefault();
    onSearch();
  };

  return (
    <SettingsSection title={text("identitySource")} description={text("identitySourceDescription")} presentation="compact">
      <div className="settings-fields">
        <fieldset aria-label={text("identitySource")}>
          <SettingsChoiceRow
            type="radio"
            name="user-creation-source"
            title={text("localAccount")}
            description={text("localAccountDescription")}
            checked={source === "local"}
            disabled={busy}
            onChange={() => onSourceChange("local")}
          />
          <SettingsChoiceRow
            type="radio"
            name="user-creation-source"
            title={text("ldapDirectory")}
            description={text("ldapDirectoryDescription")}
            checked={source === "ldap"}
            disabled={busy}
            onChange={() => onSourceChange("ldap")}
          />
        </fieldset>

        {source === "ldap" && (
          <div className="settings-stack">
            <UiSelect
              label={text("ldapProvider")}
              value={providerId}
              disabled={busy || providersLoading || providers.length === 0}
              onChange={(event) => onProviderChange(event.target.value)}
            >
              <option value="">{providersLoading ? text("loadingLdapProviders") : text("selectLdapProvider")}</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.display_name}</option>
              ))}
            </UiSelect>
            {!providersLoading && providers.length === 0 && (
              <UiInlineMessage tone="warning">{text("noLdapProviders")}</UiInlineMessage>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <UiInput
                  id="admin-user-ldap-search"
                  label={text("searchLdapDirectory")}
                  value={query}
                  disabled={busy || !providerId}
                  placeholder={text("ldapSearchPlaceholder")}
                  aria-describedby="admin-user-ldap-search-hint"
                  onChange={(event) => onQueryChange(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
              </div>
              <SettingsButton
                variant="secondary"
                disabled={!canSearch}
                onClick={onSearch}
              >
                {searchLoading ? text("searching") : text("search")}
              </SettingsButton>
            </div>
            <p id="admin-user-ldap-search-hint" className="ui-caption text-[var(--ui-text-muted)]">
              {text("ldapSearchHint")}
            </p>
            {searchError && <UiInlineMessage tone="error" role="alert">{searchError}</UiInlineMessage>}
            {truncated && <UiInlineMessage tone="info">{text("ldapSearchTruncated")}</UiInlineMessage>}
            {searchPerformed && !searchLoading && !searchError && items.length === 0 && (
              <UiInlineMessage tone="neutral">{text("noLdapMatches")}</UiInlineMessage>
            )}
            {items.length > 0 && (
              <div
                className="settings-stack max-h-80 overflow-y-auto pr-1"
                role="list"
                aria-label={text("ldapSearchResults")}
              >
                {items.map((item) => {
                  const linked = item.linked_user;
                  const emailMatch = item.email_match_user;
                  const isSelected = selected?.selection_token === item.selection_token;
                  return (
                    <div key={item.selection_token} role="listitem" className={`${uiPanelMutedClass} p-3`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-[var(--ui-text)]">
                            {item.full_name || item.email || item.directory_dn}
                          </div>
                          {item.email && <div className="ui-caption text-[var(--ui-text-muted)]">{item.email}</div>}
                          <div className="ui-caption break-all text-[var(--ui-text-muted)]">{item.directory_dn}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {item.identity_state === "linked" && <UiBadge tone="neutral">{text("alreadyLinked")}</UiBadge>}
                          {item.identity_state === "revoked" && <UiBadge tone="warning">{text("revokedLink")}</UiBadge>}
                          {isSelected && <UiBadge tone="primary">{text("selected")}</UiBadge>}
                        </div>
                      </div>
                      {linked && (
                        <p className="settings-description mt-2">
                          {text("ldapLinkedUser", { email: linked.email })}
                        </p>
                      )}
                      {!linked && emailMatch && (
                        <p className="settings-description mt-2">
                          {text("ldapEmailMatch", { email: emailMatch.email })}
                        </p>
                      )}
                      {!item.email && (
                        <p className="settings-description mt-2">{text("ldapMissingEmail")}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.identity_state === "available" && !emailMatch && (
                          <SettingsButton variant="secondary" disabled={busy} onClick={() => onSelect(item)}>
                            {text("useLdapEntry")}
                          </SettingsButton>
                        )}
                        {item.identity_state === "available" && emailMatch && (
                          <SettingsButton disabled={busy} onClick={() => onLinkExisting(item)}>
                            {text("linkExistingUser")}
                          </SettingsButton>
                        )}
                        {item.identity_state === "revoked" && linked && (
                          <SettingsButton variant="secondary" disabled={busy} onClick={() => onRestore(item)}>
                            {text("restoreLdapLink")}
                          </SettingsButton>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
