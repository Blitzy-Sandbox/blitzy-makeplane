# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django database router for read-replica routing.

Defines ``ReadReplicaRouter``, the single router registered in
``DATABASE_ROUTERS`` (see ``plane.settings.common``) when
``ENABLE_READ_REPLICA=1`` and a replica connection
(``DATABASE_READ_REPLICA_URL`` or the discrete
``POSTGRES_READ_REPLICA_*`` variables) is configured. The router
consults the request-scoped flag managed by
``plane.utils.core.request_scope`` -- which is set by the companion
``plane.middleware.db_routing.ReadReplicaRoutingMiddleware`` for
read-only HTTP methods on views opted in via
``ReadReplicaControlMixin`` -- and routes reads to ``"replica"``
only when that flag is true.

Writes always target ``"default"`` and migrations are permitted
only on ``"default"`` to match the migrator container's startup
contract, which runs every schema migration against the primary
database before API services come up.
"""

import logging
from typing import Type

from django.db import models

from .request_scope import should_use_read_replica

logger = logging.getLogger("plane.db")


class ReadReplicaRouter:
    """Route ORM reads to the replica when the request has opted in.

    Stateless Django router used in ``DATABASE_ROUTERS``; carries
    no per-instance configuration and depends entirely on its
    method inputs plus the request-scoped flag set by
    ``plane.middleware.db_routing.ReadReplicaRoutingMiddleware``.
    Outside the HTTP request cycle (Celery tasks, management
    commands, signal handlers running outside a view) the flag is
    unset, so every read, every write, and every migration
    resolves to ``"default"``.

    Routing rules:
        * ``db_for_read`` -- returns ``"replica"`` when
          ``should_use_read_replica()`` is true, otherwise
          ``"default"``.
        * ``db_for_write`` -- always returns ``"default"`` so
          writes never hit the read-only replica.
        * ``allow_migrate`` -- permits migrations only on
          ``"default"`` to preserve the migrator container's
          primary-only schema-management contract.
    """

    def db_for_read(self, model: Type[models.Model], **hints) -> str:
        """Return ``"replica"`` when the request has opted into the replica.

        Falls back to ``"default"`` whenever the request-scoped
        flag is unset, which keeps non-HTTP execution paths
        (Celery tasks, management commands, signal handlers fired
        outside the request cycle) on the primary database.

        Args:
            model: The Django model class being queried; used only
                for logging the routing decision.
            **hints: Additional routing hints supplied by Django;
                unused.

        Returns:
            ``"replica"`` if ``should_use_read_replica()`` is
            true, otherwise ``"default"``.
        """
        if should_use_read_replica():
            logger.debug(f"Routing read for {model._meta.label} to replica database")
            return "replica"
        else:
            logger.debug(f"Routing read for {model._meta.label} to primary database")
            return "default"

    def db_for_write(self, model: Type[models.Model], **hints) -> str:
        """Route all writes to the primary ``"default"`` database.

        Replicas are read-only; routing writes to them would
        either fail or silently diverge from the primary, so this
        method intentionally ignores the request-scoped flag.

        Args:
            model: The Django model class being written; used only
                for logging.
            **hints: Additional routing hints supplied by Django;
                unused.

        Returns:
            The string ``"default"`` for every model.
        """
        logger.debug(f"Routing write for {model._meta.label} to primary database")
        return "default"

    def allow_migrate(self, db: str, app_label: str, model_name: str = None, **hints) -> bool:
        """Allow migrations only on the primary ``default`` database.

        The migrator container runs every Django migration against
        ``default`` before API services start; blocking migrations
        on any other alias prevents accidental schema drift on the
        replica, which is fed by Postgres streaming replication
        and must mirror ``default`` byte-for-byte.

        Args:
            db: The database alias Django is considering for the
                migration.
            app_label: The Django app label whose migration is
                being evaluated.
            model_name: Optional model name (kept for the standard
                router signature).
            **hints: Additional routing hints supplied by Django;
                unused.

        Returns:
            ``True`` if ``db == "default"``, otherwise ``False``.
        """
        # Only allow migrations on the primary database
        allowed = db == "default"
        if not allowed:
            logger.debug(f"Blocking migration for {app_label} on {db} database")
        return allowed
