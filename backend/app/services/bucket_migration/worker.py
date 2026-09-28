# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import os
import socket
import threading
import uuid
from contextlib import contextmanager
from typing import Optional

from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.services.bucket_migration_service import BucketMigrationService

logger = logging.getLogger(__name__)
settings = get_settings()


class BucketMigrationWorker:
    def __init__(
        self,
        session_factory: sessionmaker,
        *,
        poll_interval_seconds: float,
        lease_seconds: int,
    ) -> None:
        self._session_factory = session_factory
        self._poll_interval_seconds = max(0.2, float(poll_interval_seconds))
        self._lease_seconds = max(15, int(lease_seconds))
        self._worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
        self._thread: Optional[threading.Thread] = None
        self._preparation_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._lock = threading.Lock()

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._wake_event.clear()
            self._thread = threading.Thread(
                target=self._run_loop,
                name="bucket-migration-worker",
                daemon=True,
            )
            self._thread.start()
            self._preparation_thread = threading.Thread(
                target=self._run_preparation_loop,
                name="bucket-migration-preparation",
                daemon=True,
            )
            self._preparation_thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        with self._lock:
            self._stop_event.set()
            self._wake_event.set()
            thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=timeout)
        if self._preparation_thread and self._preparation_thread.is_alive():
            self._preparation_thread.join(timeout=timeout)

    def wake_up(self) -> None:
        self._wake_event.set()

    @contextmanager
    def _heartbeat(self, migration_id: int, worker_id: str):
        stopped = threading.Event()

        def renew():
            while not stopped.wait(max(2, self._lease_seconds // 3)):
                try:
                    with self._session_factory() as db:
                        if not BucketMigrationService(db)._renew_migration_lease(
                            migration_id,
                            worker_id=worker_id,
                            lease_seconds=self._lease_seconds,
                        ):
                            return
                except Exception:
                    logger.exception("Migration lease heartbeat failed")

        pulse = threading.Thread(target=renew, name="migration-lease", daemon=True)
        pulse.start()
        try:
            yield
        finally:
            stopped.set()
            pulse.join(timeout=2)

    def _run_preparation_loop(self) -> None:
        worker_id = f"{self._worker_id}:preparation"
        while not self._stop_event.is_set():
            try:
                with self._session_factory() as db:
                    service = BucketMigrationService(db)
                    migration_id = service.claim_next_preparation_id(
                        worker_id=worker_id, lease_seconds=self._lease_seconds
                    )
                if migration_id is not None:
                    with self._heartbeat(
                        migration_id, worker_id
                    ), self._session_factory() as db:
                        BucketMigrationService(db).run_precheck(
                            migration_id, worker_id=worker_id
                        )
            except Exception:
                logger.exception("Bucket migration preparation worker iteration failed")
            self._stop_event.wait(self._poll_interval_seconds)

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            processed = False
            try:
                migration_id: Optional[int] = None
                with self._session_factory() as db:
                    service = BucketMigrationService(db)
                    migration_id = service.claim_next_runnable_migration_id(
                        worker_id=self._worker_id,
                        lease_seconds=self._lease_seconds,
                    )
                if migration_id is not None:
                    processed = True
                    try:
                        with self._heartbeat(
                            migration_id, self._worker_id
                        ), self._session_factory() as db:
                            service = BucketMigrationService(db)
                            service.run_migration(
                                migration_id,
                                worker_id=self._worker_id,
                                lease_seconds=self._lease_seconds,
                            )
                    except Exception as exc:  # noqa: BLE001
                        logger.exception(
                            "Bucket migration worker failed while processing migration %s",
                            migration_id,
                        )
                        with self._session_factory() as db:
                            service = BucketMigrationService(db)
                            service.fail_migration_fatal(
                                migration_id,
                                error=exc,
                                worker_id=self._worker_id,
                            )
            except Exception:  # noqa: BLE001
                logger.exception("Bucket migration worker iteration failed")
            finally:
                wait_seconds = 0.05 if processed else self._poll_interval_seconds
                self._wake_event.wait(timeout=wait_seconds)
                self._wake_event.clear()


_worker_singleton: Optional[BucketMigrationWorker] = None
_worker_lock = threading.Lock()


def reset_bucket_migration_worker_for_tests(*, timeout: float = 0.5) -> None:
    global _worker_singleton
    with _worker_lock:
        worker = _worker_singleton
        _worker_singleton = None
    if worker is not None:
        worker.stop(timeout=timeout)


def get_bucket_migration_worker(session_factory: sessionmaker) -> BucketMigrationWorker:
    global _worker_singleton
    with _worker_lock:
        if _worker_singleton is None:
            _worker_singleton = BucketMigrationWorker(
                session_factory,
                poll_interval_seconds=settings.bucket_migration_poll_interval_seconds,
                lease_seconds=settings.bucket_migration_worker_lease_seconds,
            )
        return _worker_singleton
