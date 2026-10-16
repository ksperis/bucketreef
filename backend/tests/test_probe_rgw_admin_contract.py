from app.scripts import probe_rgw_admin_contract as probe


def test_contract_checks_generate_canonical_and_rejected_alias_requests(monkeypatch):
    calls: list[tuple[str, dict[str, str]]] = []

    def raw_status(_client, path, *, params):  # noqa: ANN001
        calls.append((path, params))
        return 200 if "id" in params or "uid" in params else 400

    monkeypatch.setattr(probe, "_raw_status", raw_status)

    checks = [
        *probe._account_checks(object(), "account-1"),
        *probe._user_checks(object(), tenant="tenant-a", uid="user-1"),
    ]

    assert [expected for _label, _got, expected in checks] == [
        200,
        400,
        400,
        200,
        400,
        200,
        400,
        400,
    ]
    assert calls == [
        ("/admin/account", {"id": "account-1", "format": "json"}),
        ("/admin/account", {"account-id": "account-1", "format": "json"}),
        ("/admin/account", {"account_id": "account-1", "format": "json"}),
        (
            "/admin/account",
            {"id": "account-1", "sync-stats": "true", "format": "json"},
        ),
        (
            "/admin/account",
            {"account-id": "account-1", "sync-stats": "true", "format": "json"},
        ),
        ("/admin/user", {"format": "json", "tenant": "tenant-a", "uid": "user-1"}),
        (
            "/admin/user",
            {"format": "json", "tenant": "tenant-a", "user-id": "user-1"},
        ),
        (
            "/admin/user",
            {"format": "json", "tenant": "tenant-a", "user_id": "user-1"},
        ),
    ]


def test_print_check_results_returns_failure_when_any_probe_mismatches(capsys):
    status = probe._print_check_results(
        [
            ("accepted", 200, 200),
            ("rejected", 200, 400),
        ]
    )

    assert status == 1
    assert capsys.readouterr().out.splitlines() == [
        "[OK] accepted: got=200 expected=200",
        "[KO] rejected: got=200 expected=400",
    ]
