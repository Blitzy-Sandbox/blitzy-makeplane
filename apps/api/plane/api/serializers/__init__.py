# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Public serializer classes for the API-key-authenticated ``/api/v1/`` surface.

This package mirrors :mod:`plane.app.serializers` and aggregates every
serializer consumed by :mod:`plane.api.views`. All serializers inherit from
:class:`plane.api.serializers.base.BaseSerializer`, which adds dynamic
``fields=`` filtering and ``expand=`` relation embedding driven by the
``?fields=`` and ``?expand=`` query parameters parsed in the view layer.
"""

from .user import UserLiteSerializer
from .workspace import WorkspaceLiteSerializer
from .project import (
    ProjectSerializer,
    ProjectLiteSerializer,
    ProjectCreateSerializer,
    ProjectUpdateSerializer,
)
from .issue import (
    IssueSerializer,
    LabelCreateUpdateSerializer,
    LabelSerializer,
    IssueLinkSerializer,
    IssueCommentSerializer,
    IssueAttachmentSerializer,
    IssueActivitySerializer,
    IssueExpandSerializer,
    IssueLiteSerializer,
    IssueAttachmentUploadSerializer,
    IssueSearchSerializer,
    IssueCommentCreateSerializer,
    IssueLinkCreateSerializer,
    IssueLinkUpdateSerializer,
    IssueRelationCreateSerializer,
    IssueRelationResponseSerializer,
    IssueRelationSerializer,
    RelatedIssueSerializer,
)
from .state import StateLiteSerializer, StateSerializer
from .cycle import (
    CycleSerializer,
    CycleIssueSerializer,
    CycleLiteSerializer,
    CycleIssueRequestSerializer,
    TransferCycleIssueRequestSerializer,
    CycleCreateSerializer,
    CycleUpdateSerializer,
)
from .module import (
    ModuleSerializer,
    ModuleIssueSerializer,
    ModuleLiteSerializer,
    ModuleIssueRequestSerializer,
    ModuleCreateSerializer,
    ModuleUpdateSerializer,
)
from .intake import (
    IntakeIssueSerializer,
    IntakeIssueCreateSerializer,
    IntakeIssueUpdateSerializer,
)
from .estimate import EstimateSerializer, EstimatePointSerializer
from .asset import (
    UserAssetUploadSerializer,
    AssetUpdateSerializer,
    GenericAssetUploadSerializer,
    GenericAssetUpdateSerializer,
    FileAssetSerializer,
)
from .invite import WorkspaceInviteSerializer
from .member import ProjectMemberSerializer
from .sticky import StickySerializer
