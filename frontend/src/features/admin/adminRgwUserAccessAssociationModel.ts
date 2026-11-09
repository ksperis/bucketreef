/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type {
  S3UserGroupLinkInput,
  S3UserUserLinkInput,
} from "../../api/s3Users";
import type { S3UserMembership } from "../../api/users";

export type AdminRgwUserAccessLink = {
  allow_manager_browser_data_access: boolean;
};

export type AdminRgwUserAccessLinkAdapter<
  TLink extends AdminRgwUserAccessLink,
> = {
  getId: (link: TLink) => number;
  createLink: (id: number) => TLink;
  withAccess: (link: TLink, allowed: boolean) => TLink;
};

function withAccess<TLink extends AdminRgwUserAccessLink>(
  link: TLink,
  allowed: boolean,
): TLink {
  return { ...link, allow_manager_browser_data_access: allowed };
}

export const s3UserMembershipAdapter: AdminRgwUserAccessLinkAdapter<S3UserMembership> = {
  getId: (link) => link.s3_user_id,
  createLink: (id) => ({
    s3_user_id: id,
    allow_manager_browser_data_access: false,
  }),
  withAccess,
};

export const s3UserUserLinkAdapter: AdminRgwUserAccessLinkAdapter<S3UserUserLinkInput> = {
  getId: (link) => link.user_id,
  createLink: (id) => ({
    user_id: id,
    allow_manager_browser_data_access: false,
  }),
  withAccess,
};

export const s3UserGroupLinkAdapter: AdminRgwUserAccessLinkAdapter<S3UserGroupLinkInput> = {
  getId: (link) => link.group_id,
  createLink: (id) => ({
    group_id: id,
    allow_manager_browser_data_access: false,
  }),
  withAccess,
};
