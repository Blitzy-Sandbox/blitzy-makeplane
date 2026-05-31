# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF authorization layer for workspace, project, and page access control.

This package is the stable public import surface for ``plane.app.permissions``.
Consumers across ``plane.app.views`` should import permission primitives from
this module rather than reaching into the implementation files directly.

Re-exported symbols:

* ``ROLE`` and ``allow_permission`` -- shared role enum and decorator helper
  from :mod:`plane.app.permissions.base`.
* Workspace permission classes (``WorkSpaceBasePermission``,
  ``WorkspaceOwnerPermission``, ``WorkSpaceAdminPermission``,
  ``WorkspaceEntityPermission``, ``WorkspaceViewerPermission``,
  ``WorkspaceUserPermission``) from :mod:`plane.app.permissions.workspace`.
* Project permission classes (``ProjectBasePermission``,
  ``ProjectEntityPermission``, ``ProjectMemberPermission``,
  ``ProjectLitePermission``, ``ProjectAdminPermission``) from
  :mod:`plane.app.permissions.project`.
* ``ProjectPagePermission`` -- page-scoped authorization class from
  :mod:`plane.app.permissions.page`.
"""

from .workspace import (
    WorkSpaceBasePermission,
    WorkspaceOwnerPermission,
    WorkSpaceAdminPermission,
    WorkspaceEntityPermission,
    WorkspaceViewerPermission,
    WorkspaceUserPermission,
)
from .project import (
    ProjectBasePermission,
    ProjectEntityPermission,
    ProjectMemberPermission,
    ProjectLitePermission,
    ProjectAdminPermission,
)
from .base import allow_permission, ROLE
from .page import ProjectPagePermission
