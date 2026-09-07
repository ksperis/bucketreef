# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.db import UiGroup, User, UserRole
from app.models.ui_group import UiGroupCreate, UiGroupUpdate
from app.models.user import ManagerToolAccess, UserCreate, UserUpdate
from app.services.effective_access_service import EffectiveAccessService
from app.services.identity_security_policy import admin_user_update_requires_step_up
from app.services.manager_tool_access import MANAGER_TOOL_COLUMNS
from app.services.ui_groups_service import UiGroupsService
from app.services.users_service import UsersService


_TOOLS = ("bucket_compare", "bucket_integrity_check", "bucket_migration", "feature_rules", "bucket_purge")
_GRANTS = [(), _TOOLS, *((tool,) for tool in _TOOLS)]


def _access(enabled) -> ManagerToolAccess:
    return ManagerToolAccess(**{tool: tool in enabled for tool in _TOOLS})


def test_manager_tool_contract_covers_exactly_the_persisted_user_and_group_columns():
    assert set(ManagerToolAccess.model_fields) == set(_TOOLS)
    assert MANAGER_TOOL_COLUMNS == {tool: f"can_access_manager_{tool}" for tool in _TOOLS}
    for entity in (User, UiGroup):
        columns = {
            column.name for column in entity.__table__.columns
            if column.name.startswith("can_access_manager_")
        }
        assert columns == set(MANAGER_TOOL_COLUMNS.values())


@pytest.mark.parametrize("entity", ["user", "group"])
@pytest.mark.parametrize("enabled", _GRANTS)
def test_manager_tool_grants_round_trip_create_update_and_output(db_session, entity, enabled):
    initial = _access(enabled)
    if entity == "user":
        service = UsersService(db_session)
        subject = service.create_user(UserCreate(
            email="tools@example.com", password="valid-test-password", manager_tool_access=initial,
        ))
        to_out = service.user_to_out
        update = service.update_user
        payload_type = UserUpdate
    else:
        service = UiGroupsService(db_session)
        subject = service.create_group(UiGroupCreate(name="Tool operators", manager_tool_access=initial))
        to_out = service.group_to_out
        update = service.update_group
        payload_type = UiGroupUpdate

    def assert_grants(expected):
        db_session.refresh(subject)
        assert {tool: getattr(subject, f"can_access_manager_{tool}") for tool in _TOOLS} == expected.model_dump()
        assert to_out(subject).manager_tool_access == expected

    assert_grants(initial)
    # Omitting the nested value, or supplying null, leaves persisted grants intact.
    update(subject.id, payload_type())
    assert_grants(initial)
    update(subject.id, payload_type(manager_tool_access=None))
    assert_grants(initial)

    replacement = _access(set(_TOOLS) - set(enabled))
    update(subject.id, payload_type(manager_tool_access=replacement))
    assert_grants(replacement)
    # An explicit empty object resets every tool to its false schema default.
    update(subject.id, payload_type(manager_tool_access={}))
    assert_grants(_access(()))


@pytest.mark.parametrize("role", [role.value for role in UserRole])
def test_user_role_controls_persisted_and_effective_manager_tools(db_session, role):
    requested = _access(_TOOLS)
    service = UsersService(db_session)
    user = service.create_user(UserCreate(
        email="role-tools@example.com", password="valid-test-password", role=role, manager_tool_access=requested,
    ))
    expected = _access(()) if role == UserRole.UI_NONE.value else requested
    assert service.user_to_out(user).manager_tool_access == expected
    assert EffectiveAccessService(db_session).resolve_user(user).manager_tool_access == expected

    service.update_user(user.id, UserUpdate(role=UserRole.UI_NONE.value))
    assert service.user_to_out(user).manager_tool_access == _access(())
    # Promotion does not restore direct grants cleared during demotion.
    service.update_user(user.id, UserUpdate(role=UserRole.UI_USER.value))
    assert service.user_to_out(user).manager_tool_access == _access(())


def test_role_masking_does_not_rewrite_group_grants(db_session):
    group_service = UiGroupsService(db_session)
    group = group_service.create_group(UiGroupCreate(name="Shared tools", manager_tool_access=_access(_TOOLS)))
    service = UsersService(db_session)
    user = service.create_user(UserCreate(
        email="role-mask@example.com", password="valid-test-password",
        role=UserRole.UI_NONE.value, group_ids=[group.id], manager_tool_access=_access(_TOOLS),
    ))
    assert service.user_to_out(user).manager_tool_access == _access(())
    assert service.user_to_out(user).effective_access.manager_tool_access == _access(())
    assert group_service.group_to_out(group).manager_tool_access == _access(_TOOLS)

    service.update_user(user.id, UserUpdate(role=UserRole.UI_USER.value))
    assert service.user_to_out(user).manager_tool_access == _access(())
    assert service.user_to_out(user).effective_access.manager_tool_access == _access(_TOOLS)


@pytest.mark.parametrize("tool", _TOOLS)
def test_effective_tools_preserve_direct_and_group_provenance(db_session, tool):
    service = UsersService(db_session)
    user = service.create_user(UserCreate(email="group-tools@example.com", password="valid-test-password"))
    group_service = UiGroupsService(db_session)
    group = group_service.create_group(UiGroupCreate(
        name="Tool group", user_ids=[user.id], manager_tool_access=_access((tool,)),
    ))
    inherited = service.user_to_out(user)
    assert inherited.manager_tool_access == _access(())
    assert inherited.effective_access.manager_tool_access == _access((tool,))

    # Matching an inherited grant still changes the user's persisted direct access.
    grant = UserUpdate(manager_tool_access=_access((tool,)))
    assert admin_user_update_requires_step_up(user, grant) is True
    service.update_user(user.id, grant)
    assert admin_user_update_requires_step_up(user, grant) is False

    group_service.update_group(group.id, UiGroupUpdate(manager_tool_access={}))
    direct = service.user_to_out(user)
    assert direct.manager_tool_access == _access((tool,))
    assert direct.effective_access.manager_tool_access == _access((tool,))
    service.update_user(user.id, UserUpdate(manager_tool_access={}))
    assert service.user_to_out(user).effective_access.manager_tool_access == _access(())


@pytest.mark.parametrize("tool", _TOOLS)
@pytest.mark.parametrize("current", [False, True])
def test_each_tool_change_requires_step_up_but_identical_payload_does_not(db_session, tool, current):
    user = User(email="step-up-tools@example.com", hashed_password="x", role=UserRole.UI_USER.value)
    setattr(user, f"can_access_manager_{tool}", current)
    db_session.add(user)
    db_session.commit()
    same = _access((tool,) if current else ())
    changed = _access(() if current else (tool,))

    assert admin_user_update_requires_step_up(user, UserUpdate()) is False
    assert admin_user_update_requires_step_up(user, UserUpdate(manager_tool_access=None)) is False
    assert admin_user_update_requires_step_up(user, UserUpdate(manager_tool_access=same)) is False
    assert admin_user_update_requires_step_up(user, UserUpdate(manager_tool_access=changed)) is True
