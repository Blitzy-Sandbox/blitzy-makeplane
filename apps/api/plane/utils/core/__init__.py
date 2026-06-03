# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Foundational primitives for read-replica database routing.

This package centralizes Plane's request-scoped database routing
primitives. It re-exports ``ReadReplicaRouter`` (registered in
``DATABASE_ROUTERS`` from ``plane.settings.common``),
``ReadReplicaControlMixin`` (mixed into the DRF view base classes
in ``plane.app.views.base`` and ``plane.api.views.base``), and the
request-scoped helpers ``set_use_read_replica``,
``should_use_read_replica``, and ``clear_read_replica_context`` used
by ``plane.middleware.db_routing.ReadReplicaRoutingMiddleware`` to
pin per-request routing state onto an ``asgiref.local.Local`` carrier.

Replica routing is gated on ``ENABLE_READ_REPLICA=1`` plus a
configured replica connection (``DATABASE_READ_REPLICA_URL`` or the
discrete ``POSTGRES_READ_REPLICA_*`` variables); when disabled the
router and middleware are never registered and every connection
resolves to ``default``. The migrator container always migrates
``default`` before API services start, and the router enforces this
by blocking migrations on every non-default alias.
"""

from .dbrouters import ReadReplicaRouter
from .mixins import ReadReplicaControlMixin
from .request_scope import (
    set_use_read_replica,
    should_use_read_replica,
    clear_read_replica_context,
)

__all__ = [
    "ReadReplicaRouter",
    "ReadReplicaControlMixin",
    "set_use_read_replica",
    "should_use_read_replica",
    "clear_read_replica_context",
]
