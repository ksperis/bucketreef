# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.core.db_transactions import rollback_safely
from app.models.s3_user import S3User as S3UserSchema, S3UserUpdate
from app.services.app_settings_service import load_app_settings_for_db
from app.services.feature_policy_service import (
    apply_resource_feature_overrides,
    validate_manager_overrides,
    validate_multisite_endpoint_switching_override,
    validate_project_collection_overrides,
    validate_project_overrides,
)
from app.services.s3_user_associations_service import S3UserAssociationsService
from app.services.s3_user_query_service import S3UserQueryService
from app.services.s3_user_quota_service import S3UserQuotaService
from app.services.s3_user_repository import S3UserRepository
from app.services.s3_user_rgw_context_service import S3UserRgwContextService
from app.services.tags_service import TagsService


logger = logging.getLogger(__name__)


class S3UserUpdateService:
    """Apply managed S3 user metadata, policy, association, tag, and quota updates."""

    def __init__(
        self,
        db: Session,
        *,
        repository: S3UserRepository | None = None,
        quota: S3UserQuotaService | None = None,
        associations: S3UserAssociationsService | None = None,
        tags: TagsService | None = None,
        query: S3UserQueryService | None = None,
    ) -> None:
        self.db = db
        self.repository = repository or S3UserRepository(db)
        self.associations = associations or S3UserAssociationsService(db)
        self.tags = tags or TagsService(db)
        self.query = query or S3UserQueryService(
            db,
            repository=self.repository,
            associations=self.associations,
            tags=self.tags,
        )
        if quota is None:
            quota = S3UserQuotaService(S3UserRgwContextService(db))
        self.quota = quota

    def update_user(self, user_id: int, payload: S3UserUpdate) -> S3UserSchema:
        s3_user = self.repository.get(user_id)
        self.repository.ensure_not_pending_deletion(user_id)
        app_settings = load_app_settings_for_db(self.db)
        validate_manager_overrides(payload, app_settings.manager.feature_policies, s3_user)
        validate_multisite_endpoint_switching_override(
            payload,
            app_settings.manager.feature_policies,
            s3_user,
        )
        validate_project_overrides(
            payload,
            app_settings.general.project_feature_policies,
            s3_user,
        )
        validate_project_collection_overrides(
            payload,
            app_settings.general.project_collection_policies,
            s3_user,
        )
        quota_requested = bool(
            {"quota_max_size_gb", "quota_max_objects"} & payload.model_fields_set
        )
        quota_before = self.quota.capture(s3_user) if quota_requested else None
        quota_update_attempted = False

        try:
            if "name" in payload.model_fields_set:
                s3_user.name = payload.name
            if "email" in payload.model_fields_set:
                s3_user.email = payload.email
            self.associations.replace_links(
                s3_user,
                user_links=payload.user_links,
                group_links=payload.group_links,
            )
            if payload.tags is not None:
                self.tags.replace_s3_user_tags(s3_user, payload.tags)
            apply_resource_feature_overrides(payload, s3_user)

            if quota_requested:
                quota_update_attempted = True
                self.quota.update(
                    s3_user,
                    payload.quota_max_size_gb,
                    payload.quota_max_objects,
                    payload.quota_max_size_unit,
                )

            self.db.add(s3_user)
            self.db.commit()
        except Exception as exc:
            rollback_error = rollback_safely(self.db)
            if rollback_error is not None:  # pragma: no cover - defensive database failure
                logger.error("Unable to roll back failed S3 user update: %s", rollback_error)

            quota_rollback_failed = False
            if quota_update_attempted and quota_before is not None:
                try:
                    self.quota.restore(quota_before)
                except Exception as rollback_exc:  # pragma: no cover - defensive remote failure
                    logger.error(
                        "Unable to restore RGW quota after failed S3 user update for %s: %s",
                        quota_before.uid,
                        rollback_exc,
                    )
                    quota_rollback_failed = True

            if rollback_error is not None or quota_rollback_failed:
                raise RuntimeError(
                    "Unable to update S3 user. Local or RGW rollback also failed."
                ) from exc
            raise

        self.db.refresh(s3_user)
        user_links_map, group_links_map = self.associations.load_links([s3_user.id])
        return self.query.serialize_user(
            s3_user,
            user_links_map,
            group_links_map,
        )
