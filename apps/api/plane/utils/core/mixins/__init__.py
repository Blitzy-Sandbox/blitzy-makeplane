# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Reusable DRF mixins for the read-replica routing surface.

Exposes ``ReadReplicaControlMixin`` -- a one-attribute mixin
(``use_read_replica: bool = True``) that DRF view base classes
(``plane.app.views.base.BaseViewSet`` / ``BaseAPIView`` and
``plane.api.views.base.BaseViewSet`` / ``BaseAPIView``) inherit
from so ``plane.middleware.db_routing.ReadReplicaRoutingMiddleware``
can detect the per-view replica policy via ``getattr`` on
``view_func.view_class`` (Django CBV) or ``view_func.cls`` (DRF).
The mixin only declares the attribute; the actual routing decision
is made by the middleware and the ``ReadReplicaRouter``.
"""

from .view import ReadReplicaControlMixin

__all__ = [
    "ReadReplicaControlMixin",
]
