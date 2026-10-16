from types import SimpleNamespace

from app.scripts import seed_demo_data as seed


def test_seed_iam_client_reuses_cached_access_key(monkeypatch):
    account = SimpleNamespace(name="Demo")
    key = seed.IAMAccessKey(access_key_id="IAM-AK", secret_access_key="IAM-SK")
    provisioned_users: list[str] = []
    client_calls: list[tuple[str, str, str]] = []

    def provision_key(_account, user_name):  # noqa: ANN001
        provisioned_users.append(user_name)
        return key

    def build_client(access_key, secret_key, *, endpoint):  # noqa: ANN001
        client_calls.append((access_key, secret_key, endpoint))
        return object()

    monkeypatch.setattr(seed, "ensure_iam_user_with_key", provision_key)
    monkeypatch.setattr(seed.s3_client, "get_s3_client", build_client)

    cache = {}
    first_key, first_client = seed._seed_iam_client(account, "https://s3.example.test", cache, "demo-svc")
    second_key, second_client = seed._seed_iam_client(account, "https://s3.example.test", cache, "demo-svc")

    assert first_key is key
    assert second_key is key
    assert first_client is not None
    assert second_client is not None
    assert provisioned_users == ["demo-svc"]
    assert client_calls == [
        ("IAM-AK", "IAM-SK", "https://s3.example.test"),
        ("IAM-AK", "IAM-SK", "https://s3.example.test"),
    ]


def test_create_account_data_falls_back_to_account_client_when_iam_provisioning_fails(monkeypatch):
    account = SimpleNamespace(id=7, name="Demo", rgw_account_id="rgw-demo")
    bucket_creates: list[tuple[str, int]] = []
    object_puts: list[dict] = []
    user_links: list[tuple[int, int, str, None]] = []

    class _BucketsService:
        def create_bucket(self, bucket_name, account_arg):  # noqa: ANN001
            bucket_creates.append((bucket_name, account_arg.id))

    class _ObjectClient:
        def put_object(self, **kwargs):  # noqa: ANN003
            object_puts.append(kwargs)

    class _UsersService:
        def get_by_email(self, _email):  # noqa: ANN001
            return None

        def create_user(self, payload):  # noqa: ANN001
            assert payload.email == "admin@example.com"
            return SimpleNamespace(id=11)

        def assign_user_to_account(self, user_id, account_id, *, manager_role, portal_role):  # noqa: ANN001
            user_links.append((user_id, account_id, manager_role, portal_role))

    def fail_iam_provisioning(*_args, **_kwargs):
        raise RuntimeError("IAM unavailable")

    monkeypatch.setattr(seed, "ensure_account", lambda *_args, **_kwargs: account)
    monkeypatch.setattr(seed, "resolve_s3_endpoint", lambda _account: "https://s3.example.test")
    monkeypatch.setattr(seed, "ensure_iam_user_with_key", fail_iam_provisioning)
    monkeypatch.setattr(seed, "generate_object_key", lambda _bucket, _idx: ("sample.txt", "text/plain"))
    monkeypatch.setattr(seed, "build_object_body", lambda _bucket, _key: b"demo")
    monkeypatch.setattr(
        seed,
        "s3_execution_request_kwargs",
        lambda *_args, **_kwargs: {"access_key": "ROOT-AK", "secret_key": "ROOT-SK"},
    )
    monkeypatch.setattr(seed.s3_client, "get_s3_client", lambda *args, **kwargs: _ObjectClient())

    seed.create_account_data(
        object(),
        _BucketsService(),
        _UsersService(),
        seed.AccountPlan(
            name="Demo",
            email="demo@example.com",
            quota_gb=None,
            buckets=[seed.BucketPlan(name="demo-bucket", object_count=1)],
            users=[
                seed.UserPlan(
                    email="admin@example.com",
                    full_name="Demo Admin",
                    password="ChangeMe123!",
                )
            ],
        ),
        storage_endpoint_id=3,
    )

    assert bucket_creates == [("demo-bucket", 7)]
    assert object_puts == [
        {
            "Bucket": "demo-bucket",
            "Key": "sample.txt",
            "Body": b"demo",
            "ContentType": "text/plain",
        }
    ]
    assert user_links == [
        (
            11,
            7,
            seed.ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
            None,
        )
    ]
