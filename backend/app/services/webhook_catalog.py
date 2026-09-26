# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.models.webhook import WebhookEventDefinition

ALL_WEBHOOK_EVENTS = "*"
MIGRATION_EVENT_TYPE = "manager.bucket_migration.event"
ENDPOINT_HEALTH_EVENT_TYPE = "system.endpoint_health.changed"
QUOTA_THRESHOLD_EVENT_TYPE = "system.quota.threshold_reached"
WEBHOOK_TEST_EVENT_TYPE = "system.webhook.test"

AUDIT_EVENT_TYPES = (
    'audit.admin.approve_portal_request',
    'audit.admin.connection.create',
    'audit.admin.connection.delete',
    'audit.admin.connection.remediate',
    'audit.admin.create_account',
    'audit.admin.create_s3_user',
    'audit.admin.create_s3_user_access_key',
    'audit.admin.create_storage_endpoint',
    'audit.admin.create_ui_group',
    'audit.admin.create_ui_user',
    'audit.admin.delete_account',
    'audit.admin.delete_avatar',
    'audit.admin.delete_s3_user',
    'audit.admin.delete_s3_user_access_key',
    'audit.admin.delete_storage_endpoint',
    'audit.admin.delete_ui_group',
    'audit.admin.delete_ui_group_avatar',
    'audit.admin.delete_ui_user',
    'audit.admin.import_accounts',
    'audit.admin.import_s3_users',
    'audit.admin.ldap_provider.create',
    'audit.admin.ldap_provider.delete',
    'audit.admin.ldap_provider.update',
    'audit.admin.message_portal_request',
    'audit.admin.oidc_provider.create',
    'audit.admin.oidc_provider.delete',
    'audit.admin.oidc_provider.update',
    'audit.admin.onboarding.dismiss',
    'audit.admin.onboarding.resume',
    'audit.admin.onboarding.save',
    'audit.admin.reject_portal_request',
    'audit.admin.rotate_s3_keys',
    'audit.admin.rotate_s3_user_keys',
    'audit.admin.set_default_storage_endpoint',
    'audit.admin.settings.update',
    'audit.admin.update_account',
    'audit.admin.update_account_portal_settings',
    'audit.admin.update_s3_user',
    'audit.admin.update_s3_user_access_key_status',
    'audit.admin.update_storage_endpoint',
    'audit.admin.update_storage_endpoint_tags',
    'audit.admin.update_ui_group',
    'audit.admin.update_ui_user',
    'audit.admin.upload_avatar',
    'audit.admin.upload_ui_group_avatar',
    'audit.admin.webhook_endpoint.create',
    'audit.admin.webhook_endpoint.delete',
    'audit.admin.webhook_endpoint.secret.rotate',
    'audit.admin.webhook_endpoint.test',
    'audit.admin.webhook_endpoint.update',
    'audit.auth.create_api_token',
    'audit.auth.external_identity_link_requested',
    'audit.auth.login_failure',
    'audit.auth.login_ldap_configuration_error',
    'audit.auth.login_ldap_primary_success',
    'audit.auth.login_ldap_provider_not_found',
    'audit.auth.login_oidc_failure',
    'audit.auth.login_oidc_primary_success',
    'audit.auth.login_primary_success',
    'audit.auth.login_rate_limited',
    'audit.auth.login_s3',
    'audit.auth.login_s3_custom_endpoint',
    'audit.auth.login_s3_failure',
    'audit.auth.logout',
    'audit.auth.recovery_code_authentication_success',
    'audit.auth.revoke_api_token',
    'audit.auth.webauthn_authentication_success',
    'audit.browser.connection.create',
    'audit.browser.connection.delete',
    'audit.browser.connection.update',
    'audit.browser.create_bucket',
    'audit.browser.delete_bucket_cors',
    'audit.browser.delete_bucket_encryption',
    'audit.browser.delete_bucket_lifecycle',
    'audit.browser.delete_bucket_logging',
    'audit.browser.delete_bucket_notifications',
    'audit.browser.delete_bucket_policy',
    'audit.browser.delete_bucket_replication',
    'audit.browser.delete_bucket_tags',
    'audit.browser.delete_bucket_website',
    'audit.browser.ensure_bucket_cors',
    'audit.browser.put_bucket_policy',
    'audit.browser.update_bucket_acl',
    'audit.browser.update_bucket_cors',
    'audit.browser.update_bucket_encryption',
    'audit.browser.update_bucket_lifecycle',
    'audit.browser.update_bucket_logging',
    'audit.browser.update_bucket_notifications',
    'audit.browser.update_bucket_object_lock',
    'audit.browser.update_bucket_replication',
    'audit.browser.update_bucket_tags',
    'audit.browser.update_bucket_versioning',
    'audit.browser.update_bucket_website',
    'audit.browser.update_public_access_block',
    'audit.ceph-admin.bucket_quota.update',
    'audit.ceph-admin.bucket_ui_tags.update_definition',
    'audit.ceph-admin.bucket_ui_tags.update_shared',
    'audit.ceph-admin.cancel_bucket_purge',
    'audit.ceph-admin.fail_bucket_purge',
    'audit.ceph-admin.finish_bucket_purge',
    'audit.ceph-admin.rgw_account.create',
    'audit.ceph-admin.rgw_account.update',
    'audit.ceph-admin.rgw_user.create',
    'audit.ceph-admin.rgw_user.update',
    'audit.ceph-admin.rgw_user_key.create',
    'audit.ceph-admin.rgw_user_key.delete',
    'audit.ceph-admin.rgw_user_key.update_status',
    'audit.ceph-admin.start_bucket_purge',
    'audit.manager.add_user_to_group',
    'audit.manager.attach_group_policy',
    'audit.manager.attach_role_policy',
    'audit.manager.attach_user_policy',
    'audit.manager.bucket_compare_remediation',
    'audit.manager.cancel_bucket_purge',
    'audit.manager.continue_bucket_migration',
    'audit.manager.create_access_key',
    'audit.manager.create_bucket',
    'audit.manager.create_bucket_migration',
    'audit.manager.create_iam_group',
    'audit.manager.create_iam_role',
    'audit.manager.create_iam_user',
    'audit.manager.create_managed_policy',
    'audit.manager.create_s3_user_access_key',
    'audit.manager.create_topic',
    'audit.manager.delete_access_key',
    'audit.manager.delete_bucket',
    'audit.manager.delete_bucket_cors',
    'audit.manager.delete_bucket_encryption',
    'audit.manager.delete_bucket_lifecycle',
    'audit.manager.delete_bucket_logging',
    'audit.manager.delete_bucket_migration',
    'audit.manager.delete_bucket_notifications',
    'audit.manager.delete_bucket_policy',
    'audit.manager.delete_bucket_replication',
    'audit.manager.delete_bucket_tags',
    'audit.manager.delete_bucket_website',
    'audit.manager.delete_group_inline_policy',
    'audit.manager.delete_iam_group',
    'audit.manager.delete_iam_role',
    'audit.manager.delete_iam_user',
    'audit.manager.delete_managed_policy',
    'audit.manager.delete_role_inline_policy',
    'audit.manager.delete_s3_user_access_key',
    'audit.manager.delete_topic',
    'audit.manager.delete_user_inline_policy',
    'audit.manager.detach_group_policy',
    'audit.manager.detach_role_policy',
    'audit.manager.detach_user_policy',
    'audit.manager.fail_bucket_purge',
    'audit.manager.finish_bucket_purge',
    'audit.manager.managed_private_access.cleanup_pending',
    'audit.manager.managed_private_access.compensation.failure',
    'audit.manager.managed_private_access.compensation.retry.success',
    'audit.manager.managed_private_access.compensation.success',
    'audit.manager.managed_private_access.delete.success',
    'audit.manager.managed_private_access.provision.failure',
    'audit.manager.managed_private_access.provision.start',
    'audit.manager.managed_private_access.provision.success',
    'audit.manager.pause_bucket_migration',
    'audit.manager.precheck_bucket_migration',
    'audit.manager.put_bucket_policy',
    'audit.manager.put_group_inline_policy',
    'audit.manager.put_role_inline_policy',
    'audit.manager.put_user_inline_policy',
    'audit.manager.remove_user_from_group',
    'audit.manager.resume_bucket_migration',
    'audit.manager.retry_bucket_migration_item',
    'audit.manager.retry_failed_bucket_migration_items',
    'audit.manager.rollback_bucket_migration',
    'audit.manager.rollback_bucket_migration_item',
    'audit.manager.rollback_failed_bucket_migration_items',
    'audit.manager.start_bucket_migration',
    'audit.manager.start_bucket_purge',
    'audit.manager.stop_bucket_migration',
    'audit.manager.update_access_key_status',
    'audit.manager.update_bucket_acl',
    'audit.manager.update_bucket_cors',
    'audit.manager.update_bucket_encryption',
    'audit.manager.update_bucket_lifecycle',
    'audit.manager.update_bucket_logging',
    'audit.manager.update_bucket_migration',
    'audit.manager.update_bucket_notifications',
    'audit.manager.update_bucket_object_lock',
    'audit.manager.update_bucket_quota',
    'audit.manager.update_bucket_replication',
    'audit.manager.update_bucket_tags',
    'audit.manager.update_bucket_versioning',
    'audit.manager.update_bucket_website',
    'audit.manager.update_iam_role',
    'audit.manager.update_public_access_block',
    'audit.manager.update_s3_user_access_key_status',
    'audit.manager.update_topic_configuration',
    'audit.manager.update_topic_policy',
    'audit.portal.archive_storage_space',
    'audit.portal.cancel_restore_deleted_prefix',
    'audit.portal.cancel_storage_space_history_cleanup',
    'audit.portal.create_portal_access_key',
    'audit.portal.create_portal_request',
    'audit.portal.create_public_link',
    'audit.portal.create_storage_space',
    'audit.portal.delete_portal_access_key',
    'audit.portal.delete_storage_space',
    'audit.portal.delete_storage_space_icon',
    'audit.portal.fail_restore_deleted_prefix',
    'audit.portal.fail_storage_space_history_cleanup',
    'audit.portal.finish_restore_deleted_prefix',
    'audit.portal.finish_storage_space_history_cleanup',
    'audit.portal.grant_storage_space_share',
    'audit.portal.import_storage_space',
    'audit.portal.restore_storage_space',
    'audit.portal.revoke_public_link',
    'audit.portal.revoke_storage_space_share',
    'audit.portal.start_restore_deleted_prefix',
    'audit.portal.start_storage_space_history_cleanup',
    'audit.portal.take_storage_space_ownership',
    'audit.portal.update_portal_access_key_status',
    'audit.portal.update_project_portal_settings',
    'audit.portal.update_storage_space',
    'audit.portal.update_storage_space_icon',
    'audit.portal.update_storage_space_settings',
    'audit.portal.update_storage_space_share',
    'audit.portal.upload_storage_space_icon',
    'audit.security.administrator_external_identity_linked',
    'audit.security.administrator_external_identity_restored',
    'audit.security.administrator_external_identity_revoked',
    'audit.security.administrator_external_identity_unchanged',
    'audit.security.administrator_reset_user_mfa',
    'audit.security.administrator_revoke_session',
    'audit.security.administrator_set_local_password',
    'audit.security.external_identity_link_decision',
    'audit.security.external_identity_revoked',
    'audit.security.external_identity_trusted_email_linked',
    'audit.security.first_admin_bootstrap_completed',
    'audit.security.first_admin_bootstrap_failure',
    'audit.security.first_admin_bootstrap_issued',
    'audit.security.first_admin_bootstrap_rate_limited',
    'audit.security.logout_all_sessions',
    'audit.security.operator_create_first_superadmin',
    'audit.security.operator_reset_last_superadmin_mfa',
    'audit.security.recovery_codes_regenerated',
    'audit.security.revoke_own_session',
    'audit.security.webauthn_credential_added',
    'audit.security.webauthn_credential_revoked',
    'audit.security.webauthn_enrollment_completed',
    'audit.security.webauthn_step_up_success',
    'audit.storage-ops.cancel_bucket_purge',
    'audit.storage-ops.fail_bucket_purge',
    'audit.storage-ops.finish_bucket_purge',
    'audit.storage-ops.start_bucket_purge',
    'audit.users.delete_avatar',
    'audit.users.update_profile',
    'audit.users.upload_avatar',
)

SPECIAL_EVENT_TYPES = (
    MIGRATION_EVENT_TYPE,
    ENDPOINT_HEALTH_EVENT_TYPE,
    QUOTA_THRESHOLD_EVENT_TYPE,
    WEBHOOK_TEST_EVENT_TYPE,
)

KNOWN_WEBHOOK_EVENT_TYPES = frozenset((*AUDIT_EVENT_TYPES, *SPECIAL_EVENT_TYPES))


def _category(event_type: str) -> str:
    if event_type.startswith("audit.auth.") or event_type.startswith("audit.security."):
        return "Authentication & Identity"
    if event_type.startswith("audit.portal."):
        return "Portal"
    if event_type.startswith("audit.ceph-admin.") or event_type.startswith("audit.storage-ops."):
        return "Ceph Admin & Storage Ops"
    if event_type.startswith("audit.manager."):
        return "Manager S3 & IAM"
    if event_type == MIGRATION_EVENT_TYPE:
        return "Migration"
    if event_type.startswith("system."):
        return "System alerts"
    action = event_type.split(".", 2)[-1]
    if any(token in action for token in ("account", "s3_user", "connection", "storage_endpoint")):
        return "S3 Accounts, Users & Connections"
    return "Platform & Settings"


def _label(event_type: str) -> str:
    if event_type == MIGRATION_EVENT_TYPE:
        return "Bucket migration event"
    if event_type == ENDPOINT_HEALTH_EVENT_TYPE:
        return "Endpoint health changed"
    if event_type == QUOTA_THRESHOLD_EVENT_TYPE:
        return "Quota threshold reached"
    if event_type == WEBHOOK_TEST_EVENT_TYPE:
        return "Webhook test"
    action = event_type.split(".", 2)[-1]
    return action.replace(".", " · ").replace("_", " ").strip().title()


def _description(event_type: str) -> str:
    if event_type == MIGRATION_EVENT_TYPE:
        return "Detailed progress and lifecycle events emitted by BucketReef bucket migrations."
    if event_type == ENDPOINT_HEALTH_EVENT_TYPE:
        return "A storage endpoint entered an abnormal state or recovered."
    if event_type == QUOTA_THRESHOLD_EVENT_TYPE:
        return "A monitored account or S3 user crossed a configured quota alert threshold."
    if event_type == WEBHOOK_TEST_EVENT_TYPE:
        return "Synthetic delivery created from the Admin webhook settings page."
    scope = event_type.split(".", 2)[1]
    return f"BucketReef {scope} control-plane action."


def get_webhook_event_definitions() -> list[WebhookEventDefinition]:
    return [
        WebhookEventDefinition(
            type=event_type,
            category=_category(event_type),
            label=_label(event_type),
            description=_description(event_type),
        )
        for event_type in sorted(
            KNOWN_WEBHOOK_EVENT_TYPES,
            key=lambda item: (_category(item), _label(item), item),
        )
    ]
