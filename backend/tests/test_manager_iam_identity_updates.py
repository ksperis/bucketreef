# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.iam import (
    AccessKeyStatusChange, IAMGroup, IAMGroupCreate, IAMGroupUpdate, IAMRole,
    IAMRoleCreate, IAMRoleUpdate, IAMTag, IAMUser, IAMUserCreate, IAMUserUpdate,
)
from app.models.access_key_metadata import AccessKeyMetadataInput
from app.models.policy import InlinePolicy, Policy
from app.routers.manager import iam_common, iam_groups, iam_roles, iam_users
from app.services import manager_iam_support
from app.services.s3_execution_context import S3ExecutionContext


def _context() -> S3ExecutionContext:
    return S3ExecutionContext(
        context_id="7",
        context_kind="account",
        id=7,
        name="research",
        access_key="AK",
        secret_key="SK",
    )


def test_iam_context_without_credentials_maps_to_http_400() -> None:
    context = S3ExecutionContext(
        context_id="7",
        context_kind="account",
        id=7,
        name="research",
        access_key=None,
        secret_key=None,
    )

    with pytest.raises(HTTPException) as exc_info:
        iam_common.get_iam_service_for_context(context)

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Execution context credentials are missing"


def test_inline_policy_name_mismatch_maps_to_http_400() -> None:
    with pytest.raises(HTTPException) as exc_info:
        iam_common.ensure_inline_policy_name(
            InlinePolicy(name="payload-name", document={}),
            "url-name",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Inline policy name in payload does not match the URL."


class _Audit:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def record_action(self, **kwargs) -> None:
        self.calls.append(kwargs)


class _Metadata:
    def __init__(self, _db) -> None:
        self.calls: list[tuple[int, str, str]] = []

    def rename_iam_principal_metadata(self, account_id: int, old: str, new: str) -> None:
        self.calls.append((account_id, old, new))


class _UserService:
    def __init__(self) -> None:
        self.current_name = "alice"
        self.path = "/old/"
        self.update_calls: list[dict] = []

    def get_user(self, name: str):
        if name != self.current_name:
            return None
        return IAMUser(name=name, arn=f"arn:user/{name}", path=self.path)

    def update_user(self, name: str, *, new_name=None, new_path=None) -> None:
        self.update_calls.append({"name": name, "new_name": new_name, "new_path": new_path})
        if new_name is not None:
            self.current_name = new_name
        if new_path is not None:
            self.path = new_path

    def list_groups_for_user(self, _name: str):
        return [IAMGroup(name="researchers")]

    def list_user_policies(self, _name: str):
        return [Policy(name="ReadOnly", arn="arn:policy/read")]

    def list_user_inline_policies(self, _name: str):
        return ["inline-read"]

    def list_access_keys(self, _name: str):
        return [SimpleNamespace(access_key_id="AKIA")]


class _GroupService:
    def __init__(self) -> None:
        self.current_name = "researchers"
        self.path = "/old/"
        self.update_calls: list[dict] = []

    def get_group(self, name: str):
        if name != self.current_name:
            return None
        return IAMGroup(name=name, arn=f"arn:group/{name}", path=self.path, policies=["arn:policy/read"])

    def update_group(self, name: str, *, new_name=None, new_path=None) -> None:
        self.update_calls.append({"name": name, "new_name": new_name, "new_path": new_path})
        if new_name is not None:
            self.current_name = new_name
        if new_path is not None:
            self.path = new_path


class _RoleService:
    def __init__(self) -> None:
        self.role = IAMRole(
            name="reader",
            path="/service/",
            max_session_duration=3600,
            assume_role_policy_document={"Version": "2012-10-17", "Statement": []},
            tags=[IAMTag(key="team", value="storage"), IAMTag(key="team", value="research")],
        )
        self.duration_calls: list[int] = []
        self.policy_calls: list[object] = []
        self.tag_calls: list[list[IAMTag]] = []
        self.untag_calls: list[list[str]] = []
        self.fail_policy_update = False

    def get_role(self, name: str):
        return self.role if name == self.role.name else None

    def update_role_max_session_duration(self, _name: str, value: int) -> None:
        self.duration_calls.append(value)
        self.role.max_session_duration = value

    def update_role_assume_policy(self, _name: str, value) -> None:
        self.policy_calls.append(value)
        if self.fail_policy_update:
            raise RuntimeError("trust update failed")
        self.role.assume_role_policy_document = value

    def list_role_tags(self, _name: str):
        return list(self.role.tags or [])

    def tag_role(self, _name: str, tags: list[IAMTag]) -> None:
        self.tag_calls.append(tags)
        self.role.tags = [*(self.role.tags or []), *tags]

    def untag_role(self, _name: str, keys: list[str]) -> None:
        self.untag_calls.append(keys)
        self.role.tags = [tag for tag in self.role.tags or [] if tag.key not in keys]


def test_user_detail_rehydrates_provider_relationships(monkeypatch):
    service = _UserService()
    monkeypatch.setattr(iam_users, "get_iam_service_for_context", lambda _account: service)
    monkeypatch.setattr(iam_users, "_annotate_managed_user", lambda _db, _account, user: user)

    result = iam_users.get_user("alice", context=_context(), db=object(), _=object())

    assert result.path == "/old/"
    assert result.groups == ["researchers"]
    assert result.policies == ["arn:policy/read"]
    assert result.inline_policies == ["inline-read"]
    assert result.has_keys is True


def test_update_user_renames_moves_metadata_and_audits_changed_fields(monkeypatch):
    service = _UserService()
    audit = _Audit()
    metadata = _Metadata(object())
    monkeypatch.setattr(iam_users, "get_iam_service_for_context", lambda _account: service)
    monkeypatch.setattr(iam_users, "_annotate_managed_user", lambda _db, _account, user: user)
    monkeypatch.setattr(iam_users, "AccessKeyMetadataService", lambda _db: metadata)
    context = _context()

    result = iam_users.update_user(
        "alice",
        IAMUserUpdate(name="alice-renamed", path="/service/"),
        context=context,
        current_user=object(),
        audit_service=audit,
        db=object(),
    )

    assert service.update_calls == [{"name": "alice", "new_name": "alice-renamed", "new_path": "/service/"}]
    assert metadata.calls == [(7, "alice", "alice-renamed")]
    assert result.name == "alice-renamed"
    assert result.path == "/service/"
    assert len(audit.calls) == 1
    assert audit.calls[0]["action"] == "update_iam_user"
    assert audit.calls[0]["execution_context"] is context
    assert audit.calls[0]["metadata"] == {"previous_name": "alice", "name_updated": True, "path_updated": True}


def test_update_user_blocks_bucketreef_managed_identity(monkeypatch):
    service = _UserService()
    monkeypatch.setattr(iam_users, "get_iam_service_for_context", lambda _account: service)
    def annotate_managed(_db, _account, user):
        user.is_bucketreef_managed = True
        return user
    monkeypatch.setattr(iam_users, "_annotate_managed_user", annotate_managed)

    with pytest.raises(HTTPException) as exc_info:
        iam_users.update_user(
            "alice", IAMUserUpdate(name="renamed"), context=_context(), current_user=object(), audit_service=_Audit(), db=object()
        )

    assert exc_info.value.status_code == 409
    assert service.update_calls == []


def test_update_user_maps_provider_name_conflict_to_http_409(monkeypatch):
    service = _UserService()

    def conflict(*_args, **_kwargs):
        error = ClientError(
            {"Error": {"Code": "EntityAlreadyExists", "Message": "exists"}, "ResponseMetadata": {"HTTPStatusCode": 409}},
            "UpdateUser",
        )
        raise RuntimeError("Unable to update IAM user") from error

    service.update_user = conflict
    monkeypatch.setattr(iam_users, "get_iam_service_for_context", lambda _account: service)
    monkeypatch.setattr(iam_users, "_annotate_managed_user", lambda _db, _account, user: user)

    with pytest.raises(HTTPException) as exc_info:
        iam_users.update_user(
            "alice", IAMUserUpdate(name="taken"), context=_context(), current_user=object(), audit_service=_Audit(), db=object()
        )

    assert exc_info.value.status_code == 409


def test_group_detail_update_and_managed_protection(monkeypatch):
    service = _GroupService()
    audit = _Audit()
    monkeypatch.setattr(iam_groups, "get_iam_service_for_context", lambda _account: service)
    context = _context()

    detail = iam_groups.get_group("researchers", context=context, _=object())
    assert detail.path == "/old/"
    result = iam_groups.update_group(
        "researchers", IAMGroupUpdate(name="scientists", path="/teams/"), context=context, current_user=object(), audit_service=audit
    )
    assert result.name == "scientists"
    assert service.update_calls == [{"name": "researchers", "new_name": "scientists", "new_path": "/teams/"}]
    assert audit.calls[0]["action"] == "update_iam_group"
    assert audit.calls[0]["execution_context"] is context

    with pytest.raises(HTTPException) as exc_info:
        iam_groups.update_group(
            "bkr-portal-user", IAMGroupUpdate(path="/moved/"), context=context, current_user=object(), audit_service=audit
        )
    assert exc_info.value.status_code == 409


@pytest.mark.parametrize("group_name", ["bkr-portal-manager", "bkr-portal-user"])
@pytest.mark.parametrize("operation,extra", [
    ("create_group", {"payload": IAMGroupCreate(name="bkr-portal-manager")}),
    ("update_group", {"payload": IAMGroupUpdate(path="/moved/")}),
    ("delete_group", {}),
    ("add_user_to_group", {"payload": IAMUser(name="alice")}),
    ("remove_user_from_group", {"user_name": "alice"}),
    ("put_group_inline_policy", {"policy_name": "bkr-portal-manager", "payload": InlinePolicy(name="bkr-portal-manager", document={})}),
    ("delete_group_inline_policy", {"policy_name": "bkr-portal-manager"}),
    ("attach_group_policy", {"payload": Policy(name="read", arn="arn:policy/read")}),
    ("detach_group_policy", {"policy_arn": "arn:policy/read"}),
])
def test_portal_group_mutations_are_rejected_before_iam_calls(monkeypatch, group_name, operation, extra):
    if operation == "create_group":
        extra = {"payload": IAMGroupCreate(name=group_name)}
        kwargs = extra
    else:
        kwargs = {"group_name": group_name, **extra}
    if operation in {"add_user_to_group", "remove_user_from_group"}:
        kwargs["db"] = object()

    monkeypatch.setattr(iam_groups, "get_iam_service_for_context", lambda _account: pytest.fail("IAM must not be called"))
    audit = _Audit()
    with pytest.raises(HTTPException) as exc_info:
        getattr(iam_groups, operation)(
            **kwargs, context=_context(), current_user=object(), audit_service=audit,
        )
    assert exc_info.value.status_code == 409
    assert audit.calls == []


@pytest.mark.parametrize("management_source", ["portal", "private_access"])
@pytest.mark.parametrize("operation,extra", [
    ("delete_user", {}),
    ("create_access_key", {}),
    ("update_access_key_metadata", {"access_key_id": "AKIA", "payload": AccessKeyMetadataInput(name="key")}),
    ("update_access_key_status", {"access_key_id": "AKIA", "payload": AccessKeyStatusChange(active=False)}),
    ("delete_access_key", {"access_key_id": "AKIA"}),
    ("put_user_inline_policy", {"policy_name": "p", "payload": InlinePolicy(name="p", document={})}),
    ("delete_user_inline_policy", {"policy_name": "p"}),
    ("attach_user_policy", {"payload": Policy(name="read", arn="arn:policy/read")}),
    ("detach_user_policy", {"policy_arn": "arn:policy/read"}),
])
def test_managed_user_mutations_are_rejected_before_iam_calls(monkeypatch, management_source, operation, extra):
    monkeypatch.setattr(
        manager_iam_support, "managed_iam_user_source",
        lambda _db, _account, _name: (management_source, None),
    )
    monkeypatch.setattr(iam_users, "get_iam_service_for_context", lambda _account: pytest.fail("IAM must not be called"))
    audit = _Audit()
    with pytest.raises(HTTPException) as exc_info:
        getattr(iam_users, operation)(
            "alice", **extra, context=_context(), current_user=object(), audit_service=audit, db=object(),
        )
    assert exc_info.value.status_code == 409
    assert audit.calls == []


@pytest.mark.parametrize("management_source", ["portal", "private_access"])
@pytest.mark.parametrize("operation,extra", [
    ("add_user_to_group", {"payload": IAMUser(name="alice")}),
    ("remove_user_from_group", {"user_name": "alice"}),
])
def test_managed_user_cannot_be_added_to_or_removed_from_other_groups(monkeypatch, management_source, operation, extra):
    monkeypatch.setattr(
        manager_iam_support, "managed_iam_user_source",
        lambda _db, _account, _name: (management_source, None),
    )
    monkeypatch.setattr(iam_groups, "get_iam_service_for_context", lambda _account: pytest.fail("IAM must not be called"))
    audit = _Audit()
    with pytest.raises(HTTPException) as exc_info:
        getattr(iam_groups, operation)(
            "researchers", **extra, context=_context(), current_user=object(), audit_service=audit, db=object(),
        )
    assert exc_info.value.status_code == 409
    assert audit.calls == []


@pytest.mark.parametrize("group_name", ["bkr-portal-manager", "bkr-portal-user"])
def test_iam_user_creation_rejects_portal_managed_group_membership(monkeypatch, group_name):
    monkeypatch.setattr(iam_users, "get_iam_service_for_context", lambda _account: pytest.fail("IAM must not be called"))
    audit = _Audit()
    with pytest.raises(HTTPException) as exc_info:
        iam_users.create_user(
            IAMUserCreate(name="alice", groups=[group_name]),
            context=_context(), current_user=object(), audit_service=audit,
        )
    assert exc_info.value.status_code == 409
    assert audit.calls == []


def test_update_role_calls_only_changed_native_operations_and_audits_each_success(monkeypatch):
    service = _RoleService()
    audit = _Audit()
    monkeypatch.setattr(iam_roles, "get_iam_service_for_context", lambda _account: service)
    context = _context()

    unchanged = iam_roles.update_role(
        "reader",
        IAMRoleUpdate(max_session_duration=3600, assume_role_policy_document={"Statement": [], "Version": "2012-10-17"}),
        context=context,
        current_user=object(),
        audit_service=audit,
    )
    assert unchanged.max_session_duration == 3600
    assert service.duration_calls == []
    assert service.policy_calls == []
    assert audit.calls == []

    updated_policy = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow"}]}
    updated = iam_roles.update_role(
        "reader",
        IAMRoleUpdate(max_session_duration=7200, assume_role_policy_document=updated_policy),
        context=context,
        current_user=object(),
        audit_service=audit,
    )
    assert updated.max_session_duration == 7200
    assert service.duration_calls == [7200]
    assert service.policy_calls == [updated_policy]
    assert [call["metadata"] for call in audit.calls] == [
        {"max_session_duration": 7200},
        {"assume_role_policy_updated": True},
    ]
    assert all(call["execution_context"] is context for call in audit.calls)


def test_update_role_keeps_audit_for_successful_duration_before_later_failure(monkeypatch):
    service = _RoleService()
    service.fail_policy_update = True
    audit = _Audit()
    monkeypatch.setattr(iam_roles, "get_iam_service_for_context", lambda _account: service)

    with pytest.raises(HTTPException) as exc_info:
        iam_roles.update_role(
            "reader",
            IAMRoleUpdate(max_session_duration=7200, assume_role_policy_document={"Version": "2012-10-17", "Statement": [{}]}),
            context=_context(),
            current_user=object(),
            audit_service=audit,
        )

    assert exc_info.value.status_code == 502
    assert service.duration_calls == [7200]
    assert [call["metadata"] for call in audit.calls] == [{"max_session_duration": 7200}]


def test_role_tags_preserve_duplicate_keys_and_delete_all_values(monkeypatch):
    service = _RoleService()
    audit = _Audit()
    monkeypatch.setattr(iam_roles, "get_iam_service_for_context", lambda _account: service)
    context = _context()

    listed = iam_roles.list_role_tags("reader", context=context, _=object())
    assert [(tag.key, tag.value) for tag in listed] == [("team", "storage"), ("team", "research")]

    added = [IAMTag(key="scope", value="one"), IAMTag(key="scope", value="two")]
    iam_roles.put_role_tags("reader", added, context=context, current_user=object(), audit_service=audit)
    assert service.tag_calls == [added]
    remaining = iam_roles.delete_role_tag("reader", "team", context=context, current_user=object(), audit_service=audit)
    assert service.untag_calls == [["team"]]
    assert all(tag.key != "team" for tag in remaining)
    assert [call["action"] for call in audit.calls] == ["tag_iam_role", "untag_iam_role"]
    assert audit.calls[0]["metadata"] == {"tag_keys": ["scope", "scope"]}
    assert audit.calls[1]["metadata"] == {"tag_keys": ["team"]}


def test_role_tag_update_rejects_provider_false_success(monkeypatch):
    service = _RoleService()
    audit = _Audit()
    monkeypatch.setattr(iam_roles, "get_iam_service_for_context", lambda _account: service)
    service.tag_role = lambda _name, tags: service.tag_calls.append(tags)

    with pytest.raises(HTTPException) as exc_info:
        iam_roles.put_role_tags(
            "reader",
            [IAMTag(key="scope", value="functional")],
            context=_context(),
            current_user=object(),
            audit_service=audit,
        )

    assert exc_info.value.status_code == 502
    assert "did not persist" in str(exc_info.value.detail)
    assert audit.calls == []


def test_role_tag_delete_rejects_provider_false_success(monkeypatch):
    service = _RoleService()
    audit = _Audit()
    monkeypatch.setattr(iam_roles, "get_iam_service_for_context", lambda _account: service)
    service.untag_role = lambda _name, keys: service.untag_calls.append(keys)

    with pytest.raises(HTTPException) as exc_info:
        iam_roles.delete_role_tag(
            "reader",
            "team",
            context=_context(),
            current_user=object(),
            audit_service=audit,
        )

    assert exc_info.value.status_code == 502
    assert "did not persist" in str(exc_info.value.detail)
    assert audit.calls == []


@pytest.mark.parametrize("model", [IAMUserUpdate, IAMGroupUpdate, IAMRoleUpdate])
def test_iam_path_validation_is_shared(model):
    assert model(path="/").path == "/"
    assert model(path="/service/").path == "/service/"
    with pytest.raises(ValidationError):
        model(path="service")
    with pytest.raises(ValidationError):
        model(path="/" + "x" * 511 + "/")


@pytest.mark.parametrize("duration", [3599, 43201])
def test_role_duration_bounds_are_enforced(duration):
    with pytest.raises(ValidationError):
        IAMRoleCreate(name="reader", max_session_duration=duration)
    with pytest.raises(ValidationError):
        IAMRoleUpdate(max_session_duration=duration)
