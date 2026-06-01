# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL patterns for project metadata and listing endpoints on public space boards.

Declares anchor-scoped routes that expose published deploy-board project
metadata -- cycles, modules, states, labels, members, issues, settings --
to anonymous visitors via nine endpoints:

- ``project-meta`` -- ``anchor/<str:anchor>/meta/`` (``ProjectMetaDataEndpoint``).
- ``project-deploy-board-settings`` -- ``anchor/<str:anchor>/settings/``
  (``ProjectDeployBoardPublicSettingsEndpoint``).
- ``project-deploy-board`` -- ``anchor/<str:anchor>/issues/``
  (``ProjectIssuesPublicEndpoint``).
- ``project-deploy-board`` -- ``workspaces/<str:slug>/projects/<uuid:project_id>/anchor/``
  (``WorkspaceProjectAnchorEndpoint``).
- ``project-cycles`` -- ``anchor/<str:anchor>/cycles/`` (``ProjectCyclesEndpoint``).
- ``project-modules`` -- ``anchor/<str:anchor>/modules/`` (``ProjectModulesEndpoint``).
- ``project-states`` -- ``anchor/<str:anchor>/states/`` (``ProjectStatesEndpoint``).
- ``project-labels`` -- ``anchor/<str:anchor>/labels/`` (``ProjectLabelsEndpoint``).
- ``project-members`` -- ``anchor/<str:anchor>/members/`` (``ProjectMembersEndpoint``).

These patterns belong to the anonymous public read surface aggregated by
``plane.space.urls`` and mounted under ``api/public/``.
"""

# INTENT UNCLEAR: the route name ``project-deploy-board`` is registered on
# two different paths (``anchor/<str:anchor>/issues/`` ->
# ``ProjectIssuesPublicEndpoint`` and
# ``workspaces/<str:slug>/projects/<uuid:project_id>/anchor/`` ->
# ``WorkspaceProjectAnchorEndpoint``); Django ``reverse('project-deploy-board')``
# therefore resolves to whichever pattern matches first by registration order
# and the duplication is preserved as-is per the system boundary that forbids
# refactoring or renaming.

from django.urls import path


from plane.space.views import (
    ProjectDeployBoardPublicSettingsEndpoint,
    ProjectIssuesPublicEndpoint,
    WorkspaceProjectAnchorEndpoint,
    ProjectCyclesEndpoint,
    ProjectModulesEndpoint,
    ProjectStatesEndpoint,
    ProjectLabelsEndpoint,
    ProjectMembersEndpoint,
    ProjectMetaDataEndpoint,
)

urlpatterns = [
    path(
        "anchor/<str:anchor>/meta/",
        ProjectMetaDataEndpoint.as_view(),
        name="project-meta",
    ),
    path(
        "anchor/<str:anchor>/settings/",
        ProjectDeployBoardPublicSettingsEndpoint.as_view(),
        name="project-deploy-board-settings",
    ),
    path(
        "anchor/<str:anchor>/issues/",
        ProjectIssuesPublicEndpoint.as_view(),
        name="project-deploy-board",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/anchor/",
        WorkspaceProjectAnchorEndpoint.as_view(),
        name="project-deploy-board",
    ),
    path(
        "anchor/<str:anchor>/cycles/",
        ProjectCyclesEndpoint.as_view(),
        name="project-cycles",
    ),
    path(
        "anchor/<str:anchor>/modules/",
        ProjectModulesEndpoint.as_view(),
        name="project-modules",
    ),
    path(
        "anchor/<str:anchor>/states/",
        ProjectStatesEndpoint.as_view(),
        name="project-states",
    ),
    path(
        "anchor/<str:anchor>/labels/",
        ProjectLabelsEndpoint.as_view(),
        name="project-labels",
    ),
    path(
        "anchor/<str:anchor>/members/",
        ProjectMembersEndpoint.as_view(),
        name="project-members",
    ),
]
