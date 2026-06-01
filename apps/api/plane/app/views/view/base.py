# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Saved-view HTTP endpoints (workspace- and project-scoped) for the Plane web client.

Implements four DRF ViewSets that together back the "Views" UI:

* :class:`WorkspaceViewViewSet` -- CRUD over workspace-level saved views
  (``IssueView`` rows where ``project IS NULL``). Permission rule is
  enforced per-method via :func:`plane.app.permissions.allow_permission`
  rather than ``permission_classes``; see each method docstring for the
  exact roles permitted.
* :class:`WorkspaceViewIssuesViewSet` -- workspace-scoped issue search
  used to render a saved view's result set; composes the legacy
  :func:`plane.utils.issue_filters.issue_filters` parser with the modern
  :class:`plane.utils.filters.ComplexFilterBackend` /
  :class:`plane.utils.filters.IssueFilterSet` and applies guest-aware
  project-permission filters before pagination.
* :class:`IssueViewViewSet` -- CRUD over project-level saved views
  (``IssueView`` rows scoped to a specific project), with an
  ``is_favorite`` annotation correlated against ``UserFavorite``.
* :class:`IssueViewFavoriteViewSet` -- per-user favorite toggle for saved
  views; ``UserFavorite`` rows are hard-deleted on unfavorite.

The :class:`plane.db.models.IssueView` model stores ``filters`` and
``display_filters`` JSON blobs that are re-serialized on save into the
computed ``query`` JSON via :func:`plane.utils.issue_filters.issue_filters`.
The ``access`` field is an integer enum -- ``0 = Private`` (owner only),
``1 = Public`` (visible to all members of the workspace or project).
Both ``access`` and ``is_locked`` are read-only in
:class:`plane.app.serializers.IssueViewSerializer`, so they cannot be
toggled via PATCH; ``is_locked`` is enforced here in
:meth:`partial_update` to short-circuit edits.

Retrieve operations dispatch the
:func:`plane.bgtasks.recent_visited_task.recent_visited_task` Celery task
(via RabbitMQ per architectural context) to record the user's recent
visit. Destroy operations cascade-clean the corresponding ``UserFavorite``
rows (and ``UserRecentVisit`` rows for project-scoped views).
"""

import copy

# Django imports
from django.db.models import (
    Exists,
    F,
    Func,
    OuterRef,
    Q,
    Subquery,
    Prefetch,
)
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page
from django.db import transaction

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import IssueViewSerializer, ViewIssueListSerializer
from plane.db.models import (
    Issue,
    FileAsset,
    IssueLink,
    IssueView,
    Workspace,
    WorkspaceMember,
    ProjectMember,
    Project,
    CycleIssue,
    UserRecentVisit,
    IssueAssignee,
    IssueLabel,
    ModuleIssue,
)
from plane.utils.issue_filters import issue_filters
from plane.utils.order_queryset import order_issue_queryset
from plane.bgtasks.recent_visited_task import recent_visited_task
from .. import BaseViewSet
from plane.db.models import UserFavorite
from plane.utils.filters import ComplexFilterBackend
from plane.utils.filters import IssueFilterSet


class WorkspaceViewViewSet(BaseViewSet):
    """Workspace-level saved-view CRUD endpoint.

    Resource managed:
        Workspace-scoped :class:`plane.db.models.IssueView` rows (those
        with ``project IS NULL``). Each saved view persists a reusable
        filter + display configuration that any workspace member can
        re-apply via :class:`WorkspaceViewIssuesViewSet`.

    HTTP methods + URL patterns:
        * ``GET    /api/workspaces/<slug>/views/``                 -> list
        * ``POST   /api/workspaces/<slug>/views/``                 -> create
        * ``GET    /api/workspaces/<slug>/views/<uuid:pk>/``       -> retrieve
        * ``PUT    /api/workspaces/<slug>/views/<uuid:pk>/``       -> update (inherited from ``ModelViewSet``)
        * ``PATCH  /api/workspaces/<slug>/views/<uuid:pk>/``       -> partial_update
        * ``DELETE /api/workspaces/<slug>/views/<uuid:pk>/``       -> destroy

    Request body (POST / PATCH; consumed by :class:`plane.app.serializers.IssueViewSerializer`):
        * ``name`` (str, required, max 255 chars) -- view label.
        * ``description`` (str, optional) -- free-form text; defaults to ``""``.
        * ``filters`` (JSON object, optional) -- raw filter payload
          (e.g., ``{"priority": ["high"], "assignees": [<uuid>]}``);
          re-parsed into the ``query`` JSON on save.
        * ``display_filters`` (JSON object, optional) -- ``group_by``,
          ``order_by``, ``type``, ``sub_issue``, ``show_empty_groups``,
          ``layout``, ``calendar_date_range``.
        * ``display_properties`` (JSON object, optional) -- map of column
          name -> bool controlling which columns are visible in the list/
          kanban/spreadsheet layouts.
        * ``rich_filters`` (JSON object, optional) -- rich filter tree.
        * ``sort_order`` (float, optional) -- auto-bumped by ``+10000``
          on create.
        * ``logo_props`` (JSON object, optional) -- emoji / icon metadata.

    Read-only fields (cannot be set or changed via this endpoint):
        ``workspace``, ``project``, ``query`` (computed from ``filters``),
        ``owned_by`` (forced to ``request.user`` in :meth:`perform_create`),
        ``access`` (defaults to ``1`` = Public; not patchable),
        ``is_locked`` (toggled out-of-band; enforced here to block edits).

    Response shape:
        :class:`plane.app.serializers.IssueViewSerializer` output.
        The list endpoint supports ``?fields=a,b,c`` to project only the
        named fields.

    Permissions:
        Method-level via :func:`plane.app.permissions.allow_permission`:

        * :meth:`list`           -- ADMIN, MEMBER, GUEST (workspace).
        * :meth:`create`         -- inherited from ``ModelViewSet``;
          base ``[IsAuthenticated]`` + workspace membership enforced by
          :meth:`perform_create`.
        * :meth:`retrieve`       -- ``[IsAuthenticated]`` only (no
          ``allow_permission`` decorator); ``get_queryset`` filters
          enforce visibility.
        * :meth:`partial_update` -- creator-only (``allowed_roles=[]``,
          ``creator=True``) **and** the in-method owner check rejects
          non-owners.
        * :meth:`destroy`        -- workspace ADMIN **or** the view's
          creator (``allowed_roles=[ROLE.ADMIN]``, ``creator=True``);
          additionally requires the user to be the owner OR a
          workspace-admin ``WorkspaceMember`` row (``role=20``,
          ``is_active=True``).

    get_queryset filter logic:
        Returns ``IssueView`` rows where ``workspace.slug ==
        kwargs["slug"]`` AND ``project IS NULL`` AND
        (``owned_by == request.user`` OR ``access == 1`` [Public]).
        Result is ordered by ``request.GET["order_by"]`` (default
        ``-created_at``) and de-duplicated with ``.distinct()``. The
        :meth:`list` override further restricts the queryset to the
        user's own views when the caller is a workspace GUEST
        (``WorkspaceMember.role == 5``).

    Side effects (retrieve):
        ``recent_visited_task`` Celery task is dispatched via RabbitMQ
        (worker module :mod:`plane.bgtasks.recent_visited_task`).

    Cross-references:
        * Serializer: ``IssueViewSerializer`` in
          ``apps/api/plane/app/serializers/view.py``.
        * Models: ``IssueView`` in
          ``apps/api/plane/db/models/view.py``;
          ``WorkspaceMember`` in
          ``apps/api/plane/db/models/workspace.py``.
        * Permissions: ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * Celery task:
          ``apps/api/plane/bgtasks/recent_visited_task.py`` (queued
          via RabbitMQ).
        * URL registration:
          ``apps/api/plane/app/urls/views.py``.
    """

    serializer_class = IssueViewSerializer
    model = IssueView

    def perform_create(self, serializer):
        """Persist a new workspace-level view from request context.

        Resolves ``workspace`` from the URL slug and forces ``owned_by``
        to the requesting user.
        """
        workspace = Workspace.objects.get(slug=self.kwargs.get("slug"))
        serializer.save(workspace_id=workspace.id, owned_by=self.request.user)

    def get_queryset(self):
        """Return workspace-level views visible to the requester.

        Filters to the requester's own private views OR any Public view
        in the workspace, ordered by the ``?order_by`` query param
        (default ``-created_at``).
        """
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project__isnull=True)
            .filter(Q(owned_by=self.request.user) | Q(access=1))
            .order_by(self.request.GET.get("order_by", "-created_at"))
            .distinct()
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        """List workspace-level views visible to the caller.

        Further restricts the queryset to the caller's own views when
        the caller is a workspace GUEST (``WorkspaceMember.role == 5``).
        """
        queryset = self.get_queryset()
        fields = [field for field in request.GET.get("fields", "").split(",") if field]
        if WorkspaceMember.objects.filter(workspace__slug=slug, member=request.user, role=5, is_active=True).exists():
            queryset = queryset.filter(owned_by=request.user)
        views = IssueViewSerializer(queryset, many=True, fields=fields if fields else None).data
        return Response(views, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[], level="WORKSPACE", creator=True, model=IssueView)
    def partial_update(self, request, slug, pk):
        """Update a workspace-level view inside a transaction.

        Acquires a row-level ``SELECT FOR UPDATE`` lock on the target view,
        rejects the request with HTTP 400 if the view is ``is_locked``,
        and rejects non-owner requests with HTTP 400 even when the
        creator-only decorator would otherwise grant access.
        """
        with transaction.atomic():
            workspace_view = IssueView.objects.select_for_update().get(pk=pk, workspace__slug=slug)

            if workspace_view.is_locked:
                return Response({"error": "view is locked"}, status=status.HTTP_400_BAD_REQUEST)

            # Only update the view if owner is updating
            if workspace_view.owned_by_id != request.user.id:
                return Response(
                    {"error": "Only the owner of the view can update the view"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            serializer = IssueViewSerializer(workspace_view, data=request.data, partial=True)

            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def retrieve(self, request, slug, pk):
        """Return the requested workspace view and record the visit asynchronously.

        Enqueues :func:`plane.bgtasks.recent_visited_task.recent_visited_task`
        on Celery (via RabbitMQ) to update the user's recent-visit log.
        """
        issue_view = self.get_queryset().filter(pk=pk).first()
        serializer = IssueViewSerializer(issue_view)
        recent_visited_task.delay(
            slug=slug,
            project_id=None,
            entity_name="view",
            entity_identifier=pk,
            user_id=request.user.id,
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE", creator=True, model=IssueView)
    def destroy(self, request, slug, pk):
        """Hard-delete a workspace view and cascade-delete the matching ``UserFavorite`` rows.

        Allowed only when the requester is a workspace admin
        (``WorkspaceMember.role == 20``, ``is_active=True``) OR the
        original ``owned_by`` user. Returns HTTP 400 otherwise.
        """
        workspace_view = IssueView.objects.get(pk=pk, workspace__slug=slug)

        workspace_member = WorkspaceMember.objects.filter(
            workspace__slug=slug, member=request.user, role=20, is_active=True
        )
        if workspace_member.exists() or workspace_view.owned_by == request.user:
            workspace_view.delete()
            # Delete the user favorite view
            UserFavorite.objects.filter(
                workspace__slug=slug,
                entity_identifier=pk,
                project__isnull=True,
                entity_type="view",
            ).delete()
        else:
            return Response(
                {"error": "Only admin or owner can delete the view"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceViewIssuesViewSet(BaseViewSet):
    """Workspace-scoped issue list endpoint used to render a saved view's results.

    Resource managed:
        :class:`plane.db.models.Issue` rows filtered down to a single
        workspace, then further narrowed by the requested filter payload.
        Used by the "Views" UI to materialize the issue list for a
        saved view without persisting any state of its own.

    HTTP methods + URL pattern:
        * ``GET /api/workspaces/<slug>/issues/`` -> :meth:`list`
          (gzip-compressed via :func:`django.views.decorators.gzip.gzip_page`).

    Query parameters:
        Accepts the legacy :func:`plane.utils.issue_filters.issue_filters`
        parameter shape (e.g., ``?priority=high&assignees=<uuid>``) AND
        the modern :class:`plane.utils.filters.ComplexFilterBackend` /
        :class:`plane.utils.filters.IssueFilterSet` shape. Both are
        applied -- legacy filters via ``.filter(**filters)``, modern
        filters via the configured filter backend. Also honors
        ``?order_by=`` (default ``-created_at``).

    Response shape:
        Paginated :class:`plane.app.serializers.ViewIssueListSerializer`
        output (one entry per issue with annotated ``cycle_id``,
        ``link_count``, ``attachment_count``, ``sub_issues_count`` and
        prefetched ``assignee_ids``, ``label_ids``, ``module_ids``).
        Pagination is delegated to
        :meth:`plane.utils.paginator.BasePaginator.paginate`.

    Permissions:
        Method-level: :meth:`list` requires workspace ADMIN, MEMBER, or
        GUEST. Beyond role membership, the project-visibility filter
        ``_get_project_permission_filters`` enforces:

        * GUEST + ``project.guest_view_all_features=True``  -> all issues
          in projects where the user is an active member.
        * GUEST + ``project.guest_view_all_features=False`` -> only
          issues the user created.
        * MEMBER or ADMIN (``role > 5``)                   -> all issues
          in projects where the user is an active member.

    Performance notes:
        The list endpoint deep-copies the filtered queryset before
        applying annotations so the count-only query path stays cheap;
        annotations and prefetches are applied to the row-fetch path
        only.

    Request body:
        None (GET only); all parameters are supplied as query string.

    Cross-references:
        * Serializer: ``ViewIssueListSerializer`` in
          ``apps/api/plane/app/serializers/view.py``.
        * Models: ``Issue``, ``IssueLink``, ``IssueAssignee`` in
          ``apps/api/plane/db/models/issue.py``;
          ``CycleIssue`` in ``apps/api/plane/db/models/cycle.py``;
          ``FileAsset`` in ``apps/api/plane/db/models/asset.py``.
        * Permissions: ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * Filter helpers:
          ``apps/api/plane/utils/issue_filters.py``,
          ``apps/api/plane/utils/filters.py``.
        * URL registration:
          ``apps/api/plane/app/urls/views.py``.
    """

    filter_backends = (ComplexFilterBackend,)
    filterset_class = IssueFilterSet

    def _get_project_permission_filters(self):
        """Build the role-aware project-visibility ``Q`` filter for the workspace-issues list.

        Returns a ``Q`` object that limits visible issues to projects the
        user is an active member of, with the guest-role narrowing rule
        applied: when the project flag ``guest_view_all_features`` is
        False, guests (``role == 5``) only see issues they created.
        """
        return Q(
            Q(
                project__project_projectmember__role=5,
                project__guest_view_all_features=True,
            )
            | Q(
                project__project_projectmember__role=5,
                project__guest_view_all_features=False,
                created_by=self.request.user,
            )
            |
            # For other roles (role > 5), show all issues
            Q(project__project_projectmember__role__gt=5),
            project__project_projectmember__member=self.request.user,
            project__project_projectmember__is_active=True,
        )

    def apply_annotations(self, issues):
        """Annotate the issue queryset with derived counts and prefetch related rows.

        Adds ``cycle_id``, ``link_count``, ``attachment_count``, and
        ``sub_issues_count`` annotations, and prefetches ``issue_assignee``,
        ``label_issue``, and ``issue_module`` to avoid N+1 queries during
        serialization.
        """
        return (
            issues.annotate(
                cycle_id=Subquery(
                    CycleIssue.objects.filter(issue=OuterRef("id"), deleted_at__isnull=True).values("cycle_id")[:1]
                )
            )
            .annotate(
                link_count=IssueLink.objects.filter(issue=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                attachment_count=FileAsset.objects.filter(
                    issue_id=OuterRef("id"),
                    entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                )
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .prefetch_related(
                Prefetch(
                    "issue_assignee",
                    queryset=IssueAssignee.objects.all(),
                )
            )
            .prefetch_related(
                Prefetch(
                    "label_issue",
                    queryset=IssueLabel.objects.all(),
                )
            )
            .prefetch_related(
                Prefetch(
                    "issue_module",
                    queryset=ModuleIssue.objects.all(),
                )
            )
        )

    def get_queryset(self):
        """Return all non-deleted issues in the workspace.

        The workspace is identified by ``kwargs["slug"]``; further
        filtering happens in :meth:`list`.
        """
        return Issue.issue_objects.filter(workspace__slug=self.kwargs.get("slug"))

    @method_decorator(gzip_page)
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        """List workspace issues filtered by both legacy and modern filter pipelines.

        Composes :func:`plane.utils.issue_filters.issue_filters` with the
        modern :class:`plane.utils.filters.ComplexFilterBackend` /
        :class:`plane.utils.filters.IssueFilterSet`. Applies role-aware
        project-visibility filtering, annotates rows with computed
        counts, orders via
        :func:`plane.utils.order_queryset.order_issue_queryset`, and
        returns a paginated gzip-compressed
        :class:`plane.app.serializers.ViewIssueListSerializer` payload.
        """
        issue_queryset = self.get_queryset()

        # Apply filtering from filterset
        issue_queryset = self.filter_queryset(issue_queryset)

        order_by_param = request.GET.get("order_by", "-created_at")

        # Apply legacy filters
        filters = issue_filters(request.query_params, "GET")
        issue_queryset = issue_queryset.filter(**filters)

        # Get common project permission filters
        permission_filters = self._get_project_permission_filters()
        # Apply project permission filters to the issue queryset
        issue_queryset = issue_queryset.filter(permission_filters)

        # Base query for the counts
        total_issue_count_queryset = copy.deepcopy(issue_queryset)
        total_issue_count_queryset = total_issue_count_queryset.only("id")

        # Apply annotations to the issue queryset
        issue_queryset = self.apply_annotations(issue_queryset)

        # Issue queryset
        issue_queryset, order_by_param = order_issue_queryset(
            issue_queryset=issue_queryset, order_by_param=order_by_param
        )

        # List Paginate
        return self.paginate(
            order_by=order_by_param,
            request=request,
            queryset=issue_queryset,
            on_results=lambda issues: ViewIssueListSerializer(issues, many=True).data,
            total_count_queryset=total_issue_count_queryset,
        )


class IssueViewViewSet(BaseViewSet):
    """Project-level saved-view CRUD endpoint.

    Resource managed:
        Project-scoped :class:`plane.db.models.IssueView` rows (those
        with a non-null ``project_id``). Mirrors
        :class:`WorkspaceViewViewSet` but scopes everything to a single
        project and additionally annotates each row with an
        ``is_favorite`` flag correlated against
        :class:`plane.db.models.UserFavorite`.

    HTTP methods + URL patterns:
        * ``GET    /api/workspaces/<slug>/projects/<project_id>/views/``                 -> list
        * ``POST   /api/workspaces/<slug>/projects/<project_id>/views/``                 -> create
        * ``GET    /api/workspaces/<slug>/projects/<project_id>/views/<uuid:pk>/``       -> retrieve
        * ``PUT    /api/workspaces/<slug>/projects/<project_id>/views/<uuid:pk>/``       -> update (inherited)
        * ``PATCH  /api/workspaces/<slug>/projects/<project_id>/views/<uuid:pk>/``       -> partial_update
        * ``DELETE /api/workspaces/<slug>/projects/<project_id>/views/<uuid:pk>/``       -> destroy

    Request body (POST / PATCH; same shape as :class:`WorkspaceViewViewSet`):
        Accepts ``name`` (required), ``description``, ``filters``,
        ``display_filters``, ``display_properties``, ``rich_filters``,
        ``sort_order``, ``logo_props``. Read-only fields and computed
        ``query`` JSON behave identically to the workspace variant.

    Response shape:
        :class:`plane.app.serializers.IssueViewSerializer` output with
        the ``is_favorite`` boolean populated via an ``Exists`` subquery.

    Permissions:
        Method-level via :func:`plane.app.permissions.allow_permission`
        at project scope (the default ``level="PROJECT"``):

        * :meth:`list`           -- ADMIN, MEMBER, GUEST.
        * :meth:`retrieve`       -- ADMIN, MEMBER, GUEST (with the
          guest-visibility narrowing applied in-method).
        * :meth:`partial_update` -- creator-only
          (``allowed_roles=[]``, ``creator=True``) **and** the in-method
          owner check rejects non-owners.
        * :meth:`destroy`        -- project ADMIN
          (``ProjectMember.role == 20``, ``is_active=True``) **or** the
          view's creator.
        * :meth:`create`         -- inherited from ``ModelViewSet``;
          ``perform_create`` forces ``owned_by = request.user``.

    get_queryset filter logic:
        Returns ``IssueView`` rows where:

        * ``workspace.slug == kwargs["slug"]``;
        * ``project_id == kwargs["project_id"]``;
        * the user has an active ``ProjectMember`` row;
        * the project is not archived (``archived_at IS NULL``);
        * (``owned_by == request.user`` OR ``access == 1`` [Public]);

        with ``is_favorite`` annotated from a correlated
        ``UserFavorite`` subquery and ordered by ``-is_favorite, name``.
        :meth:`list` further restricts the queryset to the caller's own
        views when the caller is a project GUEST (``role == 5``) and the
        project's ``guest_view_all_features`` flag is False.

    Side effects (retrieve):
        ``recent_visited_task`` Celery task is dispatched via RabbitMQ
        (worker module :mod:`plane.bgtasks.recent_visited_task`).

    Cross-references:
        * Serializer: ``IssueViewSerializer`` in
          ``apps/api/plane/app/serializers/view.py``.
        * Models: ``IssueView`` in
          ``apps/api/plane/db/models/view.py``;
          ``ProjectMember`` in
          ``apps/api/plane/db/models/project.py``;
          ``UserFavorite`` in
          ``apps/api/plane/db/models/favorite.py``.
        * Permissions: ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * Celery task:
          ``apps/api/plane/bgtasks/recent_visited_task.py`` (queued
          via RabbitMQ).
        * URL registration:
          ``apps/api/plane/app/urls/views.py``.
    """

    serializer_class = IssueViewSerializer
    model = IssueView

    def perform_create(self, serializer):
        """Persist a new project-level view from request context.

        Resolves ``project_id`` from the URL and forces ``owned_by`` to
        the requesting user.
        """
        serializer.save(project_id=self.kwargs.get("project_id"), owned_by=self.request.user)

    def get_queryset(self):
        """Return project-level views visible to the requester.

        Filters by ``workspace.slug``, ``project_id``, active
        ``ProjectMember``, non-archived project, and
        (``owned_by == request.user`` OR ``access == 1`` [Public]).
        Annotates ``is_favorite`` from a correlated ``UserFavorite``
        subquery and orders favorites first.
        """
        subquery = UserFavorite.objects.filter(
            user=self.request.user,
            entity_identifier=OuterRef("pk"),
            entity_type="view",
            project_id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        )
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .filter(Q(owned_by=self.request.user) | Q(access=1))
            .select_related("project")
            .select_related("workspace")
            .annotate(is_favorite=Exists(subquery))
            .order_by("-is_favorite", "name")
            .distinct()
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        """List project-level views visible to the caller.

        Restricts to the caller's own views when the caller is a project
        GUEST (``ProjectMember.role == 5``) AND the project's
        ``guest_view_all_features`` flag is False.
        """
        queryset = self.get_queryset()
        project = Project.objects.get(id=project_id)
        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=5,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
        ):
            queryset = queryset.filter(owned_by=request.user)
        fields = [field for field in request.GET.get("fields", "").split(",") if field]
        views = IssueViewSerializer(queryset, many=True, fields=fields if fields else None).data
        return Response(views, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def retrieve(self, request, slug, project_id, pk):
        """Return the requested project view and record the visit asynchronously.

        Enforces guest visibility: returns HTTP 403 when the caller is a
        project GUEST (``ProjectMember.role == 5``), the project's
        ``guest_view_all_features`` flag is False, AND the caller is not
        the view's ``owned_by``. Enqueues
        :func:`plane.bgtasks.recent_visited_task.recent_visited_task` on
        Celery (via RabbitMQ) to update the user's recent-visit log.
        """
        issue_view = self.get_queryset().filter(pk=pk, project_id=project_id).first()
        project = Project.objects.get(id=project_id)
        """
        if the role is guest and guest_view_all_features is false and owned by is not 
        the requesting user then dont show the view
        """

        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=5,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
            and not issue_view.owned_by == request.user
        ):
            return Response(
                {"error": "You are not allowed to view this issue"},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = IssueViewSerializer(issue_view)
        recent_visited_task.delay(
            slug=slug,
            project_id=project_id,
            entity_name="view",
            entity_identifier=pk,
            user_id=request.user.id,
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[], creator=True, model=IssueView)
    def partial_update(self, request, slug, project_id, pk):
        """Update a project-level view inside a transaction.

        Acquires a row-level ``SELECT FOR UPDATE`` lock on the target
        view, rejects the request with HTTP 400 if the view is
        ``is_locked``, and rejects non-owner requests with HTTP 400 even
        when the creator-only decorator would otherwise grant access.
        """
        with transaction.atomic():
            issue_view = IssueView.objects.select_for_update().get(pk=pk, workspace__slug=slug, project_id=project_id)

            if issue_view.is_locked:
                return Response({"error": "view is locked"}, status=status.HTTP_400_BAD_REQUEST)

            # Only update the view if owner is updating
            if issue_view.owned_by_id != request.user.id:
                return Response(
                    {"error": "Only the owner of the view can update the view"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            serializer = IssueViewSerializer(issue_view, data=request.data, partial=True)

            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=IssueView)
    def destroy(self, request, slug, project_id, pk):
        """Hard-delete a project-level view and cascade-clean its ``UserFavorite`` and ``UserRecentVisit`` rows.

        Allowed only when the requester is a project admin
        (``ProjectMember.role == 20``, ``is_active=True``) OR the
        original ``owned_by`` user. The ``UserRecentVisit`` cleanup uses
        ``soft=False`` to hard-delete the visit row.
        """
        project_view = IssueView.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=20,
                is_active=True,
            ).exists()
            or project_view.owned_by_id == request.user.id
        ):
            project_view.delete()
            # Delete the user favorite view
            UserFavorite.objects.filter(
                project_id=project_id,
                workspace__slug=slug,
                entity_identifier=pk,
                entity_type="view",
            ).delete()
            # Delete the page from recent visit
            UserRecentVisit.objects.filter(
                project_id=project_id,
                workspace__slug=slug,
                entity_identifier=pk,
                entity_name="view",
            ).delete(soft=False)
        else:
            return Response(
                {"error": "Only admin or owner can delete the view"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueViewFavoriteViewSet(BaseViewSet):
    """Per-user favorite toggle for project-level saved views.

    Resource managed:
        :class:`plane.db.models.UserFavorite` rows with
        ``entity_type="view"``; one row per (user, project, view) tuple
        records that the user has starred the view in the "Views" UI.

    HTTP methods + URL patterns:
        * ``GET    .../projects/<project_id>/user-favorite-views/`` -> list (inherited from ``ModelViewSet``)
        * ``POST   .../projects/<project_id>/user-favorite-views/`` -> create
        * ``DELETE .../projects/<project_id>/user-favorite-views/<uuid:view_id>/`` -> destroy

        URLs are rooted at ``/api/workspaces/<slug>/``.

    Request body (POST):
        * ``view`` (uuid, required) -- the ``IssueView.id`` to mark as a
          favorite. Becomes the ``UserFavorite.entity_identifier``.

    Response shape:
        * ``POST``   -- HTTP 204 with empty body.
        * ``DELETE`` -- HTTP 204 with empty body.

    Permissions:
        :meth:`create` and :meth:`destroy` both require project ADMIN or
        MEMBER (``ROLE.ADMIN``, ``ROLE.MEMBER``). GUEST role is
        intentionally excluded.

    get_queryset filter logic:
        Filters to the calling user's own favorites in the addressed
        workspace, with the foreign-key target ``view`` select-joined to
        avoid N+1 queries on serialization.

    Deletion semantics:
        :meth:`destroy` hard-deletes the matching ``UserFavorite`` row
        via ``delete(soft=False)``; there is no archive / restore path
        for an unfavorited view.
    """

    model = UserFavorite

    def get_queryset(self):
        """Return the calling user's ``UserFavorite`` rows for the addressed workspace.

        The ``view`` relation is select-joined to avoid N+1 queries on
        serialization.
        """
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(user=self.request.user)
            .select_related("view")
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id):
        """Mark the view identified by ``request.data["view"]`` as a favorite.

        Creates a ``UserFavorite`` row for the calling user in the
        addressed project; returns HTTP 204 on success.
        """
        _ = UserFavorite.objects.create(
            user=request.user,
            entity_identifier=request.data.get("view"),
            entity_type="view",
            project_id=project_id,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, view_id):
        """Hard-delete the calling user's favorite for ``view_id``.

        Uses ``delete(soft=False)`` to bypass the soft-delete pattern;
        returns HTTP 204 on success.
        """
        view_favorite = UserFavorite.objects.get(
            project=project_id,
            user=request.user,
            workspace__slug=slug,
            entity_type="view",
            entity_identifier=view_id,
        )
        view_favorite.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)
