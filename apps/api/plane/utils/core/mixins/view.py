# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF view mixin that declares per-view read-replica routing policy."""


class ReadReplicaControlMixin:
    """Declare whether the mixed-in DRF view may serve reads from the replica.

    Mix into a DRF ``ViewSet`` or ``APIView`` and (optionally)
    override ``use_read_replica`` to opt the view out of replica
    routing. ``plane.middleware.db_routing.ReadReplicaRoutingMiddleware``
    reads the attribute via ``getattr(view_func.view_class, ...)``
    (Django CBV) or ``getattr(view_func.cls, ...)`` (DRF wrappers)
    during ``process_view`` and calls ``set_use_read_replica(True)``
    only when (a) the HTTP method is one of ``GET`` / ``HEAD`` /
    ``OPTIONS`` and (b) ``use_read_replica`` resolves to truthy.

    Writes always target the primary database regardless of the
    attribute's value; the mixin is purely a read-side policy
    declaration.

    Attributes:
        use_read_replica: ``True`` (default) makes read-only HTTP
            methods on this view eligible for the read replica;
            set to ``False`` on subclasses whose reads must always
            hit the primary (e.g., views that immediately re-read
            just-written data and cannot tolerate replication lag).
    """

    use_read_replica: bool = True
