from app.main import app
from app.models.iam import IAMDetailedPageRequest, IAMGroup, IAMRole, IAMUser
from app.models.policy import Policy
from app.routers.manager import iam_groups, iam_roles


class _GroupInventoryService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    def list_groups_page(self, *, marker, max_items, search):
        self.calls.append(("list_groups_page", marker))
        assert max_items == 25
        assert search is None
        return [IAMGroup(name="operators")], None

    def list_group_policies(self, group_name: str):
        self.calls.append(("list_group_policies", group_name))
        return [Policy(name="ReadOnlyAccess", arn="arn:aws:iam::aws:policy/ReadOnlyAccess")]

    def list_group_inline_policies(self, group_name: str):
        self.calls.append(("list_group_inline_policies", group_name))
        return ["local-read"]

    def list_group_users(self, group_name: str):
        self.calls.append(("list_group_users", group_name))
        return [IAMUser(name="alice"), IAMUser(name="bob")]


class _RoleInventoryService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    def list_roles_page(self, *, marker, max_items, search):
        self.calls.append(("list_roles_page", marker))
        assert max_items == 25
        assert search is None
        return [IAMRole(name="reader")], None

    def list_role_policies(self, role_name: str):
        self.calls.append(("list_role_policies", role_name))
        return [Policy(name="ReadOnlyAccess", arn="arn:aws:iam::aws:policy/ReadOnlyAccess")]

    def list_role_inline_policies(self, role_name: str):
        self.calls.append(("list_role_inline_policies", role_name))
        return ["local-read"]


def test_group_page_details_include_inline_policy_names(monkeypatch):
    service = _GroupInventoryService()
    monkeypatch.setattr(iam_groups, "get_iam_service_for_context", lambda _context: service)

    result = iam_groups.list_groups_page(
        query=IAMDetailedPageRequest(include_details=True),
        context=object(),
        _=object(),
    )

    assert result.items[0].policies == ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
    assert result.items[0].inline_policies == ["local-read"]
    assert result.items[0].members == ["alice", "bob"]
    assert service.calls == [
        ("list_groups_page", None),
        ("list_group_policies", "operators"),
        ("list_group_inline_policies", "operators"),
        ("list_group_users", "operators"),
    ]


def test_group_page_without_details_keeps_policy_details_unloaded(monkeypatch):
    service = _GroupInventoryService()
    monkeypatch.setattr(iam_groups, "get_iam_service_for_context", lambda _context: service)

    result = iam_groups.list_groups_page(
        query=IAMDetailedPageRequest(),
        context=object(),
        _=object(),
    )

    assert result.items[0].policies is None
    assert result.items[0].inline_policies is None
    assert result.items[0].members is None
    assert service.calls == [("list_groups_page", None)]


def test_role_page_details_include_inline_policy_names(monkeypatch):
    service = _RoleInventoryService()
    monkeypatch.setattr(iam_roles, "get_iam_service_for_context", lambda _context: service)

    result = iam_roles.list_roles_page(
        query=IAMDetailedPageRequest(include_details=True),
        context=object(),
        _=object(),
    )

    assert result.items[0].policies == ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
    assert result.items[0].inline_policies == ["local-read"]
    assert service.calls == [
        ("list_roles_page", None),
        ("list_role_policies", "reader"),
        ("list_role_inline_policies", "reader"),
    ]


def test_role_page_without_details_keeps_policy_details_unloaded(monkeypatch):
    service = _RoleInventoryService()
    monkeypatch.setattr(iam_roles, "get_iam_service_for_context", lambda _context: service)

    result = iam_roles.list_roles_page(
        query=IAMDetailedPageRequest(),
        context=object(),
        _=object(),
    )

    assert result.items[0].policies is None
    assert result.items[0].inline_policies is None
    assert service.calls == [("list_roles_page", None)]


def test_manager_iam_page_routes_share_flat_query_contract() -> None:
    paths = app.openapi()["paths"]

    detailed_paths = (
        "/api/manager/iam/users/page",
        "/api/manager/iam/groups/page",
        "/api/manager/iam/roles/page",
    )
    for path in detailed_paths:
        parameters = {parameter["name"]: parameter for parameter in paths[path]["get"]["parameters"]}
        assert set(parameters) == {
            "marker",
            "page_size",
            "search",
            "include_details",
            "context_id",
            "execution_endpoint_id",
        }
        assert parameters["page_size"]["schema"] == {
            "type": "integer",
            "maximum": 100,
            "minimum": 1,
            "default": 25,
            "title": "Page Size",
        }
        assert parameters["search"]["schema"]["anyOf"][0] == {
            "type": "string",
            "maxLength": 200,
        }
        assert parameters["include_details"]["schema"]["default"] is False

    policy_parameters = {
        parameter["name"]: parameter
        for parameter in paths["/api/manager/iam/policies/page"]["get"]["parameters"]
    }
    assert set(policy_parameters) == {
        "marker",
        "page_size",
        "search",
        "context_id",
        "execution_endpoint_id",
    }
