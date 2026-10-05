# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
import json

from sqlalchemy.orm import Session, sessionmaker

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import S3Account, S3User, StorageEndpoint, StorageProvider
from app.services.admin_dashboard_metrics_cache import get_cached_dashboard_metrics
from app.services.admin_metrics_service import AdminMetricsService
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_supervision import get_supervision_rgw_client
from app.services.traffic_service import TrafficWindow, window_start
from app.utils.storage_endpoint_features import resolve_feature_flags

STORAGE_FIELDS = ("bucket_count", "object_count", "used_bytes")
TRAFFIC_FIELDS = ("bytes_in", "bytes_out", "ops", "success_ops")


class AdminDashboardMetricsService:
    """Aggregate registered tenants across supervised Ceph endpoints."""

    def __init__(self, db: Session) -> None:
        self.db = db
        # Each worker owns its session and loads its own ORM objects. Reuse the
        # request's bind so dependency overrides and isolated databases apply.
        self.session_factory = sessionmaker(bind=db.get_bind())

    def _scope_endpoints(self) -> list[StorageEndpoint]:
        endpoints = []
        for endpoint in (
            self.db.query(StorageEndpoint)
            .filter(StorageEndpoint.provider == StorageProvider.CEPH.value)
            .order_by(StorageEndpoint.id)
            .populate_existing()
            .all()
        ):
            identity = endpoint.service_identity("supervision")
            if not identity or identity.status != "ready" or not identity.access_key or not identity.secret_key:
                continue
            flags = resolve_feature_flags(endpoint)
            if flags.metrics_enabled or flags.usage_enabled:
                endpoints.append(endpoint)
        return endpoints

    @staticmethod
    def _target(endpoint: StorageEndpoint) -> dict:
        flags = resolve_feature_flags(endpoint)
        return {
            "endpoint_id": endpoint.id,
            "name": endpoint.name,
            "storage_enabled": flags.metrics_enabled,
            "traffic_enabled": flags.usage_enabled,
        }

    def scope(self) -> dict:
        endpoints = [self._target(endpoint) for endpoint in self._scope_endpoints()]
        return {"endpoints": endpoints}

    def _cache_scope(self, kind: str) -> tuple[list[dict], str]:
        endpoints = [e for e in self._scope_endpoints() if self._target(e)[f"{kind}_enabled"]]
        ids = [e.id for e in endpoints]
        accounts = self.db.query(S3Account.id, S3Account.storage_endpoint_id, S3Account.rgw_account_id, S3Account.rgw_user_uid).filter(S3Account.storage_endpoint_id.in_(ids)).order_by(S3Account.id).all()
        users = self.db.query(S3User.id, S3User.storage_endpoint_id, S3User.rgw_user_uid).filter(S3User.storage_endpoint_id.in_(ids)).order_by(S3User.id).all()
        # Use the persisted identity revision, never credentials or their hashes.
        # Tenant identifiers remain endpoint-qualified even when RGW UIDs overlap.
        scope = {
            "database": id(self.db.get_bind()),
            "endpoints": [{
                **self._target(e),
                "url": e.endpoint_url, "region": e.region, "verify_tls": e.verify_tls,
                "configuration_revision": str(e.updated_at),
                "identity_id": e.service_identity("supervision").id,
                "identity_revision": str(e.service_identity("supervision").updated_at),
                "identity_mode": e.service_identity("supervision").mode,
                "identity_uid": e.service_identity("supervision").rgw_uid,
            } for e in endpoints],
            "accounts": [tuple(row) for row in accounts],
            "users": [tuple(row) for row in users],
        }
        fingerprint = sha256(json.dumps(scope, sort_keys=True).encode()).hexdigest()
        return [self._target(e) for e in endpoints], fingerprint

    def _collect_endpoint(self, target: dict, kind: str, reference: datetime) -> dict:
        with self.session_factory() as db:
            try:
                endpoint = db.get(StorageEndpoint, target["endpoint_id"])
                if endpoint is None:
                    raise ValueError("Endpoint no longer exists.")
                identity = endpoint.service_identity("supervision")
                flags = resolve_feature_flags(endpoint)
                enabled = flags.metrics_enabled if kind == "storage" else flags.usage_enabled
                if endpoint.provider != "ceph" or not enabled or not identity or identity.status != "ready":
                    raise ValueError("Endpoint supervision or feature configuration changed.")
                client = get_supervision_rgw_client(endpoint)
                service = AdminMetricsService(db=db, rgw_admin=client, endpoint_id=endpoint.id)
                if kind == "storage":
                    return {**target, **service.dashboard_storage()}
                return {**target, **service.traffic(TrafficWindow.DAY, now=reference), "reason": None}
            except (RGWAdminError, ValueError) as exc:
                return {**target, "reason": sanitized_error_log_detail(exc)}

    def _collect(self, kind: str, reference: datetime, targets: list[dict]) -> list[dict]:
        if not targets:
            return []
        with ThreadPoolExecutor(max_workers=min(4, len(targets)), thread_name_prefix=f"admin-dashboard-{kind}") as executor:
            return list(executor.map(lambda target: self._collect_endpoint(target, kind, reference), targets))

    @staticmethod
    def _coverage(results: list[dict], contributed: list[dict], complete: list[dict]) -> dict:
        issues = [
            {"endpoint_id": r["endpoint_id"], "name": r["name"], "reason": r["reason"]}
            for r in results if r.get("reason")
        ]
        return {
            "eligible_count": len(results),
            "contributing_count": len(contributed),
            "complete_count": len(complete),
            "issues": issues,
        }

    def storage(self) -> dict:
        targets, fingerprint = self._cache_scope("storage")
        return get_cached_dashboard_metrics("storage", fingerprint, lambda: self._storage(targets))

    def _storage(self, targets: list[dict]) -> dict:
        reference = datetime.now(timezone.utc).replace(microsecond=0)
        results = self._collect("storage", reference, targets)
        contributed = [r for r in results if any(r.get("storage_totals", {}).get(k) is not None for k in STORAGE_FIELDS)]
        complete = [r for r in results if all(r.get("complete", {}).get(k, False) for k in STORAGE_FIELDS)]
        totals = {}
        measurements = {}
        for key in STORAGE_FIELDS:
            values = [r["storage_totals"][key] for r in contributed if r["storage_totals"].get(key) is not None]
            totals[key] = sum(values) if values else None
            measurements[key] = {
                "contributing_count": len(values),
                "complete_count": sum(bool(r.get("complete", {}).get(key)) for r in results),
            }
        return {
            "generated_at": reference.isoformat(),
            "storage_totals": totals,
            "coverage": self._coverage(results, contributed, complete),
            "measurements": measurements,
        }

    def traffic(self) -> dict:
        targets, fingerprint = self._cache_scope("traffic")
        return get_cached_dashboard_metrics("traffic", fingerprint, lambda: self._traffic(targets))

    def _traffic(self, targets: list[dict]) -> dict:
        reference = datetime.now(timezone.utc).replace(microsecond=0)
        results = self._collect("traffic", reference, targets)
        contributed = [r for r in results if "totals" in r]
        totals = {key: sum(r["totals"][key] for r in contributed) if contributed else None for key in TRAFFIC_FIELDS}
        totals["success_rate"] = totals["success_ops"] / totals["ops"] if totals["ops"] else None
        timeline: dict[str, dict] = {}
        for result in contributed:
            for point in result["series"]:
                row = timeline.setdefault(point["timestamp"], {key: 0 for key in TRAFFIC_FIELDS})
                for key in TRAFFIC_FIELDS:
                    row[key] += point[key]
        series = [{"timestamp": timestamp, **values} for timestamp, values in sorted(timeline.items())]
        return {
            "window": "day",
            "start": window_start(reference, TrafficWindow.DAY).isoformat(),
            "end": reference.isoformat(),
            "resolution": "hourly",
            "series": series,
            "data_points": len(series),
            "totals": totals,
            "coverage": self._coverage(results, contributed, contributed),
        }
