/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { UiGroupAvatarDescriptor } from "../../api/groups";
import type { UserAvatarDescriptor } from "../../api/users";
import GroupAvatar from "../../components/GroupAvatar";
import UserAvatar from "../../components/UserAvatar";
import { cx, uiMutedTextClass } from "../../components/ui/styles";

export type AdminPrincipalPresentation =
  | {
      kind: "user";
      email?: string | null;
      fullName?: string | null;
      avatar?: UserAvatarDescriptor | null;
      fallback: string;
    }
  | {
      kind: "group";
      name?: string | null;
      description?: string | null;
      avatar?: UiGroupAvatarDescriptor | null;
      fallback: string;
    };

export default function AdminPrincipalIdentity({ principal }: { principal: AdminPrincipalPresentation }) {
  if (principal.kind === "user") {
    const fullName = principal.fullName?.trim() || null;
    const email = principal.email?.trim() || null;
    const displayName = fullName || email || principal.fallback;
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <UserAvatar
          avatar={principal.avatar}
          name={displayName}
          email={email ?? undefined}
          size="md"
          decorative
        />
        <span className="min-w-0">
          <span className="block break-words">{displayName}</span>
          {fullName && email ? (
            <span className={cx("block break-all text-[11px] font-medium", uiMutedTextClass)}>
              {email}
            </span>
          ) : null}
        </span>
      </span>
    );
  }

  const name = principal.name?.trim() || principal.fallback;
  const description = principal.description?.trim() || null;
  return (
    <div className="flex w-full items-center gap-2">
      <GroupAvatar avatar={principal.avatar} name={name} size="md" decorative />
      <span className="min-w-0">
        <span className="block truncate">{name}</span>
        {description ? (
          <span className="mt-0.5 block truncate ui-caption font-normal text-slate-500 dark:text-slate-400">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
