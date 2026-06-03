# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public façade for Plane's DRF permission classes and the shared role decorator.

This package re-exports the workspace permission classes
(``WorkSpaceBasePermission``, ``WorkspaceOwnerPermission``,
``WorkSpaceAdminPermission``, ``WorkspaceEntityPermission``,
``WorkspaceViewerPermission``, ``WorkspaceUserPermission``), the project
permission classes (``ProjectBasePermission``, ``ProjectEntityPermission``,
``ProjectMemberPermission``, ``ProjectLitePermission``,
``ProjectAdminPermission``), the page permission class
(``ProjectPagePermission``), and the shared ``ROLE`` enum plus
``allow_permission`` decorator so DRF ViewSets can import every authorization
primitive from a single namespace.

The re-exported classes are stateless and resolve access on each request from
DRF route kwargs (``workspace_slug``, ``project_id``, ``page_id``, and an
optional ``project_identifier``) combined with live ORM lookups against
``WorkspaceMember``, ``ProjectMember``, and ``Page``. The ``migrator``
container runs Django migrations before any API service starts, so the
membership and role tables these permissions query are guaranteed to exist
at module import time.
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
