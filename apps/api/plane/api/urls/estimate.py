# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for the external ``/api/v1/`` project estimate surface.

Binds project-scoped estimate and estimate-point endpoints to the view
classes in ``plane.api.views.estimate``. The ``urlpatterns`` list here is
not aggregated by ``plane.api.urls.__init__``, so these routes do not
resolve at runtime.
"""

# INTENT UNCLEAR: estimate.urlpatterns is defined but never spread into the
# package aggregator (apps/api/plane/api/urls/__init__.py); retained as-is
# per the no-refactoring system boundary.

from django.urls import path

from plane.api.views.estimate import (
    ProjectEstimateAPIEndpoint,
    EstimatePointListCreateAPIEndpoint,
    EstimatePointDetailAPIEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/estimates/",
        ProjectEstimateAPIEndpoint.as_view(http_method_names=["get", "post", "patch", "delete"]),
        name="project-estimate",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/estimates/<uuid:estimate_id>/estimate-points/",
        EstimatePointListCreateAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="estimate-point-list-create",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/estimates/<uuid:estimate_id>/estimate-points/<uuid:estimate_point_id>/",
        EstimatePointDetailAPIEndpoint.as_view(http_method_names=["patch", "delete"]),
        name="estimate-point-detail",
    ),
]
