# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL patterns for intake submissions on public space (deploy board) boards.

Declares anchor-scoped routes that bind ``IntakeIssuePublicViewSet`` action
maps and ``WorkspaceProjectDeployBoardEndpoint`` to the public intake
surface for anonymous deploy-board visitors:

- ``intake-issue`` (collection) -- ``anchor/<str:anchor>/intakes/<uuid:intake_id>/intake-issues/``
  via ``IntakeIssuePublicViewSet.as_view({"get": "list", "post": "create"})``.
- ``inbox-issue`` (collection alias) -- ``anchor/<str:anchor>/intakes/<uuid:intake_id>/inbox-issues/``
  via ``IntakeIssuePublicViewSet.as_view({"get": "list", "post": "create"})``.
- ``intake-issue`` (detail) -- ``anchor/<str:anchor>/intakes/<uuid:intake_id>/intake-issues/<uuid:pk>/``
  via ``IntakeIssuePublicViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"})``.
- ``workspace-project-boards`` -- ``workspaces/<str:slug>/project-boards/`` bound to
  ``WorkspaceProjectDeployBoardEndpoint.as_view()``.

These patterns belong to the anonymous public read surface aggregated by
``plane.space.urls`` and mounted under ``api/public/``.
"""

from django.urls import path


from plane.space.views import (
    IntakeIssuePublicViewSet,
    WorkspaceProjectDeployBoardEndpoint,
)


urlpatterns = [
    path(
        "anchor/<str:anchor>/intakes/<uuid:intake_id>/intake-issues/",
        IntakeIssuePublicViewSet.as_view({"get": "list", "post": "create"}),
        name="intake-issue",
    ),
    path(
        "anchor/<str:anchor>/intakes/<uuid:intake_id>/inbox-issues/",
        IntakeIssuePublicViewSet.as_view({"get": "list", "post": "create"}),
        name="inbox-issue",
    ),
    path(
        "anchor/<str:anchor>/intakes/<uuid:intake_id>/intake-issues/<uuid:pk>/",
        IntakeIssuePublicViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="intake-issue",
    ),
    path(
        "workspaces/<str:slug>/project-boards/",
        WorkspaceProjectDeployBoardEndpoint.as_view(),
        name="workspace-project-boards",
    ),
]
