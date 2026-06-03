# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Public-surface views package barrel for the ``plane.space`` API.

Re-exports the 19 view classes that comprise the anonymous + authenticated
public API mounted under ``api/public/`` (see ``apps/api/plane/urls.py``
for the mount point and ``apps/api/plane/space/urls/`` for the routes).

The exported classes split across eight source modules:

* ``.project`` (4 classes) --
  :class:`ProjectDeployBoardPublicSettingsEndpoint`,
  :class:`WorkspaceProjectDeployBoardEndpoint`,
  :class:`WorkspaceProjectAnchorEndpoint`,
  :class:`ProjectMembersEndpoint`.
* ``.issue`` (6 classes) -- :class:`IssueCommentPublicViewSet`,
  :class:`IssueReactionPublicViewSet`,
  :class:`CommentReactionPublicViewSet`,
  :class:`IssueVotePublicViewSet`,
  :class:`IssueRetrievePublicEndpoint`,
  :class:`ProjectIssuesPublicEndpoint`.
* ``.intake`` (1) -- :class:`IntakeIssuePublicViewSet`.
* ``.cycle`` (1) -- :class:`ProjectCyclesEndpoint`.
* ``.module`` (1) -- :class:`ProjectModulesEndpoint`.
* ``.state`` (1) -- :class:`ProjectStatesEndpoint`.
* ``.label`` (1) -- :class:`ProjectLabelsEndpoint`.
* ``.asset`` (3) -- :class:`EntityAssetEndpoint`,
  :class:`AssetRestoreEndpoint`, :class:`EntityBulkAssetEndpoint`.
* ``.meta`` (1) -- :class:`ProjectMetaDataEndpoint`.

This barrel lets URL configuration files in
``apps/api/plane/space/urls/`` import view classes from a single,
stable path (``from plane.space.views import ...``) without coupling the
URL layer to the implementation-file layout.
"""

from .project import (
    ProjectDeployBoardPublicSettingsEndpoint,
    WorkspaceProjectDeployBoardEndpoint,
    WorkspaceProjectAnchorEndpoint,
    ProjectMembersEndpoint,
)

from .issue import (
    IssueCommentPublicViewSet,
    IssueReactionPublicViewSet,
    CommentReactionPublicViewSet,
    IssueVotePublicViewSet,
    IssueRetrievePublicEndpoint,
    ProjectIssuesPublicEndpoint,
)

from .intake import IntakeIssuePublicViewSet

from .cycle import ProjectCyclesEndpoint

from .module import ProjectModulesEndpoint

from .state import ProjectStatesEndpoint

from .label import ProjectLabelsEndpoint

from .asset import EntityAssetEndpoint, AssetRestoreEndpoint, EntityBulkAssetEndpoint

from .meta import ProjectMetaDataEndpoint
