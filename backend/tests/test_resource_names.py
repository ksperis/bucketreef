# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.models.ceph_admin import CephAdminRgwUserCreate
from app.models.iam import IAMGroup, IAMGroupCreate, IAMRole, IAMRoleCreate, IAMUser, IAMUserCreate
from app.models.managed_private_access import ManagedIAMPrivateAccessRequest
from app.models.policy import InlinePolicy, PolicyCreate
from app.models.s3_user import S3UserCreate
from app.routers import dependencies
from app.routers.manager import iam_groups, iam_roles, iam_users, topics
from app.services.managed_private_access_service import ManagedPrivateAccessService
from app.services.resource_name_validation import naming_validation_profile
from app.services.s3_execution_context import S3ExecutionContext
from app.db import S3Connection, StorageEndpoint
from app.utils.resource_names import validate_iam_name, validate_inline_policy_name, validate_s3_bucket_name, validate_topic_name
from app.utils.rgw_identifiers import validate_rgw_user_uid
from app.utils.s3_connection_endpoint import build_custom_endpoint_config

VECTORS = json.loads((Path(__file__).parent / "fixtures/resource_names.json").read_text())


@pytest.mark.parametrize("vector", VECTORS)
def test_shared_ui_api_contract(vector):
    def validate():
        kind, value = vector["kind"], vector["value"]
        if kind == "iam":
            return validate_iam_name(value, vector["entity"])
        if kind == "inline":
            return validate_inline_policy_name(value, vector["entity"], vector["profile"])
        if kind == "uid":
            return validate_rgw_user_uid(value, vector.get("tenant"))
        if kind == "bucket":
            return validate_s3_bucket_name(value)
        return validate_topic_name(value)
    if vector["valid"]:
        assert validate() == vector["value"]
    else:
        with pytest.raises(ValueError):
            validate()


@pytest.mark.parametrize("model", [IAMUserCreate, IAMGroupCreate, IAMRoleCreate, PolicyCreate])
def test_creation_models_reject_missing_or_invalid_name_at_field(model):
    for name in ["", "bad name", "name*", "é"]:
        with pytest.raises(ValidationError) as caught:
            model(name=name, **({"document": {}} if model is PolicyCreate else {}))
        assert caught.value.errors()[0]["loc"] == ("name",)


def test_uid_field_errors_and_optional_generated_uid():
    for uid in [None, "", "  "]:
        assert S3UserCreate(name="Display name: $", uid=uid, storage_endpoint_id=1).uid == uid
    for model, kwargs in [(S3UserCreate, {"name": "Display name", "storage_endpoint_id": 1}), (CephAdminRgwUserCreate, {})]:
        with pytest.raises(ValidationError) as caught:
            model(uid="tenant$", **kwargs)
        assert caught.value.errors()[0]["loc"] == ("uid",)
    assert CephAdminRgwUserCreate(uid="bad-tenant$user", tenant="valid_tenant").uid == "bad-tenant$user"
    with pytest.raises(ValidationError) as caught:
        CephAdminRgwUserCreate(uid="user", tenant="bad-tenant")
    assert caught.value.errors()[0]["loc"] == ("tenant",)


@pytest.mark.parametrize("key,value", [("uid", "tenant$"), (" tenant ", "bad-tenant"), ("uid", "anonymous")])
def test_ceph_extra_params_cannot_bypass_identifier_validation(key, value):
    with pytest.raises(ValidationError) as caught:
        CephAdminRgwUserCreate(uid="valid-user", extra_params={key: value})
    assert caught.value.errors()[0]["loc"] == ("extra_params", key.strip())


def test_profile_uses_execution_context_provider_including_manual_connections():
    def context(*, endpoint=None, source_connection=None):
        return S3ExecutionContext(
            context_id="test",
            context_kind="connection" if source_connection is not None else "account",
            name="Test",
            access_key=None,
            secret_key=None,
            storage_endpoint=endpoint,
            source_connection=source_connection,
        )

    assert naming_validation_profile(context(endpoint=StorageEndpoint(provider="ceph"))) == "ceph"
    connection = S3Connection(
        storage_endpoint=None,
        custom_endpoint_config=build_custom_endpoint_config("https://ceph.test", None, True, True, "ceph"),
    )
    assert naming_validation_profile(context(source_connection=connection)) == "ceph"
    for provider in [None, "aws", "other"]:
        assert naming_validation_profile(context(endpoint=StorageEndpoint(provider=provider))) == "standard"
    assert naming_validation_profile(context()) == "standard"


def test_fifo_contract_preserves_aws_configuration():
    for flag in [True, "true"]:
        assert validate_topic_name("events.fifo", provider="aws", configuration={"FifoTopic": flag}) == "events.fifo"
    for name, provider, config in [("events.fifo", "aws", {}), ("events", "aws", {"FifoTopic": True}), ("events.fifo", "ceph", {"FifoTopic": True}), ("events.fifo", None, {"FifoTopic": True}), ("a" * 252 + ".fifo", "aws", {"FifoTopic": True})]:
        with pytest.raises(ValueError):
            validate_topic_name(name, provider=provider, configuration=config)
    with pytest.raises(ValueError):
        validate_topic_name("events", provider="aws", configuration={"FifoTopic": 1})


@pytest.fixture
def naming_client(monkeypatch):
    application = FastAPI()
    account = S3ExecutionContext(
        context_id="test",
        context_kind="account",
        name="Test",
        access_key=None,
        secret_key=None,
        storage_endpoint=StorageEndpoint(provider="ceph"),
    )
    for router in [iam_users.router, iam_groups.router, iam_roles.router, topics.router]:
        application.include_router(router)
    for dep in [dependencies.get_account_context, dependencies.get_current_account_admin, dependencies.require_iam_capable_manager, dependencies.require_sns_capable_manager, dependencies.get_audit_service]:
        application.dependency_overrides[dep] = lambda: account
    service = Mock()
    factories = []
    for module in [iam_users, iam_groups, iam_roles]:
        factory = Mock(return_value=service)
        factories.append(factory)
        monkeypatch.setattr(module, "get_iam_service_for_account", factory)
    application.dependency_overrides[topics.get_topics_service] = lambda: service
    application.dependency_overrides[dependencies.get_audit_service] = lambda: Mock()
    with TestClient(application) as client:
        yield client, service, factories, account


@pytest.mark.parametrize("entity", ["user", "group", "role"])
def test_invalid_nested_policy_prevents_principal_creation(naming_client, entity):
    client, service, factories, account = naming_client
    account.storage_endpoint.provider = "aws"
    response = client.post(f"/manager/iam/{entity}s", json={"name": "valid-name", "inline_policies": [{"name": "valid-policy", "document": {}}, {"name": "bad policy", "document": {}}]})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "inline_policies", 1, "name"]
    assert service.mock_calls == []
    assert all(not factory.called for factory in factories)


@pytest.mark.parametrize("entity", ["user", "group", "role"])
def test_invalid_principal_name_is_rejected_at_name(naming_client, entity):
    client, service, _, _ = naming_client
    response = client.post(f"/manager/iam/{entity}s", json={"name": "bad name"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "name"]
    assert service.mock_calls == []


@pytest.mark.parametrize("entity", ["user", "group", "role"])
def test_valid_ceph_inline_policy_reaches_the_correct_operation(naming_client, entity):
    client, service, _, _ = naming_client
    policy_name = "arbitrary role _+ name" if entity == "role" else "inline:valid"
    model = {"user": IAMUser, "group": IAMGroup, "role": IAMRole}[entity]
    result = model(name="valid-name")
    getattr(service, f"create_{entity}").return_value = (result, None) if entity == "user" else result
    response = client.post(f"/manager/iam/{entity}s", json={"name": "valid-name", "inline_policies": [{"name": policy_name, "document": {}}]})
    assert response.status_code == 201
    getattr(service, f"put_{entity}_inline_policy").assert_called_once_with("valid-name", policy_name, {})


@pytest.mark.parametrize("entity", ["user", "group", "role"])
def test_invalid_policy_path_or_body_never_puts_policy(naming_client, entity):
    client, service, _, account = naming_client
    account.storage_endpoint.provider = "aws"
    response = client.put(f"/manager/iam/{entity}s/alice/inline-policies/bad%20name", json={"name": "valid-name", "document": {}})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["path", "policy_name"]
    response = client.put(f"/manager/iam/{entity}s/alice/inline-policies/valid-name", json={"name": "bad name", "document": {}})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "name"]
    assert service.mock_calls == []
    response = client.put(f"/manager/iam/{entity}s/alice/inline-policies/valid-name", json={"name": "different-name", "document": {}})
    assert response.status_code == 400
    assert service.mock_calls == []


def test_invalid_topic_never_creates_remote_topic(naming_client):
    client, service, _, _ = naming_client
    response = client.post("/manager/topics", json={"name": "bad topic"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "name"]
    assert service.mock_calls == []


def test_private_access_prevalidates_before_claim_or_remote_work():
    service = object.__new__(ManagedPrivateAccessService)
    service._ensure_managed_private_connection_provisioning_allowed = Mock()
    service.sources = Mock()
    service._claim = Mock()
    service._iam_service_for_account = Mock()
    payload = ManagedIAMPrivateAccessRequest(connection_name="private", access_browser=True, access_manager=False, inline_policies=[{"name": "invalid_under", "document": {}}])
    with pytest.raises(RequestValidationError):
        service.provision_iam(
            user=Mock(),
            account=S3ExecutionContext(
                context_id="test",
                context_kind="account",
                name="Test",
                access_key=None,
                secret_key=None,
                storage_endpoint=StorageEndpoint(provider="ceph"),
            ),
            payload=payload,
        )
    assert service.sources.mock_calls == []
    service._claim.assert_not_called()
    service._iam_service_for_account.assert_not_called()


def test_external_inline_policy_read_model_remains_unrestricted():
    assert InlinePolicy(name="existing policy _+ " + "a" * 200, document={}).name.startswith("existing policy")
