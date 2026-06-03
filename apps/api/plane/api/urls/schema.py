# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for the external ``/api/v1/`` drf-spectacular schema, Swagger UI, and Redoc views.

Defines the same three spectacular endpoints (``schema/``,
``schema/swagger-ui/``, ``schema/redoc/``) that ``apps/api/plane/urls.py``
already mounts globally at ``api/schema/...`` when
``ENABLE_DRF_SPECTACULAR=1``; the ``urlpatterns`` list here is not
aggregated by ``plane.api.urls.__init__`` and does not contribute to the
runtime URL tree.
"""

# INTENT UNCLEAR: schema.urlpatterns duplicates the top-level spectacular
# routes in apps/api/plane/urls.py (L26-L39) and is not spread into the
# package aggregator; retained as-is per the no-refactoring system boundary.

from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from django.urls import path

urlpatterns = [
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "schema/swagger-ui/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path(
        "schema/redoc/",
        SpectacularRedocView.as_view(url_name="schema"),
        name="redoc",
    ),
]
