# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Aggregated public views for the external ``/api/v1/`` API surface.

This package re-exports every endpoint class consumed by
``plane.api.urls`` so URL configuration files and external integrations
can import from the stable namespace::

    from plane.api.views import IssueListCreateAPIEndpoint

The endpoints are organized by domain:

- ``base``         – shared mixins, ``BaseAPIView``, and ``BaseViewSet``.
- ``user``         – the requesting user's profile endpoint.
- ``state``        – workflow state CRUD.
- ``member``       – workspace and project membership.
- ``estimate``     – per-project estimates and estimate points.
- ``invite``       – workspace invitations.
- ``sticky``       – user sticky notes within a workspace.
- ``intake``       – triage / inbox workflow.
- ``asset``        – S3-presigned file uploads for users and workspaces.
- ``project``      – project CRUD, archive/unarchive, and rollup
                     summaries.
- ``module``       – module CRUD, module-issue associations, archive.
- ``cycle``        – cycle CRUD, cycle-issue associations, archive,
                     and cross-cycle transfer.
- ``issue``        – work-item CRUD, labels, links, comments,
                     activities, attachments, search, and relations.

Every endpoint authenticates via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``) and
is throttled by ``ApiKeyRateThrottle`` (60/minute) or
``ServiceTokenRateThrottle`` (300/minute for service tokens).
"""

from .project import (
    ProjectListCreateAPIEndpoint,
    ProjectDetailAPIEndpoint,
    ProjectArchiveUnarchiveAPIEndpoint,
    ProjectSummaryAPIEndpoint,
)

from .state import (
    StateListCreateAPIEndpoint,
    StateDetailAPIEndpoint,
)

from .issue import (
    WorkspaceIssueAPIEndpoint,
    IssueListCreateAPIEndpoint,
    IssueDetailAPIEndpoint,
    LabelListCreateAPIEndpoint,
    LabelDetailAPIEndpoint,
    IssueLinkListCreateAPIEndpoint,
    IssueLinkDetailAPIEndpoint,
    IssueCommentListCreateAPIEndpoint,
    IssueCommentDetailAPIEndpoint,
    IssueActivityListAPIEndpoint,
    IssueActivityDetailAPIEndpoint,
    IssueAttachmentListCreateAPIEndpoint,
    IssueAttachmentDetailAPIEndpoint,
    IssueSearchEndpoint,
    IssueRelationListCreateAPIEndpoint,
)

from .cycle import (
    CycleListCreateAPIEndpoint,
    CycleDetailAPIEndpoint,
    CycleIssueListCreateAPIEndpoint,
    CycleIssueDetailAPIEndpoint,
    TransferCycleIssueAPIEndpoint,
    CycleArchiveUnarchiveAPIEndpoint,
)

from .module import (
    ModuleListCreateAPIEndpoint,
    ModuleDetailAPIEndpoint,
    ModuleIssueListCreateAPIEndpoint,
    ModuleIssueDetailAPIEndpoint,
    ModuleArchiveUnarchiveAPIEndpoint,
)

from .member import ProjectMemberListCreateAPIEndpoint, ProjectMemberDetailAPIEndpoint, WorkspaceMemberAPIEndpoint

from .intake import (
    IntakeIssueListCreateAPIEndpoint,
    IntakeIssueDetailAPIEndpoint,
)

from .asset import UserAssetEndpoint, UserServerAssetEndpoint, GenericAssetEndpoint

from .user import UserEndpoint

from .invite import WorkspaceInvitationsViewset

from .sticky import StickyViewSet
