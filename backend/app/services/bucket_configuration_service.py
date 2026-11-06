# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Any, Optional
import logging

from app.services.s3_execution_context import (
    S3ExecutionTarget,
    is_ceph_admin_execution_context,
)
from app.services.s3_execution_client import (
    s3_execution_bucket_request_kwargs,
    s3_execution_request_kwargs,
)
from app.services import (
    s3_bucket_access,
    s3_bucket_metadata,
    s3_bucket_replication,
    s3_bucket_security,
    s3_client,
)
from app.services.rgw_bucket_target import split_explicit_rgw_s3_bucket_name
from app.models.bucket import (
    BucketAcl,
    BucketAclGrant,
    BucketAclGrantee,
    BucketAclUpdate,
    BucketEncryptionConfiguration,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketReplicationConfiguration,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketPublicAccessBlockUpdate,
    BucketTag,
    BucketWebsiteConfiguration,
    BucketWebsiteRedirectAllRequestsTo,
    LifecycleRule,
)

logger = logging.getLogger(__name__)


class BucketConfigurationService:
    @staticmethod
    def _object_lock_from_raw(config: Any) -> BucketObjectLock | None:
        if not isinstance(config, dict):
            return None
        return BucketObjectLock(
            enabled=config.get("enabled"),
            mode=config.get("mode"),
            days=config.get("days"),
            years=config.get("years"),
        )

    @staticmethod
    def _public_access_block_from_raw(config: Any) -> BucketPublicAccessBlock | None:
        if not isinstance(config, dict):
            return None
        return BucketPublicAccessBlock(
            block_public_acls=config.get("block_public_acls"),
            ignore_public_acls=config.get("ignore_public_acls"),
            block_public_policy=config.get("block_public_policy"),
            restrict_public_buckets=config.get("restrict_public_buckets"),
        )

    def _bucket_client_kwargs(
        self,
        execution_context: S3ExecutionTarget,
        bucket_name: str,
    ) -> dict:
        if (
            is_ceph_admin_execution_context(execution_context)
            and split_explicit_rgw_s3_bucket_name(bucket_name) is not None
        ):
            return s3_execution_bucket_request_kwargs(
                execution_context,
                bucket_name,
            )
        return s3_execution_request_kwargs(execution_context)

    def get_bucket_tags(self, name: str, execution_context: S3ExecutionTarget) -> list[BucketTag]:
        tags_raw = s3_bucket_metadata.get_bucket_tags(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        tags: list[BucketTag] = []
        for entry in tags_raw:
            if not isinstance(entry, dict):
                continue
            key = str(entry.get("key") or "")
            if not key:
                continue
            tags.append(BucketTag(key=key, value=str(entry.get("value") or "")))
        return tags

    def set_versioning(self, name: str, execution_context: S3ExecutionTarget, enabled: bool) -> None:
        s3_client.set_bucket_versioning(
            name,
            enabled=enabled,
            **self._bucket_client_kwargs(execution_context, name),
        )
        logger.debug(
            "S3 execution context %s set versioning on bucket %s to %s",
            execution_context.rgw_account_id or execution_context.id,
            name,
            enabled,
        )

    def get_bucket_properties(self, name: str, execution_context: S3ExecutionTarget) -> BucketProperties:
        versioning_status = s3_client.get_bucket_versioning(
            name, **self._bucket_client_kwargs(execution_context, name)
        )
        public_access_block_raw = s3_bucket_security.get_bucket_public_access_block(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        object_lock_raw = s3_bucket_security.get_bucket_object_lock(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        object_lock = self._object_lock_from_raw(object_lock_raw)
        public_access_block = self._public_access_block_from_raw(public_access_block_raw)
        lifecycle_rules_raw = s3_bucket_metadata.get_bucket_lifecycle(
            name, **self._bucket_client_kwargs(execution_context, name)
        )
        lifecycle_rules: list[LifecycleRule] = []
        for rule in lifecycle_rules_raw:
            lifecycle_rules.append(
                LifecycleRule(
                    id=rule.get("ID"),
                    status=rule.get("Status"),
                    prefix=rule.get("Prefix") or (rule.get("Filter", {}) or {}).get("Prefix"),
                )
            )
        cors_rules = s3_bucket_access.get_bucket_cors(
            name, **self._bucket_client_kwargs(execution_context, name)
        )
        return BucketProperties(
            versioning_status=versioning_status,
            object_lock=object_lock,
            public_access_block=public_access_block,
            lifecycle_rules=lifecycle_rules,
            cors_rules=cors_rules,
        )

    def get_bucket_versioning_status(self, name: str, execution_context: S3ExecutionTarget) -> str | None:
        return s3_client.get_bucket_versioning(
            name, **self._bucket_client_kwargs(execution_context, name)
        )

    def get_bucket_object_lock(self, name: str, execution_context: S3ExecutionTarget) -> BucketObjectLock | None:
        object_lock_raw = s3_bucket_security.get_bucket_object_lock(
            name, **self._bucket_client_kwargs(execution_context, name)
        )
        return self._object_lock_from_raw(object_lock_raw)

    def get_bucket_cors(self, name: str, execution_context: S3ExecutionTarget) -> list[dict]:
        return s3_bucket_access.get_bucket_cors(
            name, **self._bucket_client_kwargs(execution_context, name)
        )

    def get_bucket_encryption(self, name: str, execution_context: S3ExecutionTarget) -> BucketEncryptionConfiguration:
        rules = s3_bucket_security.get_bucket_encryption(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return BucketEncryptionConfiguration(rules=rules)

    def set_bucket_encryption(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        rules: list[dict],
    ) -> BucketEncryptionConfiguration:
        if not rules:
            s3_bucket_security.delete_bucket_encryption(
                name,
                **self._bucket_client_kwargs(execution_context, name),
            )
            return BucketEncryptionConfiguration(rules=[])
        s3_bucket_security.put_bucket_encryption(
            name,
            rules=rules,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return self.get_bucket_encryption(name, execution_context)

    def delete_bucket_encryption(self, name: str, execution_context: S3ExecutionTarget) -> None:
        s3_bucket_security.delete_bucket_encryption(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )

    def get_public_access_block(self, name: str, execution_context: S3ExecutionTarget) -> BucketPublicAccessBlock:
        config_raw = s3_bucket_security.get_bucket_public_access_block(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return self._public_access_block_from_raw(config_raw) or BucketPublicAccessBlock(
            block_public_acls=None,
            ignore_public_acls=None,
            block_public_policy=None,
            restrict_public_buckets=None,
        )

    def set_public_access_block(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        payload: BucketPublicAccessBlockUpdate,
    ) -> BucketPublicAccessBlock:
        config = {
            "BlockPublicAcls": payload.block_public_acls,
            "IgnorePublicAcls": payload.ignore_public_acls,
            "BlockPublicPolicy": payload.block_public_policy,
            "RestrictPublicBuckets": payload.restrict_public_buckets,
        }
        if not any(config.values()):
            config = {}
        s3_bucket_security.set_bucket_public_access_block(
            name,
            configuration=config,
            **self._bucket_client_kwargs(execution_context, name),
        )
        updated_raw = s3_bucket_security.get_bucket_public_access_block(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return self._public_access_block_from_raw(updated_raw) or BucketPublicAccessBlock(
            block_public_acls=None,
            ignore_public_acls=None,
            block_public_policy=None,
            restrict_public_buckets=None,
        )

    def get_policy(self, name: str, execution_context: S3ExecutionTarget) -> Optional[dict]:
        return s3_bucket_access.get_bucket_policy(
            name, **self._bucket_client_kwargs(execution_context, name)
        )

    def put_policy(self, name: str, execution_context: S3ExecutionTarget, policy: dict) -> None:
        s3_bucket_access.put_bucket_policy(
            name, policy=policy, **self._bucket_client_kwargs(execution_context, name)
        )

    def delete_policy(self, name: str, execution_context: S3ExecutionTarget) -> None:
        s3_bucket_access.delete_bucket_policy(
            name, **self._bucket_client_kwargs(execution_context, name)
        )

    def set_cors(self, name: str, execution_context: S3ExecutionTarget, rules: list[dict]) -> None:
        s3_bucket_access.put_bucket_cors(
            name, rules=rules, **self._bucket_client_kwargs(execution_context, name)
        )

    def delete_cors(self, name: str, execution_context: S3ExecutionTarget) -> None:
        s3_bucket_access.delete_bucket_cors(
            name, **self._bucket_client_kwargs(execution_context, name)
        )

    def get_lifecycle(self, name: str, execution_context: S3ExecutionTarget) -> BucketLifecycleConfig:
        rules = s3_bucket_metadata.get_bucket_lifecycle(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return BucketLifecycleConfig(rules=rules)

    def set_lifecycle(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        rules: list[dict],
    ) -> BucketLifecycleConfig:
        if not rules:
            self.delete_lifecycle(name, execution_context)
            return BucketLifecycleConfig(rules=[])
        try:
            s3_bucket_metadata.put_bucket_lifecycle(
                name,
                rules=rules,
                **self._bucket_client_kwargs(execution_context, name),
            )
        except RuntimeError as exc:
            raise RuntimeError(f"Unable to set lifecycle rules: {exc}") from exc
        return self.get_lifecycle(name, execution_context)

    def delete_lifecycle(self, name: str, execution_context: S3ExecutionTarget) -> None:
        s3_bucket_metadata.delete_bucket_lifecycle(
            name, **self._bucket_client_kwargs(execution_context, name)
        )
        # Some RGW backends may return 204 but keep lifecycle rules.
        # Double-check and overwrite with an empty configuration to purge if needed.
        remaining = s3_bucket_metadata.get_bucket_lifecycle(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        if remaining:
            try:
                s3_bucket_metadata.put_bucket_lifecycle(
                    name,
                    rules=[],
                    **self._bucket_client_kwargs(execution_context, name),
                )
            except RuntimeError as exc:
                raise RuntimeError(f"Unable to delete bucket lifecycle: {exc}") from exc

    def set_bucket_tags(self, name: str, execution_context: S3ExecutionTarget, tags: list[dict]) -> None:
        s3_bucket_metadata.put_bucket_tags(
            name, tags=tags, **self._bucket_client_kwargs(execution_context, name)
        )

    def delete_bucket_tags(self, name: str, execution_context: S3ExecutionTarget) -> None:
        s3_bucket_metadata.delete_bucket_tags(
            name, **self._bucket_client_kwargs(execution_context, name)
        )

    def get_bucket_notifications(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
    ) -> BucketNotificationConfiguration:
        config = s3_bucket_metadata.get_bucket_notifications(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return BucketNotificationConfiguration(configuration=config)

    def get_bucket_replication(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
    ) -> BucketReplicationConfiguration:
        config = s3_bucket_replication.get_bucket_replication(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return BucketReplicationConfiguration(configuration=config)

    def _validate_bucket_replication_configuration(self, configuration: Any) -> dict:
        if not isinstance(configuration, dict):
            raise ValueError("Replication configuration must be an object.")
        rules = configuration.get("Rules")
        if not isinstance(rules, list) or len(rules) == 0:
            raise ValueError("Replication configuration must include a non-empty Rules array.")
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            destination = rule.get("Destination")
            if isinstance(destination, dict) and "Zone" in destination:
                raise ValueError("Destination.Zone is not supported in V1.")
        return configuration

    def set_bucket_replication(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        payload: BucketReplicationConfiguration,
    ) -> BucketReplicationConfiguration:
        configuration = self._validate_bucket_replication_configuration(payload.configuration)
        s3_bucket_replication.put_bucket_replication(
            name,
            configuration=configuration,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return self.get_bucket_replication(name, execution_context)

    def delete_bucket_replication(self, name: str, execution_context: S3ExecutionTarget) -> None:
        s3_bucket_replication.delete_bucket_replication(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )

    def set_bucket_notifications(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        configuration: dict,
    ) -> BucketNotificationConfiguration:
        s3_bucket_metadata.put_bucket_notifications(
            name,
            config=configuration,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return self.get_bucket_notifications(name, execution_context)

    def delete_bucket_notifications(self, name: str, execution_context: S3ExecutionTarget) -> None:
        s3_bucket_metadata.put_bucket_notifications(
            name,
            config={},
            **self._bucket_client_kwargs(execution_context, name),
        )

    def get_bucket_logging(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
    ) -> BucketLoggingConfiguration:
        config = s3_bucket_metadata.get_bucket_logging(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        if not config:
            return BucketLoggingConfiguration(
                enabled=False,
                target_bucket=None,
                target_prefix=None,
            )
        return BucketLoggingConfiguration(
            enabled=True,
            target_bucket=config.get("target_bucket"),
            target_prefix=config.get("target_prefix"),
        )

    def set_bucket_logging(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        payload: BucketLoggingConfiguration,
    ) -> BucketLoggingConfiguration:
        if not payload.enabled:
            s3_bucket_metadata.put_bucket_logging(
                name,
                logging_config=None,
                **self._bucket_client_kwargs(execution_context, name),
            )
            return BucketLoggingConfiguration(
                enabled=False,
                target_bucket=None,
                target_prefix=None,
            )
        target_bucket = (payload.target_bucket or "").strip()
        if not target_bucket:
            raise ValueError("Target bucket is required when enabling access logging.")
        logging_config = {"TargetBucket": target_bucket}
        target_prefix = (payload.target_prefix or "").strip()
        logging_config["TargetPrefix"] = target_prefix
        s3_bucket_metadata.put_bucket_logging(
            name,
            logging_config=logging_config,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return self.get_bucket_logging(name, execution_context)

    def delete_bucket_logging(self, name: str, execution_context: S3ExecutionTarget) -> None:
        s3_bucket_metadata.put_bucket_logging(
            name,
            logging_config=None,
            **self._bucket_client_kwargs(execution_context, name),
        )

    def get_bucket_website(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
    ) -> BucketWebsiteConfiguration:
        config = s3_bucket_access.get_bucket_website(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        if not config:
            return BucketWebsiteConfiguration(
                index_document=None,
                error_document=None,
                redirect_all_requests_to=None,
                routing_rules=[],
            )
        index_document = None
        error_document = None
        redirect = None
        index_raw = config.get("IndexDocument")
        if isinstance(index_raw, dict):
            index_document = index_raw.get("Suffix")
        error_raw = config.get("ErrorDocument")
        if isinstance(error_raw, dict):
            error_document = error_raw.get("Key")
        redirect_raw = config.get("RedirectAllRequestsTo")
        if isinstance(redirect_raw, dict):
            host_name = redirect_raw.get("HostName")
            if host_name:
                redirect = BucketWebsiteRedirectAllRequestsTo(
                    host_name=host_name,
                    protocol=redirect_raw.get("Protocol"),
                )
        routing_rules = config.get("RoutingRules") or []
        if not isinstance(routing_rules, list):
            routing_rules = []
        return BucketWebsiteConfiguration(
            index_document=index_document,
            error_document=error_document,
            redirect_all_requests_to=redirect,
            routing_rules=routing_rules,
        )

    def set_bucket_website(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        payload: BucketWebsiteConfiguration,
    ) -> BucketWebsiteConfiguration:
        config: dict = {}
        if payload.redirect_all_requests_to:
            host_name = payload.redirect_all_requests_to.host_name.strip()
            if not host_name:
                raise ValueError("Redirect hostname is required.")
            redirect = {"HostName": host_name}
            protocol = payload.redirect_all_requests_to.protocol
            if protocol:
                redirect["Protocol"] = protocol
            config["RedirectAllRequestsTo"] = redirect
        else:
            index_document = (payload.index_document or "").strip()
            if not index_document:
                raise ValueError("Index document is required when redirect is not configured.")
            config["IndexDocument"] = {"Suffix": index_document}
            error_document = (payload.error_document or "").strip()
            if error_document:
                config["ErrorDocument"] = {"Key": error_document}
            if payload.routing_rules:
                config["RoutingRules"] = payload.routing_rules
        if not config:
            raise ValueError("Website configuration is empty.")
        s3_bucket_access.put_bucket_website(
            name,
            configuration=config,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return self.get_bucket_website(name, execution_context)

    def delete_bucket_website(self, name: str, execution_context: S3ExecutionTarget) -> None:
        s3_bucket_access.delete_bucket_website(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )

    def get_bucket_acl(self, name: str, execution_context: S3ExecutionTarget) -> BucketAcl:
        acl_raw = s3_bucket_security.get_bucket_acl(
            name, **self._bucket_client_kwargs(execution_context, name)
        )
        owner = acl_raw.get("Owner") or {}
        owner_name = owner.get("DisplayName") or owner.get("ID")
        grants: list[BucketAclGrant] = []
        for grant in acl_raw.get("Grants") or []:
            grantee_raw = grant.get("Grantee") or {}
            grantee_type = grantee_raw.get("Type")
            if not grantee_type:
                continue
            grants.append(
                BucketAclGrant(
                    grantee=BucketAclGrantee(
                        type=grantee_type,
                        id=grantee_raw.get("ID"),
                        display_name=grantee_raw.get("DisplayName"),
                        uri=grantee_raw.get("URI"),
                    ),
                    permission=grant.get("Permission") or "UNKNOWN",
                )
            )
        return BucketAcl(owner=owner_name, grants=grants)

    def set_bucket_acl(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        payload: BucketAclUpdate,
    ) -> BucketAcl:
        s3_bucket_security.put_bucket_acl(
            name,
            acl=payload.acl,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return self.get_bucket_acl(name, execution_context)

    def get_object_lock(self, name: str, execution_context: S3ExecutionTarget) -> BucketObjectLock:
        config = s3_bucket_security.get_bucket_object_lock(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        return self._object_lock_from_raw(config) or BucketObjectLock(
            enabled=None,
            mode=None,
            days=None,
            years=None,
        )

    def set_object_lock(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        payload: BucketObjectLockUpdate,
    ) -> BucketObjectLock:
        current_config = s3_bucket_security.get_bucket_object_lock(
            name,
            **self._bucket_client_kwargs(execution_context, name),
        )
        enabled = payload.enabled if payload.enabled is not None else (current_config or {}).get("enabled")
        mode = payload.mode or None
        days = payload.days
        years = payload.years

        if days is not None and years is not None:
            raise ValueError("Specify either Days or Years, not both.")
        if (days is not None or years is not None) and not mode:
            raise ValueError("Mode is required to set a default retention.")
        if mode and days is None and years is None:
            raise ValueError("A duration (days or years) is required when a retention mode is set.")
        if enabled is None:
            raise RuntimeError("Object Lock not available on this bucket.")

        try:
            s3_bucket_security.put_bucket_object_lock(
                name,
                enabled=enabled,
                mode=mode,
                days=days,
                years=years,
                **self._bucket_client_kwargs(execution_context, name),
            )
        except RuntimeError as exc:
            raise RuntimeError(f"Unable to update object lock for bucket {name}: {exc}") from exc

        return self.get_object_lock(name, execution_context)


def get_bucket_configuration_service() -> BucketConfigurationService:
    return BucketConfigurationService()
