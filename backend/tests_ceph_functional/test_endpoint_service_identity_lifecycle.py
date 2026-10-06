# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Opt-in qualification of restricted Admin Ops and managed identities on real RGW."""
import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base, StorageEndpoint
from app.services.endpoint_service_identities import EndpointServiceIdentityService
from app.services.rgw_admin import get_rgw_admin_client
from app.services.rgw_endpoint_clients import get_endpoint_runtime_rgw_client

pytestmark = [
    pytest.mark.ceph_functional,
    pytest.mark.skipif(os.getenv("CEPH_TEST_SERVICE_IDENTITIES") != "1", reason="Set CEPH_TEST_SERVICE_IDENTITIES=1 on an isolated qualification RGW."),
]


def test_restricted_admin_ops_creates_and_revokes_runtime_supervision(ceph_test_settings, tmp_path):
    config = ceph_test_settings
    if not all((config.rgw_admin_endpoint, config.rgw_admin_access_key, config.rgw_admin_secret_key)):
        pytest.fail("RGW qualification credentials are required.")
    owner = get_rgw_admin_client(access_key=config.rgw_admin_access_key, secret_key=config.rgw_admin_secret_key,
                                 endpoint=config.rgw_admin_endpoint, region=config.rgw_admin_region,
                                 verify_tls=config.rgw_ca_bundle or config.rgw_verify_tls)
    operator_uid = f"bkr-qualification-{uuid4().hex}"
    engine = create_engine(f"sqlite:///{tmp_path / 'service-identities.sqlite'}")
    Base.metadata.create_all(engine)
    db = Session(engine)
    endpoint = None
    service = EndpointServiceIdentityService(db)
    try:
        created = owner.create_user(operator_uid, display_name="BucketReef identity qualification", extra_params={"max-buckets": 0})
        credentials = owner.extract_keys(created)
        if not credentials:
            pytest.fail("RGW did not provide qualification operator credentials.")
        owner.set_user_caps(operator_uid, "users=read,write;accounts=read")
        endpoint = StorageEndpoint(name="Isolated qualification", endpoint_url=config.rgw_admin_endpoint, provider="ceph",
                                   region=config.rgw_admin_region, verify_tls=config.rgw_verify_tls,
                                   admin_access_key=credentials[0]["access_key"], admin_secret_key=credentials[0]["secret_key"],
                                   features_config="features:\n  admin:\n    enabled: true\n  metrics:\n    enabled: true\n")
        db.add(endpoint); db.commit()
        service.reconcile(endpoint)
        for kind in ("runtime", "supervision"):
            identity = endpoint.service_identity(kind)
            if identity is None or identity.status != "ready":
                pytest.fail(f"Real RGW qualification failed for {kind}; inspect its required caps and Admin Ops provisioning support.")
        runtime = get_endpoint_runtime_rgw_client(endpoint)
        user = runtime.get_user_by_access_key(endpoint.runtime_access_key, allow_not_found=True)
        if not user or any(user.get(field) for field in ("keys", "swift_keys", "temp_url_keys")):
            pytest.fail("Runtime user information must be returned without any keys.")
    finally:
        pending = []
        if endpoint is not None:
            for kind in ("runtime", "supervision"):
                identity = endpoint.service_identity(kind)
                if identity and identity.status != "disabled" and not service.revoke(endpoint, kind):
                    pending.append(identity.rgw_uid)
        # Preserve the restricted operator if cleanup needs a retry; no purge.
        if not pending:
            owner.delete_user(operator_uid)
        db.close(); engine.dispose()
        if pending:
            pytest.fail(f"Qualification cleanup is pending for RGW UIDs: {', '.join(pending)}; operator UID: {operator_uid}")
