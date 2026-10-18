# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.core.domain_errors import (
    BillingDisabledError,
    ResourceConflictError,
    StorageEndpointNotFoundError,
)
from app.db import StorageEndpoint, StorageProvider, User
from app.models.billing import BillingAnalysisPreview, BillingSubjectDetail, BillingSubjectsResponse, BillingSummary
from app.services.app_settings_service import load_app_settings
from app.services.billing_analysis_service import BillingAnalysisService
from app.services.billing_collection_service import BillingCollector
from app.services.billing_service import BillingService
from app.services.operation_lease_service import (
    OperationLeaseService,
    billing_daily_operation_name,
    billing_operation_lease_ttl_seconds,
)


class AdminBillingService:
    """Orchestrate Admin billing reads and on-demand daily collection."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.billing = BillingService(db)

    @staticmethod
    def _require_enabled() -> None:
        if not load_app_settings().general.billing_enabled:
            raise BillingDisabledError("Billing is disabled")

    def _require_ceph_endpoint(self, endpoint_id: int) -> StorageEndpoint:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if endpoint is None:
            raise StorageEndpointNotFoundError("Endpoint not found")
        if endpoint.provider != StorageProvider.CEPH.value:
            raise ValueError("This endpoint is not a Ceph endpoint")
        return endpoint

    def summary(self, month: str, endpoint_id: int | None) -> BillingSummary:
        self._require_enabled()
        if endpoint_id is not None:
            self._require_ceph_endpoint(endpoint_id)
        return self.billing.summary(month, endpoint_id)

    def analysis(self, month: str) -> BillingAnalysisPreview:
        self._require_enabled()
        return BillingAnalysisService(self.db).preview(month)

    def list_subjects(
        self,
        month: str,
        endpoint_id: int,
        subject_type: str,
        page: int,
        page_size: int,
        sort_by: str,
        sort_dir: str,
    ) -> BillingSubjectsResponse:
        self._require_enabled()
        self._require_ceph_endpoint(endpoint_id)
        return self.billing.list_subjects(month, endpoint_id, subject_type, page, page_size, sort_by, sort_dir)

    def subject_detail(
        self,
        month: str,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> BillingSubjectDetail:
        self._require_enabled()
        self._require_ceph_endpoint(endpoint_id)
        return self.billing.subject_detail(month, endpoint_id, subject_type, subject_id)

    def export_csv(self, month: str, endpoint_id: int) -> tuple[str, str]:
        self._require_enabled()
        self._require_ceph_endpoint(endpoint_id)
        return self.billing.export_csv(month, endpoint_id)

    def collect_daily(self, day: date, actor: User) -> dict:
        self._require_enabled()
        operation_name = billing_daily_operation_name(day.isoformat())
        with OperationLeaseService(self.db).hold(
            operation_name,
            ttl_seconds=billing_operation_lease_ttl_seconds(),
            lease_context={"source": "admin", "day": day.isoformat(), "user_id": actor.id},
        ) as lease:
            if lease is None:
                raise ResourceConflictError("A billing collection is already running for this day.")
            return BillingCollector(self.db).collect_daily(day)
