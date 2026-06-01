# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-wide and entity-typed search endpoints for global discovery, command palette, and mention pickers.

Defines two ``BaseAPIView`` subclasses:

* ``GlobalSearchEndpoint`` — ``GET /api/workspaces/<slug>/search/`` — dispatches the
  ``search`` query to per-entity helpers (workspace, project, issue, cycle, module,
  issue_view, page, intake) and returns ``{"results": {<entity>: [...], ...}}``.
* ``SearchEndpoint`` — ``GET /api/workspaces/<slug>/entity-search/`` — returns typed
  result lists keyed by ``query_type`` (``user_mention``, ``project``, ``issue``,
  ``cycle``, ``module``, ``page``), branching between project-scoped and workspace-scoped
  variants based on whether ``project_id`` is supplied.

All matching is performed with PostgreSQL ``icontains`` against indexed columns — no
Elasticsearch / Algolia integration. Responses are **not cached**: query parameters
(``search``, ``entities``, ``query_type``, ``count``, ``project_id``,
``workspace_search``) yield extremely high cardinality and Redis caching would have
near-zero hit rate. Heavy queries can route to the read replica when
``use_read_replica = True`` is set on the view (inherited from
``ReadReplicaControlMixin`` via ``BaseAPIView`` — not currently activated on these
endpoints).

Permission filtering is implemented inline via ``project_projectmember__member`` /
``workspace_member__member`` joins; access to the endpoints themselves is gated by
the default ``IsAuthenticated`` permission inherited from ``BaseAPIView``.
"""

# Python imports
import re

# Django imports
from django.db import models
from django.db.models import (
    Q,
    OuterRef,
    Subquery,
    Value,
    UUIDField,
    CharField,
    When,
    Case,
)
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models.functions import Coalesce, Concat
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    Workspace,
    Project,
    Issue,
    Cycle,
    Module,
    Page,
    IssueView,
    ProjectMember,
    ProjectPage,
    WorkspaceMember,
)


class GlobalSearchEndpoint(BaseAPIView):
    """Workspace-wide multi-entity search for the global command palette / search bar.

    HTTP methods:
        GET — returns matching rows grouped by entity type.

    URL pattern:
        ``/api/workspaces/<str:slug>/search/`` registered in
        ``apps/api/plane/app/urls/search.py`` as ``global-search``.

    Query parameters:
        search (str, optional): Substring to match against entity ``name`` and
            (for issues / intake) ``project__identifier`` plus whole-integer
            ``sequence_id`` tokens. When omitted or empty, every helper returns
            its full visibility-filtered queryset.
        entities (str, optional): Comma-separated subset of
            ``{workspace, project, issue, cycle, module, issue_view, page,
            intake}``. Unknown entries are silently dropped. When omitted, all
            eight helpers run.
        workspace_search (str, optional, default ``"false"``): When ``"false"``
            and ``project_id`` is set, restricts most helpers to that project;
            any other value broadens to the whole workspace.
        project_id (str, optional): UUID of a project; only consulted when
            ``workspace_search == "false"``.

    Response shape (200 OK):
        ``{"results": {"<entity>": [<row>, ...], ...}}`` where ``<row>`` is the
        ``.values(...)`` projection produced by the corresponding helper.

    Permissions:
        Inherits ``permission_classes = [IsAuthenticated]`` from ``BaseAPIView``.
        Per-entity helpers additionally enforce active project / workspace
        membership and archive exclusion via ORM joins.

    Filter logic:
        Each ``filter_*`` helper applies (a) the ``Q(name__icontains=...) | ...``
        chain derived from ``search``, (b) workspace slug scoping via
        ``workspace__slug=slug``, (c) active membership scoping via
        ``project_projectmember__member=request.user`` + ``is_active=True``, and
        (d) archive exclusion via ``project__archived_at__isnull=True``. Issue
        and intake results are capped at 100 rows.
    """

    def filter_workspaces(self, query, _slug, _project_id, _workspace_search):
        """Return workspaces whose ``name`` matches ``query`` and where the user is a member."""
        fields = ["name"]
        q = Q()
        if query:
            for field in fields:
                q |= Q(**{f"{field}__icontains": query})
        return (
            Workspace.objects.filter(q, workspace_member__member=self.request.user)
            .order_by("-created_at")
            .distinct()
            .values("name", "id", "slug")
        )

    def filter_projects(self, query, slug, _project_id, _workspace_search):
        """Return active, non-archived projects in ``slug`` whose ``name``/``identifier`` matches ``query``."""
        fields = ["name", "identifier"]
        q = Q()
        if query:
            for field in fields:
                q |= Q(**{f"{field}__icontains": query})
        return (
            Project.objects.filter(
                q,
                project_projectmember__member=self.request.user,
                project_projectmember__is_active=True,
                archived_at__isnull=True,
                workspace__slug=slug,
            )
            .order_by("-created_at")
            .distinct()
            .values("name", "id", "identifier", "workspace__slug")
        )

    def filter_issues(self, query, slug, project_id, workspace_search):
        r"""Return up to 100 issues matching ``query`` in the user's active projects.

        Matches against issue ``name``, ``sequence_id``, and ``project__identifier``.
        When ``workspace_search == "false"`` and ``project_id`` is supplied, results
        are narrowed to that project. Whole-integer ``sequence_id`` tokens are
        extracted with ``re.findall(r"\b\d+\b", ...)`` so decimal fragments are
        not mistaken for issue IDs.
        """
        fields = ["name", "sequence_id", "project__identifier"]
        q = Q()
        if query:
            for field in fields:
                if field == "sequence_id":
                    # Match whole integers only (exclude decimal numbers)
                    sequences = re.findall(r"\b\d+\b", query)
                    for sequence_id in sequences:
                        q |= Q(**{"sequence_id": sequence_id})
                else:
                    q |= Q(**{f"{field}__icontains": query})

        issues = Issue.issue_objects.filter(
            q,
            project__project_projectmember__member=self.request.user,
            project__project_projectmember__is_active=True,
            project__archived_at__isnull=True,
            workspace__slug=slug,
        )

        if workspace_search == "false" and project_id:
            issues = issues.filter(project_id=project_id)

        return issues.distinct().values(
            "name",
            "id",
            "sequence_id",
            "project__identifier",
            "project_id",
            "workspace__slug",
        )[:100]

    def filter_cycles(self, query, slug, project_id, workspace_search):
        """Return cycles matching ``query`` in the user's active projects.

        Project-scoped when ``workspace_search == "false"`` and ``project_id`` is set.
        """
        fields = ["name"]
        q = Q()
        if query:
            for field in fields:
                q |= Q(**{f"{field}__icontains": query})

        cycles = Cycle.objects.filter(
            q,
            project__project_projectmember__member=self.request.user,
            project__project_projectmember__is_active=True,
            project__archived_at__isnull=True,
            workspace__slug=slug,
        )

        if workspace_search == "false" and project_id:
            cycles = cycles.filter(project_id=project_id)

        return (
            cycles.order_by("-created_at")
            .distinct()
            .values("name", "id", "project_id", "project__identifier", "workspace__slug")
        )

    def filter_modules(self, query, slug, project_id, workspace_search):
        """Return modules matching ``query`` in the user's active projects.

        Project-scoped when ``workspace_search == "false"`` and ``project_id`` is set.
        """
        fields = ["name"]
        q = Q()
        if query:
            for field in fields:
                q |= Q(**{f"{field}__icontains": query})

        modules = Module.objects.filter(
            q,
            project__project_projectmember__member=self.request.user,
            project__project_projectmember__is_active=True,
            project__archived_at__isnull=True,
            workspace__slug=slug,
        )

        if workspace_search == "false" and project_id:
            modules = modules.filter(project_id=project_id)

        return (
            modules.order_by("-created_at")
            .distinct()
            .values("name", "id", "project_id", "project__identifier", "workspace__slug")
        )

    def filter_pages(self, query, slug, project_id, workspace_search):
        """Return pages matching ``query``, annotated with per-row project arrays.

        Uses ``ArrayAgg`` + ``Coalesce`` to flatten the M2M ``projects`` relation
        into ``project_ids`` and ``project_identifiers`` arrays. When
        ``workspace_search == "false"`` and ``project_id`` is set, a correlated
        ``ProjectPage`` subquery narrows results to pages explicitly linked to
        that project.
        """
        fields = ["name"]
        q = Q()
        if query:
            for field in fields:
                q |= Q(**{f"{field}__icontains": query})

        pages = (
            Page.objects.filter(
                q,
                projects__project_projectmember__member=self.request.user,
                projects__project_projectmember__is_active=True,
                projects__archived_at__isnull=True,
                workspace__slug=slug,
            )
            .annotate(
                project_ids=Coalesce(
                    ArrayAgg("projects__id", distinct=True, filter=~Q(projects__id=True)),
                    Value([], output_field=ArrayField(UUIDField())),
                )
            )
            .annotate(
                project_identifiers=Coalesce(
                    ArrayAgg(
                        "projects__identifier",
                        distinct=True,
                        filter=~Q(projects__id=True),
                    ),
                    Value([], output_field=ArrayField(CharField())),
                )
            )
        )

        if workspace_search == "false" and project_id:
            project_subquery = ProjectPage.objects.filter(page_id=OuterRef("id"), project_id=project_id).values_list(
                "project_id", flat=True
            )[:1]

            pages = pages.annotate(project_id=Subquery(project_subquery)).filter(project_id=project_id)

        return (
            pages.order_by("-created_at")
            .distinct()
            .values("name", "id", "project_ids", "project_identifiers", "workspace__slug")
        )

    def filter_views(self, query, slug, project_id, workspace_search):
        """Return issue views matching ``query`` in the user's active projects.

        Project-scoped when ``workspace_search == "false"`` and ``project_id`` is set.
        """
        fields = ["name"]
        q = Q()
        if query:
            for field in fields:
                q |= Q(**{f"{field}__icontains": query})

        issue_views = IssueView.objects.filter(
            q,
            project__project_projectmember__member=self.request.user,
            project__project_projectmember__is_active=True,
            project__archived_at__isnull=True,
            workspace__slug=slug,
        )

        if workspace_search == "false" and project_id:
            issue_views = issue_views.filter(project_id=project_id)

        return (
            issue_views.order_by("-created_at")
            .distinct()
            .values("name", "id", "project_id", "project__identifier", "workspace__slug")
        )

    def filter_intakes(self, query, slug, project_id, workspace_search):
        """Return up to 100 intake-pending issues matching ``query``.

        Restricted to ``issue_intake__status`` in {0 (pending), -2 (snoozed)}.
        ``Issue.objects`` (the full manager) is used instead of
        ``Issue.issue_objects`` so intake-only rows excluded by the default
        manager are still searchable. Whole-integer ``sequence_id`` tokens are
        extracted with ``re.findall`` for the same reason as ``filter_issues``.
        """
        fields = ["name", "sequence_id", "project__identifier"]
        q = Q()
        if query:
            for field in fields:
                if field == "sequence_id":
                    # Match whole integers only (exclude decimal numbers)
                    sequences = re.findall(r"\b\d+\b", query)
                    for sequence_id in sequences:
                        q |= Q(**{"sequence_id": sequence_id})
                else:
                    q |= Q(**{f"{field}__icontains": query})

        issues = Issue.objects.filter(
            q,
            project__project_projectmember__member=self.request.user,
            project__project_projectmember__is_active=True,
            project__archived_at__isnull=True,
            workspace__slug=slug,
        ).filter(models.Q(issue_intake__status=0) | models.Q(issue_intake__status=-2))

        if workspace_search == "false" and project_id:
            issues = issues.filter(project_id=project_id)

        return (
            issues.order_by("-created_at")
            .distinct()
            .values(
                "name",
                "id",
                "sequence_id",
                "project__identifier",
                "project_id",
                "workspace__slug",
            )[:100]
        )

    def get(self, request, slug):
        """Dispatch ``search`` to each helper named in ``entities`` and return ``{"results": {<entity>: [...]}}``."""
        query = request.query_params.get("search", False)
        entities_param = request.query_params.get("entities")
        workspace_search = request.query_params.get("workspace_search", "false")
        project_id = request.query_params.get("project_id", False)

        MODELS_MAPPER = {
            "workspace": self.filter_workspaces,
            "project": self.filter_projects,
            "issue": self.filter_issues,
            "cycle": self.filter_cycles,
            "module": self.filter_modules,
            "issue_view": self.filter_views,
            "page": self.filter_pages,
            "intake": self.filter_intakes,
        }

        # Determine which entities to search
        if entities_param:
            requested_entities = [e.strip() for e in entities_param.split(",") if e.strip()]
            requested_entities = [e for e in requested_entities if e in MODELS_MAPPER]
        else:
            requested_entities = list(MODELS_MAPPER.keys())

        results = {}

        for entity in requested_entities:
            func = MODELS_MAPPER.get(entity)
            if func:
                results[entity] = func(query or None, slug, project_id, workspace_search)

        return Response({"results": results}, status=status.HTTP_200_OK)


class SearchEndpoint(BaseAPIView):
    """Entity-typed search for the command palette and ``@mention`` autocomplete pickers.

    HTTP methods:
        GET — returns lists keyed by the requested ``query_type``.

    URL pattern:
        ``/api/workspaces/<str:slug>/entity-search/`` registered in
        ``apps/api/plane/app/urls/search.py`` as ``entity-search``.

    Query parameters:
        query (str, optional): Substring to match against entity-specific fields
            (member display names for ``user_mention``; ``name``/``identifier``
            for ``project``; ``name``/``sequence_id``/``project__identifier`` for
            ``issue``; ``name`` for cycle / module / page). Empty / missing
            yields the unfiltered visible set.
        query_type (str, optional, default ``"user_mention"``): Comma-separated
            list drawn from ``{user_mention, project, issue, cycle, module,
            page}``. Each type is processed independently and contributes one
            key to the response.
        count (int, optional, default ``5``): Per-type result cap.
        project_id (str, optional): UUID of a project. When present, selects
            the project-scoped branch: members come from ``ProjectMember``,
            cycles get ``status`` annotation derived from ``start_date`` /
            ``end_date``, and pages are filtered to ``access=0`` (public) for
            that project. When absent, selects the workspace-scoped branch:
            members come from ``WorkspaceMember`` and pages are restricted to
            ``access=0`` AND ``is_global=True``.

    Response shape (200 OK):
        ``{<query_type>: [<row>, ...]}`` where each row's keys depend on the
        type. Avatar URLs are computed in-database via ``Case`` / ``When`` /
        ``Concat(Value("/api/assets/v2/static/"), "member__avatar_asset",
        Value("/"))`` falling back to the legacy ``member__avatar`` URL when
        no asset is attached.

    Permissions:
        Inherits ``permission_classes = [IsAuthenticated]`` from ``BaseAPIView``.
        Each branch enforces workspace / project membership through ORM joins
        rather than DRF permission classes.

    Cycle status annotation (project-scoped and workspace-scoped branches):
        ``CURRENT`` when ``start_date <= now <= end_date``; ``UPCOMING`` when
        ``start_date > now``; ``COMPLETED`` when ``end_date < now``; ``DRAFT``
        when both dates are NULL or none of the above match. Computed with
        timezone-aware ``timezone.now()``.

    Notes:
        Project visibility for the ``project`` query_type accepts either active
        membership OR ``network=2`` (workspace-public projects) so that the
        picker surfaces projects a user can browse but has not joined.
    """

    def get(self, request, slug):
        """Branch on ``project_id`` presence and return ``{<query_type>: [...]}`` for each requested type."""
        query = request.query_params.get("query", False)
        query_types = request.query_params.get("query_type", "user_mention").split(",")
        query_types = [qt.strip() for qt in query_types]
        count = int(request.query_params.get("count", 5))
        project_id = request.query_params.get("project_id", None)

        response_data = {}

        if project_id:
            for query_type in query_types:
                if query_type == "user_mention":
                    fields = [
                        "member__first_name",
                        "member__last_name",
                        "member__display_name",
                    ]
                    q = Q()

                    if query:
                        for field in fields:
                            q |= Q(**{f"{field}__icontains": query})

                    users = (
                        ProjectMember.objects.filter(
                            q,
                            is_active=True,
                            workspace__slug=slug,
                            member__is_bot=False,
                            project_id=project_id,
                        )
                        .annotate(
                            member__avatar_url=Case(
                                When(
                                    member__avatar_asset__isnull=False,
                                    then=Concat(
                                        Value("/api/assets/v2/static/"),
                                        "member__avatar_asset",
                                        Value("/"),
                                    ),
                                ),
                                When(
                                    member__avatar_asset__isnull=True,
                                    then="member__avatar",
                                ),
                                default=Value(None),
                                output_field=CharField(),
                            )
                        )
                        .order_by("-created_at")
                    )

                    users = users.distinct().values(
                        "member__avatar_url",
                        "member__display_name",
                        "member__id",
                    )

                    response_data["user_mention"] = list(users[:count])

                elif query_type == "project":
                    fields = ["name", "identifier"]
                    q = Q()

                    if query:
                        for field in fields:
                            q |= Q(**{f"{field}__icontains": query})
                    projects = (
                        Project.objects.filter(
                            q,
                            Q(project_projectmember__member=self.request.user) | Q(network=2),
                            workspace__slug=slug,
                        )
                        .order_by("-created_at")
                        .distinct()
                        .values("name", "id", "identifier", "logo_props", "workspace__slug")[:count]
                    )
                    response_data["project"] = list(projects)

                elif query_type == "issue":
                    fields = ["name", "sequence_id", "project__identifier"]
                    q = Q()

                    if query:
                        for field in fields:
                            if field == "sequence_id":
                                sequences = re.findall(r"\b\d+\b", query)
                                for sequence_id in sequences:
                                    q |= Q(**{"sequence_id": sequence_id})
                            else:
                                q |= Q(**{f"{field}__icontains": query})

                    issues = (
                        Issue.issue_objects.filter(
                            q,
                            project__project_projectmember__member=self.request.user,
                            project__project_projectmember__is_active=True,
                            workspace__slug=slug,
                            project_id=project_id,
                        )
                        .order_by("-created_at")
                        .distinct()
                        .values(
                            "name",
                            "id",
                            "sequence_id",
                            "project__identifier",
                            "project_id",
                            "priority",
                            "state_id",
                            "type_id",
                        )[:count]
                    )
                    response_data["issue"] = list(issues)

                elif query_type == "cycle":
                    fields = ["name"]
                    q = Q()

                    if query:
                        for field in fields:
                            q |= Q(**{f"{field}__icontains": query})

                    cycles = (
                        Cycle.objects.filter(
                            q,
                            project__project_projectmember__member=self.request.user,
                            project__project_projectmember__is_active=True,
                            workspace__slug=slug,
                            project_id=project_id,
                        )
                        .annotate(
                            status=Case(
                                When(
                                    Q(start_date__lte=timezone.now()) & Q(end_date__gte=timezone.now()),
                                    then=Value("CURRENT"),
                                ),
                                When(
                                    start_date__gt=timezone.now(),
                                    then=Value("UPCOMING"),
                                ),
                                When(end_date__lt=timezone.now(), then=Value("COMPLETED")),
                                When(
                                    Q(start_date__isnull=True) & Q(end_date__isnull=True),
                                    then=Value("DRAFT"),
                                ),
                                default=Value("DRAFT"),
                                output_field=CharField(),
                            )
                        )
                        .order_by("-created_at")
                        .distinct()
                        .values(
                            "name",
                            "id",
                            "project_id",
                            "project__identifier",
                            "status",
                            "workspace__slug",
                        )[:count]
                    )
                    response_data["cycle"] = list(cycles)

                elif query_type == "module":
                    fields = ["name"]
                    q = Q()

                    if query:
                        for field in fields:
                            q |= Q(**{f"{field}__icontains": query})

                    modules = (
                        Module.objects.filter(
                            q,
                            project__project_projectmember__member=self.request.user,
                            project__project_projectmember__is_active=True,
                            workspace__slug=slug,
                            project_id=project_id,
                        )
                        .order_by("-created_at")
                        .distinct()
                        .values(
                            "name",
                            "id",
                            "project_id",
                            "project__identifier",
                            "status",
                            "workspace__slug",
                        )[:count]
                    )
                    response_data["module"] = list(modules)

                elif query_type == "page":
                    fields = ["name"]
                    q = Q()

                    if query:
                        for field in fields:
                            q |= Q(**{f"{field}__icontains": query})

                    pages = (
                        Page.objects.filter(
                            q,
                            projects__project_projectmember__member=self.request.user,
                            projects__project_projectmember__is_active=True,
                            projects__id=project_id,
                            workspace__slug=slug,
                            access=0,
                        )
                        .order_by("-created_at")
                        .distinct()
                        .values(
                            "name",
                            "id",
                            "logo_props",
                            "projects__id",
                            "workspace__slug",
                        )[:count]
                    )
                    response_data["page"] = list(pages)
            return Response(response_data, status=status.HTTP_200_OK)

        else:
            for query_type in query_types:
                if query_type == "user_mention":
                    fields = [
                        "member__first_name",
                        "member__last_name",
                        "member__display_name",
                    ]
                    q = Q()

                    if query:
                        for field in fields:
                            q |= Q(**{f"{field}__icontains": query})
                    users = (
                        WorkspaceMember.objects.filter(
                            q,
                            is_active=True,
                            workspace__slug=slug,
                            member__is_bot=False,
                        )
                        .annotate(
                            member__avatar_url=Case(
                                When(
                                    member__avatar_asset__isnull=False,
                                    then=Concat(
                                        Value("/api/assets/v2/static/"),
                                        "member__avatar_asset",
                                        Value("/"),
                                    ),
                                ),
                                When(
                                    member__avatar_asset__isnull=True,
                                    then="member__avatar",
                                ),
                                default=Value(None),
                                output_field=models.CharField(),
                            )
                        )
                        .order_by("-created_at")
                        .values("member__avatar_url", "member__display_name", "member__id")[:count]
                    )
                    response_data["user_mention"] = list(users)

                elif query_type == "project":
                    fields = ["name", "identifier"]
                    q = Q()

                    if query:
                        for field in fields:
                            q |= Q(**{f"{field}__icontains": query})
                    projects = (
                        Project.objects.filter(
                            q,
                            Q(project_projectmember__member=self.request.user) | Q(network=2),
                            workspace__slug=slug,
                        )
                        .order_by("-created_at")
                        .distinct()
                        .values("name", "id", "identifier", "logo_props", "workspace__slug")[:count]
                    )
                    response_data["project"] = list(projects)

                elif query_type == "issue":
                    fields = ["name", "sequence_id", "project__identifier"]
                    q = Q()

                    if query:
                        for field in fields:
                            if field == "sequence_id":
                                sequences = re.findall(r"\b\d+\b", query)
                                for sequence_id in sequences:
                                    q |= Q(**{"sequence_id": sequence_id})
                            else:
                                q |= Q(**{f"{field}__icontains": query})

                    issues = (
                        Issue.issue_objects.filter(
                            q,
                            project__project_projectmember__member=self.request.user,
                            project__project_projectmember__is_active=True,
                            workspace__slug=slug,
                        )
                        .order_by("-created_at")
                        .distinct()
                        .values(
                            "name",
                            "id",
                            "sequence_id",
                            "project__identifier",
                            "project_id",
                            "priority",
                            "state_id",
                            "type_id",
                        )[:count]
                    )
                    response_data["issue"] = list(issues)

                elif query_type == "cycle":
                    fields = ["name"]
                    q = Q()

                    if query:
                        for field in fields:
                            q |= Q(**{f"{field}__icontains": query})

                    cycles = (
                        Cycle.objects.filter(
                            q,
                            project__project_projectmember__member=self.request.user,
                            project__project_projectmember__is_active=True,
                            workspace__slug=slug,
                        )
                        .annotate(
                            status=Case(
                                When(
                                    Q(start_date__lte=timezone.now()) & Q(end_date__gte=timezone.now()),
                                    then=Value("CURRENT"),
                                ),
                                When(
                                    start_date__gt=timezone.now(),
                                    then=Value("UPCOMING"),
                                ),
                                When(end_date__lt=timezone.now(), then=Value("COMPLETED")),
                                When(
                                    Q(start_date__isnull=True) & Q(end_date__isnull=True),
                                    then=Value("DRAFT"),
                                ),
                                default=Value("DRAFT"),
                                output_field=CharField(),
                            )
                        )
                        .order_by("-created_at")
                        .distinct()
                        .values(
                            "name",
                            "id",
                            "project_id",
                            "project__identifier",
                            "status",
                            "workspace__slug",
                        )[:count]
                    )
                    response_data["cycle"] = list(cycles)

                elif query_type == "module":
                    fields = ["name"]
                    q = Q()

                    if query:
                        for field in fields:
                            q |= Q(**{f"{field}__icontains": query})

                    modules = (
                        Module.objects.filter(
                            q,
                            project__project_projectmember__member=self.request.user,
                            project__project_projectmember__is_active=True,
                            workspace__slug=slug,
                        )
                        .order_by("-created_at")
                        .distinct()
                        .values(
                            "name",
                            "id",
                            "project_id",
                            "project__identifier",
                            "status",
                            "workspace__slug",
                        )[:count]
                    )
                    response_data["module"] = list(modules)

                elif query_type == "page":
                    fields = ["name"]
                    q = Q()

                    if query:
                        for field in fields:
                            q |= Q(**{f"{field}__icontains": query})

                    pages = (
                        Page.objects.filter(
                            q,
                            projects__project_projectmember__member=self.request.user,
                            projects__project_projectmember__is_active=True,
                            workspace__slug=slug,
                            access=0,
                            is_global=True,
                        )
                        .order_by("-created_at")
                        .distinct()
                        .values(
                            "name",
                            "id",
                            "logo_props",
                            "projects__id",
                            "workspace__slug",
                        )[:count]
                    )
                    response_data["page"] = list(pages)
            return Response(response_data, status=status.HTTP_200_OK)
