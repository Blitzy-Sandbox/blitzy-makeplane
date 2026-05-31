# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Barrel module re-exporting the public DRF view-layer surface for ``plane.app``.

Aggregates every ViewSet, generic API view, and HTTP endpoint defined under
``plane.app.views.*`` so consumers (URL routers, tests, mixins) can import
any public class directly from ``plane.app.views`` without traversing the
sub-package layout. The order below mirrors the source order of the file
and is grouped by sub-package:

* ``project/`` -- project CRUD, identifiers, favorites, deploy boards,
  invites, members.
* ``user/`` -- current-user profile, settings, sessions, onboarding,
  activity, accounts.
* ``base`` -- shared :class:`BaseViewSet`, :class:`BaseAPIView`, and
  :class:`TimezoneMixin` infrastructure inherited by every view in this
  package.
* ``workspace/`` -- workspace records, members, invites, themes, drafts,
  home dashboards, favorites, stickies, labels, states, estimates,
  modules, cycles, user preferences, and recent visits.
* ``state/`` -- project workflow states and triage-state lookup.
* ``view/`` -- saved issue views (workspace and project scope).
* ``cycle/`` -- cycle CRUD, cycle issue membership, cycle archive.
* ``asset/`` -- file-asset upload/download/restore/duplicate endpoints
  (presigned-POST contract per tech spec §5.2.9).
* ``issue/`` -- the largest sub-package: issue CRUD, activity log,
  archive, attachments, comments, labels, links, reactions, relations,
  sub-issues, subscribers, version history.
* ``module/`` -- module CRUD, module issue membership, module archive.
* ``api`` -- personal API-token CRUD for the web client.
* ``page/`` -- page CRUD and page version history (live-server callback
  contract per tech spec §5.2.1.4).
* ``search/`` -- global search, project-scoped quick search, issue search.
* ``external/`` -- LLM (OpenAI / Anthropic / Gemini) and Unsplash
  integration endpoints.
* ``estimate/`` -- estimate scales and estimate points.
* ``intake/`` -- intake (triage) queue: intake records and intake issues.
* ``analytic/`` -- workspace, project, and advanced analytics endpoints.
* ``notification/`` -- in-app notification inbox, unread counts, bulk
  mark-as-read, and user notification preferences.
* ``exporter/`` -- issue export initiation and history (Celery-backed via
  RabbitMQ per architectural context).
* ``webhook/`` -- workspace webhook CRUD, secret regeneration, delivery
  logs (HMAC payload contract per tech spec §5.2.10).
* ``error_404`` -- JSON 404 handler for unmatched routes.
* ``timezone/`` -- cached enumeration of supported IANA timezones.
"""

from .project.base import (
    ProjectViewSet,
    ProjectIdentifierEndpoint,
    ProjectUserViewsEndpoint,
    ProjectFavoritesViewSet,
    DeployBoardViewSet,
    ProjectArchiveUnarchiveEndpoint,
)

from .project.invite import (
    UserProjectInvitationsViewset,
    ProjectInvitationsViewset,
    ProjectJoinEndpoint,
)

from .project.member import (
    ProjectMemberViewSet,
    ProjectMemberUserEndpoint,
    UserProjectRolesEndpoint,
    ProjectMemberPreferenceEndpoint,
)

from .user.base import (
    UserEndpoint,
    UpdateUserOnBoardedEndpoint,
    UpdateUserTourCompletedEndpoint,
    UserActivityEndpoint,
)


from .base import BaseAPIView, BaseViewSet

from .workspace.base import (
    WorkSpaceViewSet,
    UserWorkSpacesEndpoint,
    WorkSpaceAvailabilityCheckEndpoint,
    UserWorkspaceDashboardEndpoint,
    WorkspaceThemeViewSet,
    ExportWorkspaceUserActivityEndpoint,
)

from .workspace.draft import WorkspaceDraftIssueViewSet

from .workspace.home import WorkspaceHomePreferenceViewSet

from .workspace.favorite import (
    WorkspaceFavoriteEndpoint,
    WorkspaceFavoriteGroupEndpoint,
)
from .workspace.recent_visit import UserRecentVisitViewSet
from .workspace.user_preference import WorkspaceUserPreferenceViewSet

from .workspace.member import (
    WorkSpaceMemberViewSet,
    WorkspaceMemberUserEndpoint,
    WorkspaceProjectMemberEndpoint,
    WorkspaceMemberUserViewsEndpoint,
)
from .workspace.invite import (
    WorkspaceInvitationsViewset,
    WorkspaceJoinEndpoint,
    UserWorkspaceInvitationsViewSet,
)
from .workspace.label import WorkspaceLabelsEndpoint
from .workspace.state import WorkspaceStatesEndpoint
from .workspace.user import (
    UserLastProjectWithWorkspaceEndpoint,
    WorkspaceUserProfileIssuesEndpoint,
    WorkspaceUserPropertiesEndpoint,
    WorkspaceUserProfileEndpoint,
    WorkspaceUserActivityEndpoint,
    WorkspaceUserProfileStatsEndpoint,
    UserActivityGraphEndpoint,
    UserIssueCompletedGraphEndpoint,
)
from .workspace.estimate import WorkspaceEstimatesEndpoint
from .workspace.module import WorkspaceModulesEndpoint
from .workspace.cycle import WorkspaceCyclesEndpoint
from .workspace.quick_link import QuickLinkViewSet
from .workspace.sticky import WorkspaceStickyViewSet

from .state.base import StateViewSet, IntakeStateEndpoint
from .view.base import (
    WorkspaceViewViewSet,
    WorkspaceViewIssuesViewSet,
    IssueViewViewSet,
    IssueViewFavoriteViewSet,
)
from .cycle.base import (
    CycleViewSet,
    CycleDateCheckEndpoint,
    CycleFavoriteViewSet,
    TransferCycleIssueEndpoint,
    CycleUserPropertiesEndpoint,
    CycleAnalyticsEndpoint,
    CycleProgressEndpoint,
)
from .cycle.issue import CycleIssueViewSet
from .cycle.archive import CycleArchiveUnarchiveEndpoint

from .asset.base import FileAssetEndpoint, UserAssetsEndpoint, FileAssetViewSet
from .asset.v2 import (
    WorkspaceFileAssetEndpoint,
    UserAssetsV2Endpoint,
    StaticFileAssetEndpoint,
    AssetRestoreEndpoint,
    ProjectAssetEndpoint,
    ProjectBulkAssetEndpoint,
    AssetCheckEndpoint,
    DuplicateAssetEndpoint,
    WorkspaceAssetDownloadEndpoint,
    ProjectAssetDownloadEndpoint,
)
from .issue.base import (
    IssueListEndpoint,
    IssueViewSet,
    ProjectUserDisplayPropertyEndpoint,
    BulkDeleteIssuesEndpoint,
    DeletedIssuesListViewSet,
    IssuePaginatedViewSet,
    IssueDetailEndpoint,
    IssueBulkUpdateDateEndpoint,
    IssueMetaEndpoint,
    IssueDetailIdentifierEndpoint,
)

from .issue.activity import IssueActivityEndpoint

from .issue.archive import IssueArchiveViewSet, BulkArchiveIssuesEndpoint

from .issue.attachment import (
    IssueAttachmentEndpoint,
    # V2
    IssueAttachmentV2Endpoint,
)

from .issue.comment import IssueCommentViewSet, CommentReactionViewSet

from .issue.label import LabelViewSet, BulkCreateIssueLabelsEndpoint

from .issue.link import IssueLinkViewSet

from .issue.relation import IssueRelationViewSet

from .issue.reaction import IssueReactionViewSet

from .issue.sub_issue import SubIssuesEndpoint

from .issue.subscriber import IssueSubscriberViewSet

from .issue.version import IssueVersionEndpoint, WorkItemDescriptionVersionEndpoint

from .module.base import (
    ModuleViewSet,
    ModuleLinkViewSet,
    ModuleFavoriteViewSet,
    ModuleUserPropertiesEndpoint,
)

from .module.issue import ModuleIssueViewSet

from .module.archive import ModuleArchiveUnarchiveEndpoint

from .api import ApiTokenEndpoint

from .page.base import (
    PageViewSet,
    PageFavoriteViewSet,
    PagesDescriptionViewSet,
    PageDuplicateEndpoint,
)
from .page.version import PageVersionEndpoint

from .search.base import GlobalSearchEndpoint, SearchEndpoint
from .search.issue import IssueSearchEndpoint


from .external.base import (
    GPTIntegrationEndpoint,
    UnsplashEndpoint,
    WorkspaceGPTIntegrationEndpoint,
)
from .estimate.base import (
    ProjectEstimatePointEndpoint,
    BulkEstimatePointEndpoint,
    EstimatePointEndpoint,
)

from .intake.base import (
    IntakeViewSet,
    IntakeIssueViewSet,
    IntakeWorkItemDescriptionVersionEndpoint,
)

from .analytic.base import (
    AnalyticsEndpoint,
    AnalyticViewViewset,
    SavedAnalyticEndpoint,
    ExportAnalyticsEndpoint,
    DefaultAnalyticsEndpoint,
    ProjectStatsEndpoint,
)

from .analytic.advance import (
    AdvanceAnalyticsEndpoint,
    AdvanceAnalyticsStatsEndpoint,
    AdvanceAnalyticsChartEndpoint,
)

from .analytic.project_analytics import (
    ProjectAdvanceAnalyticsEndpoint,
    ProjectAdvanceAnalyticsStatsEndpoint,
    ProjectAdvanceAnalyticsChartEndpoint,
)

from .notification.base import (
    NotificationViewSet,
    UnreadNotificationEndpoint,
    UserNotificationPreferenceEndpoint,
)

from .exporter.base import ExportIssuesEndpoint


from .webhook.base import (
    WebhookEndpoint,
    WebhookLogsEndpoint,
    WebhookSecretRegenerateEndpoint,
)

from .error_404 import custom_404_view

from .notification.base import MarkAllReadNotificationViewSet
from .user.base import AccountEndpoint, ProfileEndpoint, UserSessionEndpoint

from .timezone.base import TimezoneEndpoint
