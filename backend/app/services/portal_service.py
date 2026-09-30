# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from .portal.access_keys import PortalAccessKeysMixin
from .portal.account_runtime import PortalAccountRuntimeMixin
from .portal.activity import PortalActivityMixin
from .portal.buckets_users import PortalBucketsUsersMixin
from .portal.collaborators import PortalCollaboratorsMixin
from .portal.iam import PortalIamMixin
from .managed_resource_naming import (
    PORTAL_EXTERNAL_ACCESS_POLICY_NAME,
    PORTAL_MANAGER_GROUP_POLICY_NAME,
    PORTAL_MANAGER_GROUP_NAME,
    PORTAL_STORAGE_SPACE_ACCESS_SID,
    PORTAL_STORAGE_SPACE_ARCHIVED_SID,
    PORTAL_STORAGE_SPACE_PRIVATE_SID,
    PORTAL_STORAGE_SPACE_SHARE_SID_PREFIX,
    PORTAL_USER_BUCKET_POLICY_NAME,
    PORTAL_USER_BUCKETS_SID,
    PORTAL_USER_GROUP_POLICY_NAME,
    PORTAL_USER_GROUP_NAME,
)
from .portal.iam_policy_documents import PortalIamPolicyDocumentsMixin
from .portal.objects import PortalObjectsMixin
from .portal.public_links import PortalPublicLinksMixin
from .portal.server_access_log_queries import PortalServerAccessLogQueriesMixin
from .portal.server_access_logging import PortalServerAccessLoggingMixin
from .portal.settings import PortalSettingsMixin
from .portal.sharing import PortalSharingMixin
from .portal.space_settings import PortalStorageSpaceSettingsMixin
from .portal.state_usage import PortalStateUsageMixin
from .portal.storage_space_access import PortalStorageSpaceAccessMixin
from .portal.storage_space_bucket_policies import PortalStorageSpaceBucketPoliciesMixin
from .portal.storage_space_catalog import PortalStorageSpaceCatalogMixin
from .portal.storage_space_icons import PortalStorageSpaceIconsMixin
from .portal.storage_spaces import PortalStorageSpacesMixin
from .portal.trash_restore import PortalDeletedPrefixRestoreMixin
from .portal.version_cleanup import PortalStorageSpaceVersionCleanupMixin


class PortalService(
    PortalSettingsMixin,
    PortalAccountRuntimeMixin,
    PortalIamPolicyDocumentsMixin,
    PortalStorageSpaceBucketPoliciesMixin,
    PortalStorageSpaceAccessMixin,
    PortalIamMixin,
    PortalServerAccessLoggingMixin,
    PortalServerAccessLogQueriesMixin,
    PortalStorageSpaceVersionCleanupMixin,
    PortalStorageSpaceSettingsMixin,
    PortalDeletedPrefixRestoreMixin,
    PortalCollaboratorsMixin,
    PortalStorageSpaceIconsMixin,
    PortalStorageSpaceCatalogMixin,
    PortalStorageSpacesMixin,
    PortalObjectsMixin,
    PortalSharingMixin,
    PortalPublicLinksMixin,
    PortalActivityMixin,
    PortalStateUsageMixin,
    PortalAccessKeysMixin,
    PortalBucketsUsersMixin,
):
    def __init__(self, db: Session) -> None:
        self.db = db
        self._inline_policy_name = PORTAL_USER_GROUP_POLICY_NAME
        self._manager_group_policy_name = PORTAL_MANAGER_GROUP_POLICY_NAME
        self._manager_group_name = PORTAL_MANAGER_GROUP_NAME
        self._user_group_name = PORTAL_USER_GROUP_NAME
        self._bucket_access_policy_name = PORTAL_USER_BUCKET_POLICY_NAME
        self._external_access_policy_name = PORTAL_EXTERNAL_ACCESS_POLICY_NAME
        self._bucket_access_sid = PORTAL_USER_BUCKETS_SID
        self._storage_space_share_sid_prefix = PORTAL_STORAGE_SPACE_SHARE_SID_PREFIX
        self._storage_space_access_sid = PORTAL_STORAGE_SPACE_ACCESS_SID
        self._storage_space_private_sid = PORTAL_STORAGE_SPACE_PRIVATE_SID
        self._storage_space_archived_sid = PORTAL_STORAGE_SPACE_ARCHIVED_SID



def get_portal_service(db: Session) -> PortalService:
    return PortalService(db)
