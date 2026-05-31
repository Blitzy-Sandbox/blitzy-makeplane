# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routing for personal API token endpoints.

Maps the ``ApiTokenEndpoint`` from ``plane.app.views`` to the
``users/api-tokens/`` collection and detail routes used by the
web client to manage per-user personal-access tokens.
"""

from django.urls import path
from plane.app.views import ApiTokenEndpoint

urlpatterns = [
    # API Tokens
    path(
        "users/api-tokens/",
        ApiTokenEndpoint.as_view(),
        name="api-tokens",
    ),
    path(
        "users/api-tokens/<uuid:pk>/",
        ApiTokenEndpoint.as_view(),
        name="api-tokens-details",
    ),
    ## End API Tokens
]
