# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from app.models.base import ApiModel


class ManagedS3ResourceFeatures(ApiModel):
    allow_bucket_quota_management: Optional[bool]
    allow_access_key_metadata: Optional[bool]
    allow_access_key_expiration: Optional[bool]
    allow_activity_history: Optional[bool]
    allow_rgw_usage_metrics: Optional[bool]
    allow_cost_estimation: Optional[bool]
    allow_bucket_usage_stats: Optional[bool]
    allow_bucket_usage_stats_collection: Optional[bool]
    allow_multisite_endpoint_switching: Optional[bool]
    allow_manager_browser_data_access_for_all_admins: Optional[bool]


class ManagedS3UserFeatures(ManagedS3ResourceFeatures):
    allow_access_key_management: Optional[bool]
    allow_managed_private_connection_provisioning: Optional[bool]


class ManagedS3ResourceFeatureOverrides(ApiModel):
    allow_bucket_quota_management: Optional[bool] = None
    allow_access_key_metadata: Optional[bool] = None
    allow_access_key_expiration: Optional[bool] = None
    allow_activity_history: Optional[bool] = None
    allow_rgw_usage_metrics: Optional[bool] = None
    allow_cost_estimation: Optional[bool] = None
    allow_bucket_usage_stats: Optional[bool] = None
    allow_bucket_usage_stats_collection: Optional[bool] = None
    allow_multisite_endpoint_switching: Optional[bool] = None
    allow_manager_browser_data_access_for_all_admins: Optional[bool] = None


class ManagedS3UserFeatureOverrides(ManagedS3ResourceFeatureOverrides):
    allow_access_key_management: Optional[bool] = None
    allow_managed_private_connection_provisioning: Optional[bool] = None
