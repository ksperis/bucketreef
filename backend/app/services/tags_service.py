# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional, Sequence

from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session

from app.db import BucketUiTagAssignment, S3Account, S3AccountTag, S3Connection, S3ConnectionTag, S3User, S3UserTag, StorageEndpoint, StorageEndpointTag, TagDefinition
from app.models.tagging import TagDefinitionSummary
from app.utils.tagging import (
    DEFAULT_TAG_COLOR_KEY,
    TAG_DOMAIN_ADMIN_MANAGED,
    TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
    TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
    TAG_DOMAIN_ENDPOINT,
    TAG_DOMAIN_PRIVATE_CONNECTION_USER,
    TAG_SCOPE_STANDARD,
    build_tag_label_key,
    normalize_tag_items_input,
    tag_definition_sort_key,
)


TaggableParent = StorageEndpoint | S3Account | S3User | S3Connection
TagLink = StorageEndpointTag | S3AccountTag | S3UserTag | S3ConnectionTag
TagLinkClass = (
    type[StorageEndpointTag]
    | type[S3AccountTag]
    | type[S3UserTag]
    | type[S3ConnectionTag]
)


class TagsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_definitions(self, *, domain_kind: str, owner_user_id: Optional[int] = None) -> list[TagDefinitionSummary]:
        statement = select(TagDefinition).where(TagDefinition.domain_kind == domain_kind)
        if owner_user_id is None:
            statement = statement.where(TagDefinition.owner_user_id.is_(None))
        else:
            statement = statement.where(TagDefinition.owner_user_id == owner_user_id)
        rows = self.db.scalars(statement).all()
        rows.sort(key=tag_definition_sort_key)
        return [self._to_summary(row) for row in rows]

    @staticmethod
    def filter_selector_visible(items: Sequence[TagDefinitionSummary] | None) -> list[TagDefinitionSummary]:
        return [item for item in (items or []) if item.scope == TAG_SCOPE_STANDARD]

    def resolve_connection_domain(self, connection: S3Connection) -> tuple[str, Optional[int]]:
        if bool(connection.is_shared):
            return (TAG_DOMAIN_ADMIN_MANAGED, None)
        return (TAG_DOMAIN_PRIVATE_CONNECTION_USER, int(connection.created_by_user_id))

    def get_storage_endpoint_tags(self, endpoint: StorageEndpoint) -> list[TagDefinitionSummary]:
        return self._serialize_for_parent(endpoint)

    def get_account_tags(self, account: S3Account) -> list[TagDefinitionSummary]:
        return self._serialize_for_parent(account)

    def get_s3_user_tags(self, s3_user: S3User) -> list[TagDefinitionSummary]:
        return self._serialize_for_parent(s3_user)

    def get_connection_tags(self, connection: S3Connection) -> list[TagDefinitionSummary]:
        return self._serialize_for_parent(connection)

    def replace_storage_endpoint_tags(self, endpoint: StorageEndpoint, tags: object) -> list[TagDefinitionSummary]:
        return self._replace_for_parent(
            endpoint,
            link_cls=StorageEndpointTag,
            domain_kind=TAG_DOMAIN_ENDPOINT,
            owner_user_id=None,
            tags=tags,
        )

    def replace_account_tags(self, account: S3Account, tags: object) -> list[TagDefinitionSummary]:
        return self._replace_for_parent(
            account,
            link_cls=S3AccountTag,
            domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
            owner_user_id=None,
            tags=tags,
        )

    def replace_s3_user_tags(self, s3_user: S3User, tags: object) -> list[TagDefinitionSummary]:
        return self._replace_for_parent(
            s3_user,
            link_cls=S3UserTag,
            domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
            owner_user_id=None,
            tags=tags,
        )

    def replace_connection_tags(self, connection: S3Connection, tags: object) -> list[TagDefinitionSummary]:
        domain_kind, owner_user_id = self.resolve_connection_domain(connection)
        return self._replace_for_parent(
            connection,
            link_cls=S3ConnectionTag,
            domain_kind=domain_kind,
            owner_user_id=owner_user_id,
            tags=tags,
        )

    def cleanup_orphan_definitions(self, *, domain_kinds: Sequence[str]) -> None:
        """Delete unused definitions without probing unrelated assignment tables."""

        supported = {
            TAG_DOMAIN_ENDPOINT,
            TAG_DOMAIN_ADMIN_MANAGED,
            TAG_DOMAIN_PRIVATE_CONNECTION_USER,
            TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
            TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
        }
        requested = list(dict.fromkeys(str(item) for item in domain_kinds))
        unsupported = set(requested) - supported
        if unsupported:
            raise ValueError(f"Unsupported tag definition domains: {sorted(unsupported)}")

        for domain_kind in requested:
            statement = select(TagDefinition.id).where(
                TagDefinition.domain_kind == domain_kind
            )
            if domain_kind == TAG_DOMAIN_ENDPOINT:
                statement = statement.where(
                    ~exists().where(
                        StorageEndpointTag.tag_definition_id == TagDefinition.id
                    )
                )
            elif domain_kind == TAG_DOMAIN_ADMIN_MANAGED:
                statement = statement.where(
                    ~exists().where(S3AccountTag.tag_definition_id == TagDefinition.id),
                    ~exists().where(S3UserTag.tag_definition_id == TagDefinition.id),
                    ~exists().where(
                        S3ConnectionTag.tag_definition_id == TagDefinition.id
                    ),
                )
            elif domain_kind == TAG_DOMAIN_PRIVATE_CONNECTION_USER:
                statement = statement.where(
                    ~exists().where(
                        S3ConnectionTag.tag_definition_id == TagDefinition.id
                    )
                )
            else:
                statement = statement.where(
                    ~exists().where(
                        BucketUiTagAssignment.tag_definition_id == TagDefinition.id
                    )
                )
            orphan_ids = [int(tag_id) for tag_id in self.db.scalars(statement).all()]
            if orphan_ids:
                self.db.execute(
                    delete(TagDefinition)
                    .where(TagDefinition.id.in_(orphan_ids))
                    .execution_options(synchronize_session="fetch")
                )

    def _serialize_for_parent(
        self,
        parent: TaggableParent,
    ) -> list[TagDefinitionSummary]:
        links = sorted(
            list(parent.tag_links),
            key=lambda item: (int(item.position), int(item.id or 0)),
        )
        return [
            self._to_summary(link.tag_definition)
            for link in links
            if link.tag_definition is not None
        ]

    def _replace_for_parent(
        self,
        parent: TaggableParent,
        *,
        link_cls: TagLinkClass,
        domain_kind: str,
        owner_user_id: Optional[int],
        tags: object,
    ) -> list[TagDefinitionSummary]:
        normalized = normalize_tag_items_input(tags, allow_none=False) or []
        definitions = [
            self.resolve_definition(
                domain_kind=domain_kind,
                owner_user_id=owner_user_id,
                label=item["label"],
                color_key=item["color_key"],
                scope=item["scope"],
            )
            for item in normalized
        ]
        existing_links = list(parent.tag_links)
        existing_by_tag_id = {
            int(link.tag_definition_id): link
            for link in existing_links
        }
        next_links: list[TagLink] = []
        for position, definition in enumerate(definitions):
            link = existing_by_tag_id.get(definition.id)
            if link is None:
                link = link_cls(tag_definition_id=definition.id, position=position)
            link.tag_definition = definition
            link.position = position
            next_links.append(link)
        parent.tag_links = next_links
        self.db.add(parent)
        self.db.flush()
        self.cleanup_orphan_definitions(domain_kinds=[domain_kind])
        return [self._to_summary(definition) for definition in definitions]

    def resolve_definition(
        self,
        *,
        domain_kind: str,
        owner_user_id: Optional[int],
        label: str,
        color_key: str,
        scope: str,
        update_existing: bool = True,
    ) -> TagDefinition:
        label_key = build_tag_label_key(label)
        statement = select(TagDefinition).where(
                TagDefinition.domain_kind == domain_kind,
                TagDefinition.label_key == label_key,
        )
        if owner_user_id is None:
            statement = statement.where(TagDefinition.owner_user_id.is_(None))
        else:
            statement = statement.where(TagDefinition.owner_user_id == owner_user_id)
        definition = self.db.scalars(statement).first()
        if definition is None:
            definition = TagDefinition(
                domain_kind=domain_kind,
                owner_user_id=owner_user_id,
                label=label,
                label_key=label_key,
                color_key=color_key,
                scope=scope,
            )
            self.db.add(definition)
            self.db.flush()
            return definition
        if update_existing:
            definition.label = label
            definition.color_key = color_key
            definition.scope = scope
            self.db.add(definition)
            self.db.flush()
        return definition

    @staticmethod
    def _to_summary(definition: TagDefinition) -> TagDefinitionSummary:
        return TagDefinitionSummary(
            id=definition.id,
            label=definition.label,
            color_key=definition.color_key,
            scope=definition.scope,
        )


def serialize_tag_summaries(items: Optional[Sequence[TagDefinitionSummary]]) -> list[dict[str, object]]:
    return [item.model_dump() for item in (items or [])]
