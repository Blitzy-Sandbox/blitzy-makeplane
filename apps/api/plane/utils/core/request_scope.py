# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Request-scoped flag for read-replica database routing.

Stores a per-request boolean indicating whether the active HTTP
request may serve its reads from the read replica. The flag is
written by ``plane.middleware.db_routing.ReadReplicaRoutingMiddleware``
during ``process_view`` and read by
``plane.utils.core.dbrouters.ReadReplicaRouter.db_for_read`` for
every ORM read; the middleware also clears the flag in a
``finally`` block to prevent leakage between requests on a reused
worker thread or task.

Backing storage is an ``asgiref.local.Local`` instance, which is
backed by a ``ContextVar`` and therefore isolates state across
concurrent async tasks as well as threads. Code paths that run
outside an HTTP request (Celery workers, management commands,
signal handlers fired outside the request cycle) never set the
flag and therefore always observe ``False``, which keeps every
read on the primary database.
"""

from asgiref.local import Local

__all__ = [
    "set_use_read_replica",
    "should_use_read_replica",
    "clear_read_replica_context",
]

# Request-scoped context storage for database routing preferences
# Uses asgiref.local.Local which provides ContextVar under the hood
# This ensures proper context isolation per request in async environments
_db_routing_context = Local()


def set_use_read_replica(use_replica: bool) -> None:
    """Mark the current request as opting into (or out of) the read replica.

    Called by ``ReadReplicaRoutingMiddleware`` before the view runs:
    ``True`` for read-only HTTP methods (``GET`` / ``HEAD`` /
    ``OPTIONS``) on views that mix in ``ReadReplicaControlMixin``
    with ``use_read_replica = True``, ``False`` for everything else.
    The value is stored on a request-scoped ``asgiref.local.Local``
    carrier, so concurrent requests on the same worker do not see
    one another's state.

    Args:
        use_replica: ``True`` to route subsequent ORM reads through
            the replica connection for this request, ``False`` to
            keep them on the primary.
    """
    _db_routing_context.use_read_replica = bool(use_replica)


def should_use_read_replica() -> bool:
    """Return the current request's read-replica routing flag.

    Consulted by ``ReadReplicaRouter.db_for_read`` on every ORM
    read. Returns ``False`` when the carrier has no attribute for
    the current context -- the case for any code path that runs
    outside an HTTP request (Celery tasks, management commands,
    signal handlers fired outside the request cycle) -- which
    keeps those reads on the primary database.

    Returns:
        ``True`` if the active request has been opted into the
        read replica, otherwise ``False``.
    """
    return getattr(_db_routing_context, "use_read_replica", False)


def clear_read_replica_context() -> None:
    """Drop the read-replica flag for the current request context.

    Called from ``ReadReplicaRoutingMiddleware`` in a ``finally``
    block (and again from ``process_exception``) so that one
    request's routing choice cannot leak to the next request
    handled by the same worker thread or task. Idempotent: a
    missing attribute on the carrier is swallowed silently.
    """
    try:
        delattr(_db_routing_context, "use_read_replica")
    except AttributeError:
        pass
