# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import boto3
from botocore.exceptions import BotoCoreError, ClientError
from typing import List, Literal, Optional, Union

from app.models.iam import AccessKey, IAMGroup, IAMRole, IAMTag, IAMUser
from app.models.policy import Policy
from app.core.config import get_settings
from app.services.aws_client_config import build_interactive_aws_config
from app.services.rgw_iam_pagination import iam_matches_fields, list_iam_all, list_iam_page
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.aws_errors import aws_error_code
from app.utils.s3_endpoint import resolve_iam_client_options

settings = get_settings()


def _is_no_such_entity(exc: ClientError) -> bool:
    return aws_error_code(exc) == "NoSuchEntity"


def _role_name_from_data(data: dict, fallback: Optional[str] = None) -> Optional[str]:
    """Return the public IAM role name from an RGW role payload."""
    arn = data.get("Arn")
    if isinstance(arn, str):
        resource = arn.rsplit(":", 1)[-1]
        if resource.startswith("role/"):
            arn_name = resource.rsplit("/", 1)[-1]
            if arn_name:
                return arn_name
    raw_name = data.get("RoleName")
    return raw_name if isinstance(raw_name, str) and raw_name else fallback


class RGWIAMGroupAlreadyExistsError(RuntimeError):
    """Raised when IAM reports a concurrent group-name conflict."""


_IAMPolicyTarget = Literal["user", "group", "role"]


def get_iam_client(
    access_key: str,
    secret_key: str,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
):
    if not endpoint:
        raise RuntimeError("IAM endpoint is not configured")
    return boto3.client(
        "iam",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=build_interactive_aws_config(),
        region_name=region or settings.seed_s3_region,
        verify=verify_tls,
    )


class RGWIAMService:
    def __init__(
        self,
        access_key: str,
        secret_key: str,
        endpoint: Optional[str] = None,
        region: Optional[str] = None,
        verify_tls: bool = True,
    ) -> None:
        self.client = get_iam_client(access_key, secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls)
        # Known Ceph-managed policies supported by RGW IAM.
        self._default_policies: list[Policy] = [
            self._policy_from_data({"PolicyName": "AmazonS3FullAccess", "Arn": "arn:aws:iam::aws:policy/AmazonS3FullAccess"}),
            self._policy_from_data({"PolicyName": "AmazonS3ReadOnlyAccess", "Arn": "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"}),
            self._policy_from_data({"PolicyName": "AmazonSNSFullAccess", "Arn": "arn:aws:iam::aws:policy/AmazonSNSFullAccess"}),
            self._policy_from_data({"PolicyName": "AmazonSNSReadOnlyAccess", "Arn": "arn:aws:iam::aws:policy/AmazonSNSReadOnlyAccess"}),
            self._policy_from_data({"PolicyName": "IAMFullAccess", "Arn": "arn:aws:iam::aws:policy/IAMFullAccess"}),
            self._policy_from_data({"PolicyName": "IAMReadOnlyAccess", "Arn": "arn:aws:iam::aws:policy/IAMReadOnlyAccess"}),
        ]

    def _format_access_key(self, data: dict, include_secret: bool = False) -> AccessKey:
        created_at = data.get("CreateDate")
        created_str = None
        if created_at is not None:
            created_str = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
        return AccessKey(
            access_key_id=data.get("AccessKeyId") or data.get("id") or data.get("access_key"),
            status=data.get("Status"),
            created_at=created_str,
            secret_access_key=data.get("SecretAccessKey") if include_secret else None,
        )

    @staticmethod
    def _policy_target_kwargs(target: _IAMPolicyTarget, identity_name: str) -> dict[str, str]:
        return {f"{target.title()}Name": identity_name}

    def _call_tolerating_missing_entity(
        self,
        operation: str,
        *,
        error_message: str,
        **kwargs: object,
    ) -> None:
        try:
            getattr(self.client, operation)(**kwargs)
        except ClientError as exc:
            if _is_no_such_entity(exc):
                return
            raise RuntimeError(f"{error_message}: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"{error_message}: {exc}") from exc

    def _list_attached_policies(self, target: _IAMPolicyTarget, identity_name: str) -> List[Policy]:
        try:
            policies = list_iam_all(
                self.client,
                f"list_attached_{target}_policies",
                "AttachedPolicies",
                **self._policy_target_kwargs(target, identity_name),
            )
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list {target} policies: {exc}") from exc
        return [self._policy_from_data(policy) for policy in policies]

    def _list_inline_policies(self, target: _IAMPolicyTarget, identity_name: str) -> list[str]:
        try:
            policies = list_iam_all(
                self.client,
                f"list_{target}_policies",
                "PolicyNames",
                **self._policy_target_kwargs(target, identity_name),
            )
            return [policy for policy in policies if policy]
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list inline policies for {target}: {exc}") from exc

    def _get_inline_policy(
        self,
        target: _IAMPolicyTarget,
        identity_name: str,
        policy_name: str,
    ) -> Optional[dict]:
        operation = getattr(self.client, f"get_{target}_policy")
        try:
            resp = operation(
                **self._policy_target_kwargs(target, identity_name),
                PolicyName=policy_name,
            )
            return self._normalize_policy_document(resp.get("PolicyDocument"))
        except ClientError as exc:
            if _is_no_such_entity(exc):
                return None
            raise RuntimeError(f"Unable to fetch inline policy for {target}: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch inline policy for {target}: {exc}") from exc

    def _put_inline_policy(
        self,
        target: _IAMPolicyTarget,
        identity_name: str,
        policy_name: str,
        policy_document: Union[dict, str],
    ) -> None:
        operation = getattr(self.client, f"put_{target}_policy")
        document = policy_document if isinstance(policy_document, str) else json.dumps(policy_document)
        try:
            operation(
                **self._policy_target_kwargs(target, identity_name),
                PolicyName=policy_name,
                PolicyDocument=document,
            )
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to put inline policy on {target}: {exc}") from exc

    def _delete_inline_policy(self, target: _IAMPolicyTarget, identity_name: str, policy_name: str) -> None:
        kwargs = self._policy_target_kwargs(target, identity_name)
        kwargs["PolicyName"] = policy_name
        self._call_tolerating_missing_entity(
            f"delete_{target}_policy",
            error_message=f"Unable to delete inline policy from {target}",
            **kwargs,
        )

    def _attach_policy(self, target: _IAMPolicyTarget, identity_name: str, policy_arn: str) -> None:
        operation = getattr(self.client, f"attach_{target}_policy")
        try:
            operation(
                **self._policy_target_kwargs(target, identity_name),
                PolicyArn=policy_arn,
            )
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to attach policy to {target}: {exc}") from exc

    def _detach_policy(self, target: _IAMPolicyTarget, identity_name: str, policy_arn: str) -> None:
        kwargs = self._policy_target_kwargs(target, identity_name)
        kwargs["PolicyArn"] = policy_arn
        self._call_tolerating_missing_entity(
            f"detach_{target}_policy",
            error_message=f"Unable to detach policy from {target}",
            **kwargs,
        )

    def list_users_page(
        self,
        *,
        marker: str | None = None,
        max_items: int = 25,
        search: str | None = None,
    ) -> tuple[list[IAMUser], str | None]:
        try:
            rows, next_marker = list_iam_page(
                self.client,
                "list_users",
                "Users",
                marker=marker,
                max_items=max_items,
                search=search,
                matcher=lambda row, needle: iam_matches_fields(row, needle, "UserName", "Arn", "Path"),
            )
            return [
                IAMUser(
                    name=row.get("UserName"),
                    user_id=row.get("UserId"),
                    arn=row.get("Arn"),
                    path=row.get("Path"),
                )
                for row in rows
                if row.get("UserName")
            ], next_marker
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM users: {exc}") from exc

    # Users
    def list_users(self) -> List[IAMUser]:
        try:
            users: List[IAMUser] = []
            for u in list_iam_all(self.client, "list_users", "Users"):
                name = u.get("UserName")
                arn = u.get("Arn")
                user_id = u.get("UserId")
                if not name:
                    # Skip malformed entries that don't expose a username
                    continue
                user_groups = list_iam_all(self.client, "list_groups_for_user", "Groups", UserName=name)
                group_names = [g.get("GroupName") for g in user_groups if g.get("GroupName")]
                attached = list_iam_all(
                    self.client,
                    "list_attached_user_policies", "AttachedPolicies", UserName=name
                )
                policy_arns = [p.get("PolicyArn") for p in attached if p.get("PolicyArn")]
                inline_names = list_iam_all(self.client, "list_user_policies", "PolicyNames", UserName=name)
                key_metadata = list_iam_all(self.client, "list_access_keys", "AccessKeyMetadata", UserName=name)
                users.append(
                    IAMUser(
                        name=name,
                        user_id=user_id,
                        arn=arn,
                        path=u.get("Path"),
                        groups=group_names,
                        policies=policy_arns,
                        inline_policies=inline_names or None,
                        has_keys=len(key_metadata) > 0,
                    )
                )
            return users
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM users: {exc}") from exc

    def create_user(
        self,
        name: str,
        create_key: bool = False,
        allow_existing: bool = False,
    ) -> tuple[IAMUser, Optional[AccessKey]]:
        try:
            resp = self.client.create_user(UserName=name)
        except ClientError as exc:
            code = aws_error_code(exc)
            if allow_existing and code in {"EntityAlreadyExists", "UserAlreadyExists"}:
                existing = self.get_user(name)
                if existing is not None:
                    return existing, None
            raise RuntimeError(f"Unable to create IAM user: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to create IAM user: {exc}") from exc

        u = resp.get("User", {})
        new_key = None
        if create_key:
            try:
                new_key = self.create_access_key(name)
            except RuntimeError as exc:
                try:
                    self.delete_user(name)
                except RuntimeError as rollback_exc:
                    raise RuntimeError(
                        f"{exc}; Unable to roll back created IAM user {name}: {rollback_exc}"
                    ) from exc
                raise
        return IAMUser(
            name=u.get("UserName") or name,
            user_id=u.get("UserId"),
            arn=u.get("Arn"),
        ), new_key

    def get_user(self, name: str) -> Optional[IAMUser]:
        try:
            resp = self.client.get_user(UserName=name)
            u = resp.get("User", {})
            if not u:
                return None
            return IAMUser(
                name=u.get("UserName") or name,
                user_id=u.get("UserId"),
                arn=u.get("Arn"),
                path=u.get("Path"),
            )
        except ClientError as exc:
            if _is_no_such_entity(exc):
                return None
            raise RuntimeError(f"Unable to fetch IAM user: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch IAM user: {exc}") from exc

    def update_user(self, name: str, *, new_name: Optional[str] = None, new_path: Optional[str] = None) -> None:
        kwargs: dict = {"UserName": name}
        if new_name is not None:
            kwargs["NewUserName"] = new_name
        if new_path is not None:
            kwargs["NewPath"] = new_path
        if len(kwargs) == 1:
            return
        try:
            self.client.update_user(**kwargs)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to update IAM user: {exc}") from exc

    def delete_user(self, name: str) -> None:
        self._call_tolerating_missing_entity(
            "delete_user",
            error_message="Unable to delete IAM user",
            UserName=name,
        )

    def list_access_keys(self, user_name: str) -> List[AccessKey]:
        try:
            keys = list_iam_all(self.client, "list_access_keys", "AccessKeyMetadata", UserName=user_name)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM access keys: {exc}") from exc
        return [self._format_access_key(k) for k in keys]

    def create_access_key(self, user_name: str) -> AccessKey:
        try:
            resp = self.client.create_access_key(UserName=user_name)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to create IAM access key: {exc}") from exc
        return self._format_access_key(resp.get("AccessKey", {}), include_secret=True)

    def delete_access_key(self, user_name: str, access_key_id: str) -> None:
        self._call_tolerating_missing_entity(
            "delete_access_key",
            error_message="Unable to delete IAM access key",
            UserName=user_name,
            AccessKeyId=access_key_id,
        )

    def update_access_key_status(self, user_name: str, access_key_id: str, status: str) -> None:
        try:
            self.client.update_access_key(UserName=user_name, AccessKeyId=access_key_id, Status=status)
        except ClientError as exc:
            if _is_no_such_entity(exc):
                raise RuntimeError("Access key not found") from exc
            raise RuntimeError(f"Unable to update IAM access key: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to update IAM access key: {exc}") from exc

    def list_user_policies(self, user_name: str) -> List[Policy]:
        return self._list_attached_policies("user", user_name)

    def list_user_inline_policies(self, user_name: str) -> list[str]:
        return self._list_inline_policies("user", user_name)

    def get_user_inline_policy(self, user_name: str, policy_name: str) -> Optional[dict]:
        return self._get_inline_policy("user", user_name, policy_name)

    def put_user_inline_policy(self, user_name: str, policy_name: str, policy_document: Union[dict, str]) -> None:
        self._put_inline_policy("user", user_name, policy_name, policy_document)

    def delete_user_inline_policy(self, user_name: str, policy_name: str) -> None:
        self._delete_inline_policy("user", user_name, policy_name)

    def attach_user_policy(self, user_name: str, policy_arn: str) -> None:
        self._attach_policy("user", user_name, policy_arn)

    def detach_user_policy(self, user_name: str, policy_arn: str) -> None:
        self._detach_policy("user", user_name, policy_arn)

    def list_groups_for_user(self, user_name: str) -> List[IAMGroup]:
        try:
            groups = list_iam_all(self.client, "list_groups_for_user", "Groups", UserName=user_name)
            return [
                IAMGroup(name=g.get("GroupName"), arn=g.get("Arn"), path=g.get("Path"))
                for g in groups
                if g.get("GroupName")
            ]
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list groups for user: {exc}") from exc

    # Groups
    def list_groups(self) -> List[IAMGroup]:
        try:
            groups: List[IAMGroup] = []
            for g in list_iam_all(self.client, "list_groups", "Groups"):
                name = g.get("GroupName")
                arn = g.get("Arn")
                attached = list_iam_all(
                    self.client,
                    "list_attached_group_policies", "AttachedPolicies", GroupName=name
                )
                policy_arns = [p.get("PolicyArn") for p in attached if p.get("PolicyArn")]
                groups.append(IAMGroup(name=name, arn=arn, path=g.get("Path"), policies=policy_arns))
            return groups
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM groups: {exc}") from exc

    def list_groups_page(
        self,
        *,
        marker: str | None = None,
        max_items: int = 25,
        search: str | None = None,
    ) -> tuple[list[IAMGroup], str | None]:
        try:
            rows, next_marker = list_iam_page(
                self.client,
                "list_groups",
                "Groups",
                marker=marker,
                max_items=max_items,
                search=search,
                matcher=lambda row, needle: iam_matches_fields(row, needle, "GroupName", "Arn", "Path"),
            )
            return [
                IAMGroup(name=row.get("GroupName"), arn=row.get("Arn"), path=row.get("Path"))
                for row in rows
                if row.get("GroupName")
            ], next_marker
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM groups: {exc}") from exc

    def create_group(self, name: str) -> IAMGroup:
        try:
            resp = self.client.create_group(GroupName=name)
            g = resp.get("Group", {})
            return IAMGroup(name=g.get("GroupName") or name, arn=g.get("Arn"), path=g.get("Path"))
        except ClientError as exc:
            if aws_error_code(exc) == "EntityAlreadyExists":
                raise RGWIAMGroupAlreadyExistsError(f"IAM group already exists: {name}") from exc
            raise RuntimeError(f"Unable to create IAM group: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to create IAM group: {exc}") from exc

    def delete_group(self, name: str) -> None:
        self._call_tolerating_missing_entity(
            "delete_group",
            error_message="Unable to delete IAM group",
            GroupName=name,
        )

    def get_group(self, name: str) -> Optional[IAMGroup]:
        try:
            resp = self.client.get_group(GroupName=name)
            group = resp.get("Group", {}) or {}
            if not group:
                return None
            attached = list_iam_all(
                self.client,
                "list_attached_group_policies", "AttachedPolicies", GroupName=name
            )
            policy_arns = [p.get("PolicyArn") for p in attached if p.get("PolicyArn")]
            return IAMGroup(
                name=group.get("GroupName") or name,
                arn=group.get("Arn"),
                path=group.get("Path"),
                policies=policy_arns,
            )
        except ClientError as exc:
            if _is_no_such_entity(exc):
                return None
            raise RuntimeError(f"Unable to fetch IAM group: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch IAM group: {exc}") from exc

    def update_group(self, name: str, *, new_name: Optional[str] = None, new_path: Optional[str] = None) -> None:
        kwargs: dict = {"GroupName": name}
        if new_name is not None:
            kwargs["NewGroupName"] = new_name
        if new_path is not None:
            kwargs["NewPath"] = new_path
        if len(kwargs) == 1:
            return
        try:
            self.client.update_group(**kwargs)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to update IAM group: {exc}") from exc

    def list_group_users(self, group_name: str) -> List[IAMUser]:
        try:
            paginator = self.client.get_paginator("get_group")
            members: List[IAMUser] = []
            for page in paginator.paginate(GroupName=group_name):
                for u in page.get("Users", []):
                    members.append(IAMUser(name=u.get("UserName"), user_id=u.get("UserId"), arn=u.get("Arn")))
            return members
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM group members: {exc}") from exc

    def add_user_to_group(self, group_name: str, user_name: str) -> None:
        try:
            self.client.add_user_to_group(GroupName=group_name, UserName=user_name)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to add user to group: {exc}") from exc

    def remove_user_from_group(self, group_name: str, user_name: str) -> None:
        self._call_tolerating_missing_entity(
            "remove_user_from_group",
            error_message="Unable to remove user from group",
            GroupName=group_name,
            UserName=user_name,
        )

    def list_group_policies(self, group_name: str) -> List[Policy]:
        return self._list_attached_policies("group", group_name)

    def list_group_inline_policies(self, group_name: str) -> list[str]:
        return self._list_inline_policies("group", group_name)

    def get_group_inline_policy(self, group_name: str, policy_name: str) -> Optional[dict]:
        return self._get_inline_policy("group", group_name, policy_name)

    def put_group_inline_policy(self, group_name: str, policy_name: str, policy_document: Union[dict, str]) -> None:
        self._put_inline_policy("group", group_name, policy_name, policy_document)

    def delete_group_inline_policy(self, group_name: str, policy_name: str) -> None:
        self._delete_inline_policy("group", group_name, policy_name)

    def attach_group_policy(self, group_name: str, policy_arn: str) -> None:
        self._attach_policy("group", group_name, policy_arn)

    def detach_group_policy(self, group_name: str, policy_arn: str) -> None:
        self._detach_policy("group", group_name, policy_arn)

    # Roles
    def list_roles(self) -> List[IAMRole]:
        try:
            roles: List[IAMRole] = []
            for r in list_iam_all(self.client, "list_roles", "Roles"):
                name = _role_name_from_data(r)
                if not name:
                    continue
                arn = r.get("Arn")
                attached = list_iam_all(
                    self.client,
                    "list_attached_role_policies", "AttachedPolicies", RoleName=name
                )
                policy_arns = [p.get("PolicyArn") for p in attached if p.get("PolicyArn")]
                roles.append(
                    IAMRole(
                        name=name,
                        arn=arn,
                        path=r.get("Path"),
                        policies=policy_arns,
                        max_session_duration=r.get("MaxSessionDuration") or 3600,
                    )
                )
            return roles
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM roles: {exc}") from exc

    def list_roles_page(
        self,
        *,
        marker: str | None = None,
        max_items: int = 25,
        search: str | None = None,
    ) -> tuple[list[IAMRole], str | None]:
        try:
            rows, next_marker = list_iam_page(
                self.client,
                "list_roles",
                "Roles",
                marker=marker,
                max_items=max_items,
                search=search,
                matcher=lambda row, needle: iam_matches_fields(row, needle, "RoleName", "Arn", "Path"),
            )
            roles: list[IAMRole] = []
            for row in rows:
                name = _role_name_from_data(row)
                if not name:
                    continue
                roles.append(
                    IAMRole(
                        name=name,
                        arn=row.get("Arn"),
                        path=row.get("Path"),
                        max_session_duration=row.get("MaxSessionDuration") or 3600,
                    )
                )
            return roles, next_marker
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM roles: {exc}") from exc

    def create_role(
        self,
        name: str,
        assume_role_policy: Union[dict, str],
        path: Optional[str] = None,
        max_session_duration: Optional[int] = None,
        tags: Optional[list[IAMTag]] = None,
    ) -> IAMRole:
        try:
            document = json.dumps(assume_role_policy) if isinstance(assume_role_policy, dict) else assume_role_policy
            kwargs: dict = {"RoleName": name, "AssumeRolePolicyDocument": document}
            if path:
                kwargs["Path"] = path
            if max_session_duration is not None:
                kwargs["MaxSessionDuration"] = max_session_duration
            if tags:
                kwargs["Tags"] = [{"Key": tag.key, "Value": tag.value} for tag in tags]
            resp = self.client.create_role(**kwargs)
            r = resp.get("Role", {})
            return IAMRole(
                name=_role_name_from_data(r, fallback=name) or name,
                arn=r.get("Arn"),
                path=r.get("Path"),
                max_session_duration=r.get("MaxSessionDuration") or max_session_duration or 3600,
                tags=tags,
            )
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to create IAM role: {exc}") from exc

    def get_role(self, name: str) -> Optional[IAMRole]:
        try:
            resp = self.client.get_role(RoleName=name)
            data = resp.get("Role", {}) or {}
            attached = list_iam_all(
                self.client,
                "list_attached_role_policies", "AttachedPolicies", RoleName=name
            )
            policy_arns = [p.get("PolicyArn") for p in attached if p.get("PolicyArn")]
            assume_doc = self._normalize_policy_document(data.get("AssumeRolePolicyDocument"))
            tags = self.list_role_tags(name)
            return IAMRole(
                name=_role_name_from_data(data, fallback=name) or name,
                arn=data.get("Arn"),
                path=data.get("Path"),
                policies=policy_arns,
                assume_role_policy_document=assume_doc,
                max_session_duration=data.get("MaxSessionDuration") or 3600,
                tags=tags,
            )
        except ClientError as exc:
            if _is_no_such_entity(exc):
                return None
            raise RuntimeError(f"Unable to fetch IAM role: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch IAM role: {exc}") from exc

    def delete_role(self, name: str) -> None:
        self._call_tolerating_missing_entity(
            "delete_role",
            error_message="Unable to delete IAM role",
            RoleName=name,
        )

    def update_role_assume_policy(self, role_name: str, assume_role_policy: Union[dict, str]) -> None:
        try:
            document = json.dumps(assume_role_policy) if isinstance(assume_role_policy, dict) else assume_role_policy
            self.client.update_assume_role_policy(RoleName=role_name, PolicyDocument=document)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to update role trust policy: {exc}") from exc

    def update_role_max_session_duration(self, role_name: str, max_session_duration: int) -> None:
        try:
            self.client.update_role(RoleName=role_name, MaxSessionDuration=max_session_duration)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to update role maximum session duration: {exc}") from exc

    def list_role_tags(self, role_name: str) -> list[IAMTag]:
        try:
            tags = list_iam_all(self.client, "list_role_tags", "Tags", RoleName=role_name)
            return [
                IAMTag(key=tag.get("Key", ""), value=tag.get("Value", ""))
                for tag in tags
                if tag.get("Key")
            ]
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to list IAM role tags: {exc}") from exc

    def tag_role(self, role_name: str, tags: list[IAMTag]) -> None:
        try:
            self.client.tag_role(
                RoleName=role_name,
                Tags=[{"Key": tag.key, "Value": tag.value} for tag in tags],
            )
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Unable to tag IAM role: {exc}") from exc

    def untag_role(self, role_name: str, tag_keys: list[str]) -> None:
        self._call_tolerating_missing_entity(
            "untag_role",
            error_message="Unable to remove IAM role tags",
            RoleName=role_name,
            TagKeys=tag_keys,
        )

    # Policies
    def _policy_from_data(self, data: dict, document: Optional[dict] = None) -> Policy:
        return Policy(
            name=data.get("PolicyName") or data.get("name"),
            arn=data.get("Arn") or data.get("PolicyArn") or data.get("arn"),
            path=data.get("Path"),
            default_version_id=data.get("DefaultVersionId"),
            document=document,
        )

    def list_policies(self) -> List[Policy]:
        try:
            policies = list_iam_all(self.client, "list_policies", "Policies", Scope="Local")
            return [self._policy_from_data(p) for p in policies]
        except (BotoCoreError, ClientError):
            # Ceph RGW Squid/Quincy may not implement ListPolicies; fall back to known managed set
            return self._default_policies.copy()

    def list_policies_page(
        self,
        *,
        marker: str | None = None,
        max_items: int = 25,
        search: str | None = None,
    ) -> tuple[list[Policy], str | None]:
        try:
            rows, next_marker = list_iam_page(
                self.client,
                "list_policies",
                "Policies",
                marker=marker,
                max_items=max_items,
                search=search,
                matcher=lambda row, needle: iam_matches_fields(row, needle, "PolicyName", "Arn", "Path"),
                Scope="Local",
            )
            return [self._policy_from_data(row) for row in rows], next_marker
        except (BotoCoreError, ClientError):
            needle = (search or "").strip().lower()
            policies = [
                policy
                for policy in self._default_policies
                if not needle or needle in policy.name.lower() or needle in policy.arn.lower()
            ]
            return policies[:max_items], None

    def get_policy(self, policy_arn: str, include_document: bool = False) -> Optional[Policy]:
        try:
            resp = self.client.get_policy(PolicyArn=policy_arn)
            policy_data = resp.get("Policy", {}) or {}
            document = None
            if include_document and policy_data.get("DefaultVersionId"):
                try:
                    version_resp = self.client.get_policy_version(
                        PolicyArn=policy_arn, VersionId=policy_data["DefaultVersionId"]
                    )
                    document = version_resp.get("PolicyVersion", {}).get("Document")
                except (BotoCoreError, ClientError):
                    document = None
            return self._policy_from_data(policy_data, document=document)
        except ClientError as exc:
            if _is_no_such_entity(exc):
                # Try to resolve from the static set
                return next((p for p in self._default_policies if p.arn == policy_arn), None)
            # Unsupported endpoint — fall back to static if available
            if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 405:
                return next((p for p in self._default_policies if p.arn == policy_arn), None)
            raise RuntimeError(f"Unable to fetch IAM policy: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to fetch IAM policy: {exc}") from exc

    def create_policy(self, name: str, document: dict) -> Policy:
        try:
            resp = self.client.create_policy(PolicyName=name, PolicyDocument=json.dumps(document))
        except ClientError as exc:
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") if hasattr(exc, "response") else None
            if status == 405 or aws_error_code(exc) in {"NotImplemented", "MethodNotAllowed"}:
                raise ValueError("IAM CreatePolicy is not supported by this endpoint") from exc
            raise RuntimeError(f"Unable to create IAM policy: {exc}") from exc
        except BotoCoreError as exc:
            raise RuntimeError(f"Unable to create IAM policy: {exc}") from exc
        return self._policy_from_data(resp.get("Policy", {}), document=document)

    def delete_policy(self, policy_arn: str) -> None:
        self._call_tolerating_missing_entity(
            "delete_policy",
            error_message="Unable to delete IAM policy",
            PolicyArn=policy_arn,
        )

    def list_role_policies(self, role_name: str) -> List[Policy]:
        return self._list_attached_policies("role", role_name)

    def list_role_inline_policies(self, role_name: str) -> list[str]:
        return self._list_inline_policies("role", role_name)

    def get_role_inline_policy(self, role_name: str, policy_name: str) -> Optional[dict]:
        return self._get_inline_policy("role", role_name, policy_name)

    def put_role_inline_policy(self, role_name: str, policy_name: str, policy_document: Union[dict, str]) -> None:
        self._put_inline_policy("role", role_name, policy_name, policy_document)

    def delete_role_inline_policy(self, role_name: str, policy_name: str) -> None:
        self._delete_inline_policy("role", role_name, policy_name)

    def attach_role_policy(self, role_name: str, policy_arn: str) -> None:
        self._attach_policy("role", role_name, policy_arn)

    def detach_role_policy(self, role_name: str, policy_arn: str) -> None:
        self._detach_policy("role", role_name, policy_arn)

    def _normalize_policy_document(self, document: Optional[Union[str, dict]]) -> Optional[dict]:
        if document is None:
            return None
        if isinstance(document, dict):
            return document
        try:
            return json.loads(document)
        except (TypeError, json.JSONDecodeError):
            return None


def get_iam_service(
    access_key: str,
    secret_key: str,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
) -> RGWIAMService:
    return RGWIAMService(access_key, secret_key, endpoint=endpoint, region=region, verify_tls=verify_tls)


def get_iam_service_for_execution_target(
    context: S3ExecutionTarget,
) -> RGWIAMService | None:
    access_key, secret_key = context.effective_rgw_credentials()
    if not access_key or not secret_key:
        return None
    endpoint, region, verify_tls = resolve_iam_client_options(context)
    return get_iam_service(
        access_key,
        secret_key,
        endpoint=endpoint,
        region=region,
        verify_tls=verify_tls,
    )
