# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Collection
from typing import Generic, TypeVar

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.utils.time import utcnow


_PersistedProviderT = TypeVar("_PersistedProviderT")


class IdentityProviderAlreadyExistsError(Exception):
    """Raised when a persisted identity provider id is already used."""


class IdentityProviderManagedByEnvironmentError(Exception):
    """Raised when trying to mutate an environment-managed identity provider."""


class IdentityProviderNotFoundError(Exception):
    """Raised when a persisted identity provider cannot be found."""


class IdentityProviderRepository(Generic[_PersistedProviderT]):
    def __init__(
        self,
        db: Session,
        model: type[_PersistedProviderT],
        environment_provider_ids: Collection[str],
        provider_label: str,
    ) -> None:
        self.db = db
        self.model = model
        self.environment_provider_ids = environment_provider_ids
        self.provider_label = provider_label

    def list(self) -> list[_PersistedProviderT]:
        return list(
            self.db.scalars(
                select(self.model).order_by(self.model.provider_id.asc())
            ).all()
        )

    def create(
        self,
        provider_id: str,
        apply: Callable[[_PersistedProviderT], None],
    ) -> _PersistedProviderT:
        self._require_environment_mutable(provider_id)
        if self._get(provider_id) is not None:
            raise IdentityProviderAlreadyExistsError(f"{self.provider_label} provider already exists")

        provider = self.model(provider_id=provider_id)
        apply(provider)
        self.db.add(provider)
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise IdentityProviderAlreadyExistsError(f"{self.provider_label} provider already exists") from exc
        self.db.refresh(provider)
        return provider

    def update(
        self,
        provider_id: str,
        apply: Callable[[_PersistedProviderT], None],
    ) -> _PersistedProviderT:
        provider = self._get_mutable(provider_id)
        apply(provider)
        provider.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(provider)
        return provider

    def delete(self, provider_id: str) -> None:
        provider = self._get_mutable(provider_id)
        self.db.delete(provider)
        self.db.commit()

    def _get(self, provider_id: str) -> _PersistedProviderT | None:
        return self.db.scalar(
            select(self.model)
            .where(self.model.provider_id == provider_id)
            .limit(1)
        )

    def _get_mutable(self, provider_id: str) -> _PersistedProviderT:
        self._require_environment_mutable(provider_id)
        provider = self._get(provider_id)
        if provider is None:
            raise IdentityProviderNotFoundError(f"{self.provider_label} provider not found")
        return provider

    def _require_environment_mutable(self, provider_id: str) -> None:
        if provider_id in self.environment_provider_ids:
            raise IdentityProviderManagedByEnvironmentError(
                f"{self.provider_label} provider is managed by environment settings"
            )
