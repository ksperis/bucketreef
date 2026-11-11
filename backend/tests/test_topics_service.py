# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.db import StorageEndpoint
from app.core.domain_enums import StorageProvider
from app.models.topic import Topic, TopicConfiguration, TopicCreate, TopicPolicy
from app.routers.manager import topics as topics_router
from app.services import sns_client
from app.services.s3_execution_context import S3ExecutionContext
from app.services.topics_service import TopicsService


def _account(provider: str | None = None) -> S3ExecutionContext:
    endpoint = StorageEndpoint(
        name=f"{provider or StorageProvider.OTHER.value}-sns",
        endpoint_url="https://ceph-sns.example.test",
        provider=provider or StorageProvider.OTHER.value,
    )
    return S3ExecutionContext(
        context_id="test",
        context_kind="account",
        name="SNS test",
        access_key="AKIA_TEST",
        secret_key="SECRET_TEST",
        storage_endpoint=endpoint,
    )


def _ceph_account() -> S3ExecutionContext:
    return _account(StorageProvider.CEPH.value)


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (
            Topic,
            {
                "name": "topic",
                "arn": "arn:aws:sns:lab:tenant:topic",
                "subscriptions": [],
            },
        ),
        (TopicCreate, {"name": "topic", "subscriptions": []}),
        (TopicPolicy, {"policy": {}, "subscriptions": []}),
        (TopicConfiguration, {"configuration": {}, "subscriptions": []}),
    ],
)
def test_topic_contracts_reject_removed_subscriptions_field(model, payload):
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        model.model_validate(payload)


@pytest.mark.parametrize(
    ("removed_field", "value"),
    [("owner", "tenant"), ("is_ceph", True)],
)
def test_topic_contract_rejects_removed_metadata(removed_field, value):
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        Topic.model_validate(
            {
                "name": "topic",
                "arn": "arn:aws:sns:lab:tenant:topic",
                removed_field: value,
            }
        )


def test_set_topic_configuration_skips_noop(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:lab:tenant:topic"
    attributes = {
        "TopicArn": arn,
        "Name": "topic",
        "User": "tenant",
        "push-endpoint": "https://example.com/webhook",
        "verify-ssl": "false",
    }

    monkeypatch.setattr(sns_client, "get_topic_attributes", lambda *_, **__: attributes)
    calls: list[dict] = []

    def fake_set_topic_attributes(topic_arn, attrs, access_key=None, secret_key=None, **kwargs):
        calls.append({"topic_arn": topic_arn, "attrs": attrs})

    monkeypatch.setattr(sns_client, "set_topic_attributes", fake_set_topic_attributes)

    result = service.set_topic_configuration(
        _account(),
        arn,
        {"push-endpoint": "https://example.com/webhook", "verify-ssl": False},
    )

    assert result == {"push-endpoint": "https://example.com/webhook", "verify-ssl": False}
    assert calls == []


def test_parse_topic_configuration_normalizes_ceph_endpoint():
    service = TopicsService()
    arn = "arn:aws:sns:lab:tenant:topic"
    attributes = {
        "TopicArn": arn,
        "Name": "topic",
        "User": "tenant",
        "Policy": '{"Version":"2012-10-17","Statement":[]}',
        "Version": "2012-10-17",
        "Statement": [{"Effect": "Allow"}],
        "SubscriptionsConfirmed": "2",
        "SubscriptionsPending": "1",
        "SubscriptionsDeleted": "3",
        "EndPoint": json.dumps(
            {
                "EndpointAddress": "https://example.com/webhook",
                "EndpointArgs": "verify-ssl=false&persistent=true&time_to_live=60&empty=&HasStoredSecret=true",
                "EndpointTopic": "topic",
                "HasStoredSecret": "true",
            }
        ),
        "OpaqueData": "trace=lab",
    }

    result = service._parse_configurable_attributes(attributes)

    assert result == {
        "push-endpoint": "https://example.com/webhook",
        "verify-ssl": False,
        "persistent": True,
        "time_to_live": 60,
        "OpaqueData": "trace=lab",
    }
    assert "EndPoint" not in result
    assert "EndpointTopic" not in result
    assert "HasStoredSecret" not in result
    assert "Policy" not in result
    assert "Version" not in result
    assert "Statement" not in result
    assert "SubscriptionsConfirmed" not in result
    assert "SubscriptionsPending" not in result
    assert "SubscriptionsDeleted" not in result


def test_set_topic_configuration_skips_noop_for_ceph_endpoint(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:lab:tenant:topic"
    attributes = {
        "TopicArn": arn,
        "Name": "topic",
        "User": "tenant",
        "EndPoint": json.dumps(
            {
                "EndpointAddress": "https://example.com/webhook",
                "EndpointArgs": "verify-ssl=false&persistent=true&time_to_live=60",
                "EndpointTopic": "topic",
                "HasStoredSecret": "false",
            }
        ),
        "OpaqueData": "trace=lab",
    }

    monkeypatch.setattr(sns_client, "get_topic_attributes", lambda *_, **__: attributes)
    calls: list[dict] = []

    def fake_set_topic_attributes(topic_arn, attrs, access_key=None, secret_key=None, **kwargs):
        calls.append({"topic_arn": topic_arn, "attrs": attrs})

    monkeypatch.setattr(sns_client, "set_topic_attributes", fake_set_topic_attributes)

    result = service.set_topic_configuration(
        _account(),
        arn,
        {
            "push-endpoint": "https://example.com/webhook",
            "verify-ssl": False,
            "persistent": True,
            "time_to_live": 60,
            "OpaqueData": "trace=lab",
        },
    )

    assert result == {
        "push-endpoint": "https://example.com/webhook",
        "verify-ssl": False,
        "persistent": True,
        "time_to_live": 60,
        "OpaqueData": "trace=lab",
    }
    assert calls == []


def test_set_topic_configuration_only_sends_changes(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:lab:tenant:topic"
    responses = [
        {
            "TopicArn": arn,
            "Name": "topic",
            "push-endpoint": "https://old.example.com",
            "verify-ssl": "false",
        },
        {
            "TopicArn": arn,
            "Name": "topic",
            "push-endpoint": "https://new.example.com",
            "verify-ssl": "false",
        },
    ]
    last = responses[-1]

    def fake_get_topic_attributes(*_, **__):
        nonlocal responses, last
        if responses:
            last = responses.pop(0)
        return last

    monkeypatch.setattr(sns_client, "get_topic_attributes", fake_get_topic_attributes)
    sent: dict | None = None

    def fake_set_topic_attributes(topic_arn, attrs, access_key=None, secret_key=None, **kwargs):
        nonlocal sent
        sent = {"topic_arn": topic_arn, "attrs": attrs}

    monkeypatch.setattr(sns_client, "set_topic_attributes", fake_set_topic_attributes)

    result = service.set_topic_configuration(
        _account(),
        arn,
        {"push-endpoint": "https://new.example.com", "verify-ssl": False},
    )

    assert sent == {"topic_arn": arn, "attrs": {"push-endpoint": "https://new.example.com"}}
    assert result == {"push-endpoint": "https://new.example.com", "verify-ssl": False}


def test_list_topics_deduplicates_ceph_entries_and_loads_topic_attributes(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:default:tenant:topic-generic_test_unistra_preprod2"
    monkeypatch.setattr(
        sns_client,
        "list_topics_raw",
        lambda *_, **__: [
            {"TopicArn": arn, "Name": "topic-generic_test_unistra_preprod2"},
            {"TopicArn": arn, "Name": "topic-generic_test_unistra_preprod2"},
            {
                "TopicArn": arn,
                "Name": "projet-test-s3ls-unistra-preprod",
                "EndpointAddress": "https://notify.example.test/hooks/topic",
                "EndpointTopic": "endpoint-topic",
                "EndpointArgs": "persistent=true&verify-ssl=false&time_to_live=60",
                "Persistent": "true",
                "OpaqueData": "trace=lab",
            },
        ],
    )
    monkeypatch.setattr(sns_client, "list_topics", lambda *_, **__: (_ for _ in ()).throw(AssertionError("unused")))
    attributes_calls: list[str] = []

    def fake_get_topic_attributes(topic_arn, *_, **__):
        attributes_calls.append(topic_arn)
        return {
            "TopicArn": topic_arn,
            "Owner": "tenant",
        }

    monkeypatch.setattr(sns_client, "get_topic_attributes", fake_get_topic_attributes)

    topics = service.list_topics(_ceph_account())

    assert len(topics) == 1
    topic = topics[0]
    assert topic.name == "topic-generic_test_unistra_preprod2"
    assert topic.arn == arn
    assert "is_ceph" not in topic.model_dump()
    assert "owner" not in topic.model_dump()
    assert "subscriptions_confirmed" not in topic.model_dump()
    assert "subscriptions_pending" not in topic.model_dump()
    assert attributes_calls == [arn]


def test_list_topics_ignores_ceph_notification_entries_as_topic_names_without_prefix(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:default:tenant:topic-from-arn"
    monkeypatch.setattr(
        sns_client,
        "list_topics_raw",
        lambda *_, **__: [
            {
                "TopicArn": arn,
                "Name": "projet-test-s3ls-unistra-preprod",
                "EndPoint": json.dumps(
                    {
                        "EndpointAddress": "https://notify.example.test/hooks/current",
                        "EndpointTopic": "topic-from-arn",
                        "EndpointArgs": "persistent=false&verify-ssl=true",
                    }
                ),
            },
        ],
    )
    monkeypatch.setattr(
        sns_client,
        "get_topic_attributes",
        lambda topic_arn, *_, **__: {
            "TopicArn": topic_arn,
        },
    )

    topics = service.list_topics(_ceph_account())

    assert len(topics) == 1
    assert topics[0].name == "topic-from-arn"


def test_list_topics_keeps_standard_sns_behavior(monkeypatch):
    service = TopicsService()
    arn = "arn:aws:sns:us-east-1:123456789012:standard-topic"
    monkeypatch.setattr(sns_client, "list_topics_raw", lambda *_, **__: (_ for _ in ()).throw(AssertionError("unused")))
    monkeypatch.setattr(sns_client, "list_topics", lambda *_, **__: [{"TopicArn": arn}])
    monkeypatch.setattr(
        sns_client,
        "get_topic_attributes",
        lambda topic_arn, *_, **__: {
            "TopicArn": topic_arn,
            "Owner": "123456789012",
        },
    )

    topics = service.list_topics(_account(StorageProvider.AWS.value))

    assert len(topics) == 1
    assert topics[0].name == "standard-topic"


def test_topics_service_types_missing_credentials() -> None:
    service = TopicsService()
    context = SimpleNamespace(effective_rgw_credentials=lambda: (None, None))

    with pytest.raises(sns_client.SNSOperationError, match="missing SNS credentials"):
        service._context_credentials(context)


def test_topics_service_does_not_mask_unexpected_credential_runtime_error() -> None:
    service = TopicsService()

    def broken_credentials():
        raise RuntimeError("unexpected credential resolver bug")

    context = SimpleNamespace(effective_rgw_credentials=broken_credentials)

    with pytest.raises(RuntimeError, match="unexpected credential resolver bug"):
        service._context_credentials(context)


def test_create_topic_types_missing_gateway_arn(monkeypatch) -> None:
    service = TopicsService()
    monkeypatch.setattr(sns_client, "create_topic", lambda *_, **__: {})

    with pytest.raises(sns_client.SNSOperationError, match="ARN was not returned"):
        service.create_topic(_account(), "events")


def test_manager_topics_route_maps_expected_sns_errors() -> None:
    class FailedTopicsService:
        @staticmethod
        def list_topics(_context):
            raise sns_client.SNSOperationError("SNS provider unavailable")

    with pytest.raises(HTTPException) as exc_info:
        topics_router.list_topics(
            context=_account(),
            service=FailedTopicsService(),
            _sns_guard=None,
            _actor=None,
        )

    assert exc_info.value.status_code == 502


def test_manager_topics_route_does_not_mask_unexpected_runtime_errors() -> None:
    class BrokenTopicsService:
        @staticmethod
        def list_topics(_context):
            raise RuntimeError("unexpected topics bug")

    with pytest.raises(RuntimeError, match="unexpected topics bug"):
        topics_router.list_topics(
            context=_account(),
            service=BrokenTopicsService(),
            _sns_guard=None,
            _actor=None,
        )
