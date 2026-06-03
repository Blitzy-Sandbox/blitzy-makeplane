# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for the external ``/api/v1/`` intake (inbox/triage) surface.

Binds project-scoped intake-issue list/create and detail endpoints to the
view classes in ``plane.api.views`` (``IntakeIssueListCreateAPIEndpoint``,
``IntakeIssueDetailAPIEndpoint``); all routes inherit ``X-Api-Key``
authentication and ``ApiKeyRateThrottle`` throttling from ``BaseAPIView``.
"""

from django.urls import path

from plane.api.views import (
    IntakeIssueListCreateAPIEndpoint,
    IntakeIssueDetailAPIEndpoint,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/intake-issues/",
        IntakeIssueListCreateAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="intake-issue",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/intake-issues/<uuid:issue_id>/",
        IntakeIssueDetailAPIEndpoint.as_view(http_method_names=["get", "patch", "delete"]),
        name="intake-issue",
    ),
]
