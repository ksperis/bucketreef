from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from app.db import (
    BillingEntityRateAssignment,
    BillingRateCard,
    BillingRatePlan,
    BillingStorageDaily,
    BillingUsageDaily,
    S3Account,
    S3User,
    StorageEndpoint,
)
from app.models.billing import BillingEntityPayload
from app.services.billing_collection_service import BillingCollector
from app.services.billing_entity_service import BillingEntityService
from app.services.billing_statement_service import BillingStatementService
from app.utils.quota_stats import QuotaSnapshot


GIB = 1024**3
JANUARY_START = date(2026, 1, 1)


def _endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="billing-rgw-source",
        endpoint_url="https://billing-rgw-source.example.test",
        provider="ceph",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()
    return endpoint


def _subjects(db_session, endpoint: StorageEndpoint) -> tuple[S3Account, S3User]:
    account = S3Account(
        name="Billing research account",
        rgw_account_id="RGW-BILLING-RESEARCH",
        rgw_user_uid="billing-research-root",
        rgw_tenant="",
        storage_endpoint_id=endpoint.id,
    )
    user = S3User(
        name="Billing standalone user",
        rgw_user_uid="billing-standalone-user",
        rgw_tenant="science",
        rgw_access_key="AK-BILLING-STANDALONE",
        rgw_secret_key="secret",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add_all([account, user])
    db_session.commit()
    return account, user


def _rate_plan(
    db_session,
    *,
    name: str,
    storage_basis: str,
    storage_price: str,
    egress_price: str,
    ingress_price: str,
    request_price: str,
) -> BillingRatePlan:
    plan = BillingRatePlan(name=name, storage_endpoint_id=None)
    db_session.add(
        BillingRateCard(
            rate_plan=plan,
            currency="EUR",
            storage_charge_basis=storage_basis,
            storage_gb_month_price=Decimal(storage_price),
            egress_gb_price=Decimal(egress_price),
            ingress_gb_price=Decimal(ingress_price),
            requests_per_1000_price=Decimal(request_price),
            effective_from=JANUARY_START,
        )
    )
    db_session.commit()
    return plan


def _entity(db_session, *, subject_type: str, subject_id: int, name: str, plan: BillingRatePlan):
    entity = BillingEntityService(db_session).create(
        BillingEntityPayload(
            name=name,
            subject_type=subject_type,
            explicit_include_ids=[subject_id],
        )
    )
    db_session.add(
        BillingEntityRateAssignment(
            billing_entity_id=entity.id,
            rate_plan_id=plan.id,
            effective_from=JANUARY_START,
        )
    )
    db_session.commit()
    return entity


class _FictitiousRGW:
    def __init__(self, account: S3Account, user: S3User) -> None:
        self.account = account
        self.user = user
        self.day = JANUARY_START
        self.usage_uids: list[str] = []
        self.storage_uids: list[str] = []

    @property
    def offset(self) -> int:
        return (self.day - JANUARY_START).days

    @staticmethod
    def _usage(gib: int, objects: int) -> dict:
        return {
            "rgw.main": {
                "size_kb_actual": gib * GIB // 1024,
                "num_objects": objects,
            }
        }

    def get_usage(self, **kwargs):
        uid = kwargs["uid"]
        self.usage_uids.append(uid)
        assert kwargs["start"].date() == self.day
        assert kwargs["end"].date() == self.day + timedelta(days=1)
        assert kwargs["show_entries"] is True
        assert kwargs["show_summary"] is False

        if uid == self.account.rgw_account_id:
            put_ops = 1000 + 10 * self.offset
            get_ops = 500 + 5 * self.offset
            return {
                "entries": [
                    {
                        "user": uid,
                        "buckets": [
                            {
                                "bucket": "research-data",
                                "time": f"{self.day.isoformat()} 12:00:00",
                                "categories": [
                                    {
                                        "category": "put_obj",
                                        "bytes_received": (1 + self.offset) * GIB,
                                        "bytes_sent": 0,
                                        "ops": put_ops,
                                        "successful_ops": put_ops,
                                    }
                                ],
                            },
                            {
                                "bucket": "research-archive",
                                "time": f"{self.day.isoformat()} 13:00:00",
                                "categories": [
                                    {
                                        "category": "get_obj",
                                        "bytes_received": 0,
                                        "bytes_sent": (2 + 2 * self.offset) * GIB,
                                        "ops": get_ops,
                                        "successful_ops": get_ops,
                                    }
                                ],
                            },
                            {
                                # A provider response can include the exact end
                                # boundary. It belongs to the following day and
                                # must not be billed twice.
                                "bucket": "next-day-boundary",
                                "time": f"{(self.day + timedelta(days=1)).isoformat()} 00:00:00",
                                "categories": [
                                    {
                                        "category": "put_obj",
                                        "bytes_received": 50 * GIB,
                                        "bytes_sent": 50 * GIB,
                                        "ops": 50_000,
                                        "successful_ops": 50_000,
                                    }
                                ],
                            },
                        ],
                    }
                ]
            }

        assert uid == "science$billing-standalone-user"
        return {
            "entries": [
                {
                    "user": uid,
                    "buckets": [
                        {
                            "bucket": "standalone-data",
                            "time": f"{self.day.isoformat()} 14:00:00",
                            "categories": [
                                {
                                    "category": "put_obj",
                                    "bytes_received": GIB // 2,
                                    "bytes_sent": 0,
                                    "ops": 1200,
                                    "successful_ops": 1200,
                                },
                                {
                                    "category": "get_obj",
                                    "bytes_received": 0,
                                    "bytes_sent": GIB,
                                    "ops": 800,
                                    "successful_ops": 800,
                                },
                            ],
                        }
                    ],
                }
            ]
        }

    def get_all_buckets(self, **kwargs):
        uid = kwargs["uid"]
        self.storage_uids.append(uid)
        assert kwargs["with_stats"] is True
        if uid == self.account.rgw_user_uid:
            return {
                "buckets": [
                    {
                        "bucket": "research-data",
                        "usage": self._usage(10 + self.offset, 100 + self.offset),
                    },
                    {
                        "bucket": "research-archive",
                        "usage": self._usage(5, 50),
                    },
                    {"bucket": "research-empty", "usage": {}},
                ]
            }
        assert uid == "science$billing-standalone-user"
        return {
            "buckets": [
                {
                    "bucket": "standalone-data",
                    "usage": self._usage(4, 25),
                },
                {"bucket": "standalone-empty", "usage": {}},
            ]
        }

    def get_account_quota_snapshot(self, account_id: str) -> QuotaSnapshot:
        assert account_id == self.account.rgw_account_id
        return QuotaSnapshot(500 * GIB, None, "valid")

    def get_user_quota_snapshot(self, uid: str, tenant: str | None = None) -> QuotaSnapshot:
        assert uid == self.user.rgw_user_uid
        assert tenant == self.user.rgw_tenant
        quota_gib = 100 if self.day <= date(2026, 1, 15) else 200
        return QuotaSnapshot(quota_gib * GIB, None, "valid")


def test_rgw_sources_produce_coherent_actual_and_quota_statements_without_cross_subject_double_counting(
    db_session,
):
    endpoint = _endpoint(db_session)
    account, user = _subjects(db_session, endpoint)
    actual_plan = _rate_plan(
        db_session,
        name="rgw-source-actual",
        storage_basis="actual_usage",
        storage_price="0.25",
        egress_price="0.02",
        ingress_price="0.005",
        request_price="0.004",
    )
    quota_plan = _rate_plan(
        db_session,
        name="rgw-source-quota",
        storage_basis="allocated_quota",
        storage_price="0.10",
        egress_price="0.03",
        ingress_price="0.01",
        request_price="0.002",
    )
    account_entity = _entity(
        db_session,
        subject_type="account",
        subject_id=account.id,
        name="Research billing",
        plan=actual_plan,
    )
    user_entity = _entity(
        db_session,
        subject_type="s3_user",
        subject_id=user.id,
        name="Standalone billing",
        plan=quota_plan,
    )

    rgw = _FictitiousRGW(account, user)
    collector = BillingCollector(db_session)
    for offset in range(31):
        rgw.day = JANUARY_START + timedelta(days=offset)
        usage_created, usage_errors = collector._collect_usage_for_endpoint(rgw, endpoint, rgw.day)
        storage_created, storage_errors = collector._collect_storage_for_endpoint(
            rgw,
            endpoint,
            rgw.day,
            quota_admin=rgw,
        )
        assert (usage_created, usage_errors) == (2, [])
        assert (storage_created, storage_errors) == (2, [])

    assert db_session.query(BillingUsageDaily).count() == 62
    assert db_session.query(BillingStorageDaily).count() == 62
    first_account_usage = (
        db_session.query(BillingUsageDaily)
        .filter_by(day=JANUARY_START, s3_account_id=account.id)
        .one()
    )
    assert first_account_usage.bytes_in == GIB
    assert first_account_usage.bytes_out == 2 * GIB
    assert first_account_usage.ops_total == 1500

    statement_service = BillingStatementService(db_session)
    account_statement = statement_service.generate(
        month="2026-01",
        billing_entity_id=account_entity.id,
    ).statements[0]
    user_statement = statement_service.generate(
        month="2026-01",
        billing_entity_id=user_entity.id,
    ).statements[0]

    assert account_statement.blockers == []
    assert account_statement.member_count == 1
    assert account_statement.total == Decimal("30.033900")
    account_line = account_statement.lines[0].snapshot
    assert account_line.subject_type == "account"
    assert account_line.subject_id == account.id
    assert account_line.storage.avg_gb_month == Decimal("30.000000000000")
    assert account_line.usage.bytes_in == 496 * GIB
    assert account_line.usage.bytes_out == 992 * GIB
    assert account_line.usage.ops_total == 53_475
    assert account_line.amounts.storage_cost == Decimal("7.500000")
    assert account_line.amounts.egress_cost == Decimal("19.840000")
    assert account_line.amounts.ingress_cost == Decimal("2.480000")
    assert account_line.amounts.requests_cost == Decimal("0.213900")
    assert account_line.amounts.total_cost == Decimal("30.033900")

    assert user_statement.blockers == []
    assert user_statement.member_count == 1
    assert user_statement.total == Decimal("16.370290")
    user_line = user_statement.lines[0].snapshot
    assert user_line.subject_type == "s3_user"
    assert user_line.subject_id == user.id
    assert user_line.usage.bytes_in == 31 * (GIB // 2)
    assert user_line.usage.bytes_out == 31 * GIB
    assert user_line.usage.ops_total == 62_000
    assert user_line.priced_storage_quantity is not None
    assert user_line.priced_storage_quantity.basis == "allocated_quota"
    assert user_line.priced_storage_quantity.quantity_gib_month == Decimal("151.612903225806")
    assert user_line.amounts.storage_cost == Decimal("15.161290")
    assert user_line.amounts.egress_cost == Decimal("0.930000")
    assert user_line.amounts.ingress_cost == Decimal("0.155000")
    assert user_line.amounts.requests_cost == Decimal("0.124000")
    assert user_line.amounts.total_cost == Decimal("16.370290")

    assert set(rgw.usage_uids) == {
        account.rgw_account_id,
        "science$billing-standalone-user",
    }
    assert set(rgw.storage_uids) == {
        account.rgw_user_uid,
        "science$billing-standalone-user",
    }


class _BucketStatsRGW:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def get_all_buckets(self, **_kwargs):
        return self.payload


def test_storage_collection_rejects_unknown_bucket_stats_but_accepts_measured_empty_bucket(db_session):
    endpoint = _endpoint(db_session)
    account, _user = _subjects(db_session, endpoint)
    collector = BillingCollector(db_session)

    incomplete = _BucketStatsRGW(
        {
            "buckets": [
                {"bucket": "measured-empty", "usage": {}},
                {"bucket": "missing-stats"},
            ]
        }
    )
    created, errors = collector._collect_storage_for_endpoint(
        incomplete,
        endpoint,
        JANUARY_START,
    )

    # Both configured subjects are attempted. Neither may persist a partial
    # storage snapshot because the provider data is incomplete.
    assert created == 0
    assert {error["stage"] for error in errors} == {"storage"}
    assert db_session.query(BillingStorageDaily).count() == 0

    # With an explicit empty RGW usage map, zero is a measured value and can be
    # persisted as a complete daily storage observation.
    measured_empty = _BucketStatsRGW({"buckets": [{"bucket": "empty", "usage": {}}]})
    created, errors = collector._collect_storage_for_endpoint(
        measured_empty,
        endpoint,
        JANUARY_START + timedelta(days=1),
    )

    assert (created, errors) == (2, [])
    rows = db_session.query(BillingStorageDaily).all()
    assert len(rows) == 2
    assert {(row.total_bytes, row.total_objects) for row in rows} == {(0, 0)}
