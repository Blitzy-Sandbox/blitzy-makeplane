# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Root URL configuration for the Plane Django backend.

Mounts the major app namespaces under their canonical prefixes:
  - ``api/``           → ``plane.app.urls``        (DRF web-client API surface)
  - ``api/public/``    → ``plane.space.urls``      (public space / anonymous read views)
  - ``api/instances/`` → ``plane.license.urls``    (instance/license configuration)
  - ``api/v1/``        → ``plane.api.urls``        (external API-key REST surface)
  - ``auth/``          → ``plane.authentication.urls`` (login, signup, OAuth, magic-link)
  - ``""`` (root)      → ``plane.web.urls``        (health and web-facing endpoints)

The ``handler404`` is bound to ``plane.app.views.error_404.custom_404_view``.

DRF Spectacular schema, Swagger UI, and ReDoc endpoints are appended only when
``settings.ENABLE_DRF_SPECTACULAR`` is truthy (gated by the ``ENABLE_DRF_SPECTACULAR``
environment flag). Django Debug Toolbar is mounted under ``^__debug__/`` only when
``settings.DEBUG`` is ``True`` and ``debug_toolbar`` can be imported.
"""

from django.conf import settings
from django.urls import include, path, re_path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

handler404 = "plane.app.views.error_404.custom_404_view"

urlpatterns = [
    path("api/", include("plane.app.urls")),
    path("api/public/", include("plane.space.urls")),
    path("api/instances/", include("plane.license.urls")),
    path("api/v1/", include("plane.api.urls")),
    path("auth/", include("plane.authentication.urls")),
    path("", include("plane.web.urls")),
]

if settings.ENABLE_DRF_SPECTACULAR:
    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path(
            "api/schema/swagger-ui/",
            SpectacularSwaggerView.as_view(url_name="schema"),
            name="swagger-ui",
        ),
        path(
            "api/schema/redoc/",
            SpectacularRedocView.as_view(url_name="schema"),
            name="redoc",
        ),
    ]

if settings.DEBUG:
    try:
        import debug_toolbar

        urlpatterns = [re_path(r"^__debug__/", include(debug_toolbar.urls))] + urlpatterns
    except ImportError:
        pass
