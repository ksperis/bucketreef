# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.core.domain_errors import (
    CostDisabledError,
    ResourceConflictError,
    StorageEndpointNotFoundError,
)
from app.db import StorageEndpoint, StorageProvider, User
from app.models.cost import (
    AdminCostSubjectDetail,
    CostAnalyticsResponse,
    CostCollectionResult,
    CostSubjectsResponse,
    CostSummary,
)
from app.services.app_settings_service import load_app_settings
from app.services.cost_collection_service import CostCollector
from app.services.cost_service import CostService
from app.services.operation_lease_service import (
    OperationLeaseService,
    cost_daily_operation_name,
    cost_operation_lease_ttl_seconds,
)


class AdminCostService:
    """Orchestrate Admin cost reads and on-demand daily collection."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.cost = CostService(db)

    @staticmethod
    def _require_enabled() -> None:
        if not load_app_settings().general.cost_enabled:
            raise CostDisabledError("Cost is disabled")

    def _require_ceph_endpoint(self, endpoint_id: int) -> StorageEndpoint:
        endpoint = self.db.get(StorageEndpoint, endpoint_id)
        if endpoint is None:
            raise StorageEndpointNotFoundError("Endpoint not found")
        if endpoint.provider != StorageProvider.CEPH.value:
            raise ValueError("This endpoint is not a Ceph endpoint")
        return endpoint

    def summary(self, month: str, endpoint_id: int | None) -> CostSummary:
        self._require_enabled()
        if endpoint_id is not None:
            self._require_ceph_endpoint(endpoint_id)
        return self.cost.summary(month, endpoint_id)

    def list_subjects(
        self,
        month: str,
        endpoint_id: int | None,
        subject_type: str,
        page: int,
        page_size: int,
        sort_by: str,
        sort_dir: str,
        search: str | None = None,
    ) -> CostSubjectsResponse:
        self._require_enabled()
        if endpoint_id is not None:
            self._require_ceph_endpoint(endpoint_id)
        return self.cost.list_subjects(
            month,
            endpoint_id,
            subject_type,
            page,
            page_size,
            sort_by,
            sort_dir,
            search,
        )

    def subject_detail(
        self,
        month: str,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> AdminCostSubjectDetail:
        self._require_enabled()
        self._require_ceph_endpoint(endpoint_id)
        detail = self.cost.subject_detail(month, endpoint_id, subject_type, subject_id)
        return AdminCostSubjectDetail(
            **detail.model_dump(),
            history=self.cost.subject_history(month, endpoint_id, subject_type, subject_id),
        )

    def analytics(
        self,
        month: str,
        endpoint_id: int | None,
        subject_type: str,
    ) -> CostAnalyticsResponse:
        self._require_enabled()
        if endpoint_id is not None:
            self._require_ceph_endpoint(endpoint_id)
        return self.cost.analytics(month, endpoint_id, subject_type)

    def export_csv(
        self,
        month: str,
        endpoint_id: int | None,
        subject_type: str = "all",
    ) -> tuple[str, str]:
        self._require_enabled()
        if endpoint_id is not None:
            self._require_ceph_endpoint(endpoint_id)
        return self.cost.export_csv(month, endpoint_id, subject_type)

    def collect_daily(self, day: date, actor: User) -> CostCollectionResult:
        self._require_enabled()
        operation_name = cost_daily_operation_name(day.isoformat())
        with OperationLeaseService(self.db).hold(
            operation_name,
            ttl_seconds=cost_operation_lease_ttl_seconds(),
            lease_context={"source": "admin", "day": day.isoformat(), "user_id": actor.id},
        ) as lease:
            if lease is None:
                raise ResourceConflictError("A cost collection is already running for this day.")
            return CostCollector(self.db).collect_daily(day)
