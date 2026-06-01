# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL patterns for anchor-scoped asset operations on public space boards.

Declares routes under the versioned ``assets/v2/anchor/<str:anchor>/``
namespace that expose published deploy-board asset operations
(retrieve, restore, and bulk reassignment) to anonymous visitors:

- ``entity-asset`` (collection) -- ``assets/v2/anchor/<str:anchor>/`` bound
  to ``EntityAssetEndpoint.as_view()``.
- ``entity-asset`` (detail) -- ``assets/v2/anchor/<str:anchor>/<uuid:pk>/``
  bound to ``EntityAssetEndpoint.as_view()``.
- ``asset-restore`` -- ``assets/v2/anchor/<str:anchor>/restore/<uuid:pk>/``
  bound to ``AssetRestoreEndpoint.as_view()``.
- ``entity-bulk-asset`` -- ``assets/v2/anchor/<str:anchor>/<uuid:entity_id>/bulk/``
  bound to ``EntityBulkAssetEndpoint.as_view()``.

These patterns belong to the anonymous public read surface aggregated by
``plane.space.urls`` and mounted under ``api/public/``.
"""

# Django imports
from django.urls import path

# Module imports
from plane.space.views import (
    EntityAssetEndpoint,
    AssetRestoreEndpoint,
    EntityBulkAssetEndpoint,
)

urlpatterns = [
    path(
        "assets/v2/anchor/<str:anchor>/",
        EntityAssetEndpoint.as_view(),
        name="entity-asset",
    ),
    path(
        "assets/v2/anchor/<str:anchor>/<uuid:pk>/",
        EntityAssetEndpoint.as_view(),
        name="entity-asset",
    ),
    path(
        "assets/v2/anchor/<str:anchor>/restore/<uuid:pk>/",
        AssetRestoreEndpoint.as_view(),
        name="asset-restore",
    ),
    path(
        "assets/v2/anchor/<str:anchor>/<uuid:entity_id>/bulk/",
        EntityBulkAssetEndpoint.as_view(),
        name="entity-bulk-asset",
    ),
]
