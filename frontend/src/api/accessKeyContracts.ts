/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export const ACCESS_KEY_NAME_MAX_LENGTH = 128;
export const ACCESS_KEY_NOTES_MAX_LENGTH = 2000;

export type AccessKeyExpirationState =
  | "scheduled"
  | "retrying"
  | "enforced"
  | "blocked";

export type AccessKeyMetadataInput = {
  name?: string | null;
  notes?: string | null;
  expires_at?: string | null;
};

export type AccessKeyMetadata = {
  name: string | null;
  notes: string | null;
  expires_at: string | null;
  expiration_state: AccessKeyExpirationState | null;
  expiration_enforced_at: string | null;
  expiration_last_attempt_at: string | null;
  expiration_last_error: string | null;
};
