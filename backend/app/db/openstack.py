# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""OpenStack references are durable; delegated secrets belong to one UI session."""
from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Table, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.security import EncryptedString
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow
from .base import Base


cloud_endpoints = Table(
    "openstack_cloud_endpoints", Base.metadata,
    Column("cloud_id", Integer, ForeignKey("openstack_clouds.id", ondelete="CASCADE"), primary_key=True),
    Column("endpoint_id", Integer, ForeignKey("storage_endpoints.id", ondelete="CASCADE"), primary_key=True),
)
cloud_users = Table(
    "openstack_cloud_users", Base.metadata,
    Column("cloud_id", Integer, ForeignKey("openstack_clouds.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
)
cloud_groups = Table(
    "openstack_cloud_groups", Base.metadata,
    Column("cloud_id", Integer, ForeignKey("openstack_clouds.id", ondelete="CASCADE"), primary_key=True),
    Column("group_id", Integer, ForeignKey("ui_groups.id", ondelete="CASCADE"), primary_key=True),
)


def new_id() -> str:
    return str(uuid4())


class OpenStackCloud(Base):
    __tablename__ = "openstack_clouds"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    auth_url = Column(String, nullable=False)
    config_version = Column(Integer, nullable=False, default=1, server_default="1")
    enabled = Column(Boolean, nullable=False, default=False, server_default="0")
    allow_password = Column(Boolean, nullable=False, default=True, server_default="1")
    allow_token = Column(Boolean, nullable=False, default=True, server_default="1")
    default_domain = Column(String, nullable=True)
    all_users = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    endpoints = relationship("StorageEndpoint", secondary=cloud_endpoints)
    users = relationship("User", secondary=cloud_users)
    groups = relationship("UiGroup", secondary=cloud_groups)
    connections = relationship("OpenStackConnection", cascade="all, delete-orphan", back_populates="cloud")


class OpenStackConnection(Base):
    __tablename__ = "openstack_connections"
    __table_args__ = (UniqueConstraint("user_id", "cloud_id", "keystone_user_id", name="uq_openstack_connection_identity"),)
    id = Column(String, primary_key=True, default=new_id)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    cloud_id = Column(Integer, ForeignKey("openstack_clouds.id", ondelete="CASCADE"), nullable=False, index=True)
    keystone_user_id = Column(String, nullable=False)
    display_name = Column(String, nullable=False)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    cloud = relationship("OpenStackCloud", back_populates="connections")
    sessions = relationship("OpenStackSession", cascade="all, delete-orphan", back_populates="connection")
    contexts = relationship("OpenStackProjectContext", cascade="all, delete-orphan", back_populates="connection")


class OpenStackSession(Base):
    __tablename__ = "openstack_sessions"
    __table_args__ = (UniqueConstraint("connection_id", "auth_session_id", name="uq_openstack_ui_session"),)
    id = Column(String, primary_key=True, default=new_id)
    connection_id = Column(String, ForeignKey("openstack_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    auth_session_id = Column(String, ForeignKey("auth_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(EncryptedString, nullable=True)
    cloud_version = Column(Integer, nullable=False, default=1, server_default="1")
    expires_at = Column(UTCDateTime(), nullable=False)
    connection = relationship("OpenStackConnection", back_populates="sessions")
    credentials = relationship("OpenStackProjectCredential", cascade="all, delete-orphan", back_populates="session")


class OpenStackProjectContext(Base):
    __tablename__ = "openstack_project_contexts"
    __table_args__ = (UniqueConstraint("connection_id", "project_id", "endpoint_id", name="uq_openstack_project_endpoint"),)
    id = Column(String, primary_key=True, default=new_id)
    connection_id = Column(String, ForeignKey("openstack_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(String, nullable=False)
    project_name = Column(String, nullable=False)
    endpoint_id = Column(Integer, ForeignKey("storage_endpoints.id", ondelete="CASCADE"), nullable=False)
    connection = relationship("OpenStackConnection", back_populates="contexts")
    endpoint = relationship("StorageEndpoint")
    credentials = relationship("OpenStackProjectCredential", cascade="all, delete-orphan", back_populates="context")


class OpenStackProjectCredential(Base):
    __tablename__ = "openstack_project_credentials"
    __table_args__ = (UniqueConstraint("session_id", "context_id", name="uq_openstack_project_credential"),)
    id = Column(String, primary_key=True, default=new_id)
    session_id = Column(String, ForeignKey("openstack_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    context_id = Column(String, ForeignKey("openstack_project_contexts.id", ondelete="CASCADE"), nullable=False, index=True)
    access_key = Column(String, nullable=False)
    secret_key = Column(EncryptedString, nullable=True)
    validated_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    expires_at = Column(UTCDateTime(), nullable=False)
    can_manage_iam = Column(Boolean, nullable=False, default=False, server_default="0")
    session = relationship("OpenStackSession", back_populates="credentials")
    context = relationship("OpenStackProjectContext", back_populates="credentials")
