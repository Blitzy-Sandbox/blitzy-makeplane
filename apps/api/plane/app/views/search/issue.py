# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Issue-scoped search endpoint for issue picker, sub-issue link picker, and mention autocomplete flows.

Provides ``IssueSearchEndpoint`` (``GET /api/workspaces/<slug>/projects/<project_id>/search-issues/``)
backed by PostgreSQL ``icontains`` matching via ``plane.utils.issue_search.search_issues`` —
no Elasticsearch / Algolia is used. The endpoint composes ``Issue.issue_objects`` querysets
constrained by workspace membership, active project membership, and non-archived projects, then
layers caller-driven exclusions (parent / relation / sub-issue / cycle / module / target_date).

Responses are intentionally uncached: query parameters are too parameterized to benefit from
HTTP / Redis caching. Heavy queries route through the read replica when ``use_read_replica = True``
is set on the view (inherited from ``ReadReplicaControlMixin`` via ``BaseAPIView``).
"""

# Django imports
from django.db.models import Q, QuerySet

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .base import BaseAPIView
from plane.db.models import Issue, ProjectMember, IssueRelation
from plane.utils.issue_search import search_issues


class IssueSearchEndpoint(BaseAPIView):
    """Search issues within a workspace/project for picker, relation, and mention UIs.

    HTTP methods:
        GET — list matching issues (up to 100, projected to picker-friendly fields).

    URL pattern:
        ``/api/workspaces/<str:slug>/projects/<uuid:project_id>/search-issues/`` registered
        in ``apps/api/plane/app/urls/search.py`` as ``project-issue-search``.

    Query parameters (all optional unless noted):
        search (str): Free-text query forwarded to ``search_issues`` for ``name`` /
            ``project__identifier`` ``icontains`` matching and whole-integer ``sequence_id``
            matching.
        workspace_search (str): When ``"false"`` (default), restricts results to ``project_id``;
            any other value broadens to the whole workspace.
        parent (str): When ``"true"`` together with ``issue_id``, excludes the issue itself,
            its parent, and any of its children — used by the parent-issue picker.
        issue_relation (str): When ``"true"`` together with ``issue_id``, excludes the issue
            and every issue already linked via ``IssueRelation`` (both directions).
        sub_issue (str): When ``"true"`` together with ``issue_id``, restricts to root issues
            (``parent__isnull=True``) and excludes the current issue and its parent — used
            by the sub-issue link picker.
        cycle (str): When ``"true"``, excludes issues already in a non-deleted cycle — used
            when adding issues to a cycle.
        module (str): Module UUID; when set, excludes issues already in that module — used
            when adding issues to a module.
        target_date (str): When ``"none"``, restricts to issues with ``target_date IS NULL``.
        issue_id (str): UUID of the contextual issue for ``parent`` / ``issue_relation`` /
            ``sub_issue`` exclusions.

    Response shape (200 OK):
        JSON array of up to 100 objects with keys ``name``, ``id``, ``start_date``,
        ``sequence_id``, ``project__name``, ``project__identifier``, ``project_id``,
        ``workspace__slug``, ``state__name``, ``state__group``, ``state__color``.

    Permissions:
        ``permission_classes = [IsAuthenticated]`` inherited from ``BaseAPIView``;
        the view additionally restricts results to the requesting user's active project
        memberships and, for guest role members (``role=5``), narrows results to issues
        the user authored.

    Filter logic:
        Base queryset is ``Issue.issue_objects.filter(workspace__slug=slug,
        project__project_projectmember__member=request.user,
        project__project_projectmember__is_active=True,
        project__archived_at__isnull=True)``; subsequent helpers conditionally narrow
        based on the query parameters above.

    Request body:
        None (GET only); all parameters are supplied as query string.

    Cross-references:
        * Models: ``Issue``, ``IssueRelation`` in
          ``apps/api/plane/db/models/issue.py``;
          ``Project``, ``ProjectMember`` in
          ``apps/api/plane/db/models/project.py``;
          ``CycleIssue`` in ``apps/api/plane/db/models/cycle.py``;
          ``ModuleIssue`` in ``apps/api/plane/db/models/module.py``.
        * URL registration:
          ``apps/api/plane/app/urls/search.py``.
    """

    def filter_issues_by_project(self, project_id: int, issues: QuerySet) -> QuerySet:
        """Restrict the queryset to issues belonging to ``project_id``."""
        issues = issues.filter(project_id=project_id)

        return issues

    def search_issues_by_query(self, query: str, issues: QuerySet) -> QuerySet:
        """Apply the shared ``search_issues`` helper to filter by ``name`` / ``sequence_id`` / project identifier."""
        issues = search_issues(query, issues)

        return issues

    def search_issues_and_excluding_parent(self, issues: QuerySet, issue_id: str) -> QuerySet:
        """Exclude ``issue_id`` itself, its parent, and its direct children for the parent-issue picker."""
        issue = Issue.issue_objects.filter(pk=issue_id).first()
        if issue:
            issues = issues.filter(~Q(pk=issue_id), ~Q(pk=issue.parent_id), ~Q(parent_id=issue_id))
        return issues

    def filter_issues_excluding_related_issues(self, issue_id: str, issues: QuerySet) -> QuerySet:
        """Exclude ``issue_id`` and every issue already linked via ``IssueRelation`` (both directions)."""
        issue = Issue.issue_objects.filter(pk=issue_id).first()
        related_issue_ids = (
            IssueRelation.objects.filter(Q(related_issue=issue) | Q(issue=issue))
            .values_list("issue_id", "related_issue_id")
            .distinct()
        )

        related_issue_ids = [item for sublist in related_issue_ids for item in sublist]
        related_issue_ids.append(issue_id)

        if issue:
            issues = issues.exclude(pk__in=related_issue_ids)

        return issues

    def filter_root_issues_only(self, issue_id: str, issues: QuerySet) -> QuerySet:
        """Restrict to root issues (``parent__isnull=True``) and exclude ``issue_id`` plus its parent."""
        issue = Issue.issue_objects.filter(pk=issue_id).first()
        if issue:
            issues = issues.filter(~Q(pk=issue_id), parent__isnull=True)
        if issue.parent:
            issues = issues.filter(~Q(pk=issue.parent_id))
        return issues

    def exclude_issues_in_cycles(self, issues: QuerySet) -> QuerySet:
        """Exclude issues already attached to a non-deleted cycle."""
        issues = issues.exclude(Q(issue_cycle__isnull=False) & Q(issue_cycle__deleted_at__isnull=True))
        return issues

    def exclude_issues_in_module(self, issues: QuerySet, module: str) -> QuerySet:
        """Exclude issues already attached to the given ``module`` (UUID) via a non-deleted ``IssueModule`` row."""
        issues = issues.exclude(Q(issue_module__module=module) & Q(issue_module__deleted_at__isnull=True))
        return issues

    def filter_issues_without_target_date(self, issues: QuerySet) -> QuerySet:
        """Restrict to issues whose ``target_date`` is ``NULL``."""
        issues = issues.filter(target_date__isnull=True)
        return issues

    def get(self, request, slug, project_id):
        """Return up to 100 matching issues filtered by the documented query parameters."""
        query = request.query_params.get("search", False)
        workspace_search = request.query_params.get("workspace_search", "false")
        parent = request.query_params.get("parent", "false")
        issue_relation = request.query_params.get("issue_relation", "false")
        cycle = request.query_params.get("cycle", "false")
        module = request.query_params.get("module", False)
        sub_issue = request.query_params.get("sub_issue", "false")
        target_date = request.query_params.get("target_date", True)
        issue_id = request.query_params.get("issue_id", False)

        issues = Issue.issue_objects.filter(
            workspace__slug=slug,
            project__project_projectmember__member=self.request.user,
            project__project_projectmember__is_active=True,
            project__archived_at__isnull=True,
        )

        if workspace_search == "false":
            issues = self.filter_issues_by_project(project_id, issues)

        if query:
            issues = self.search_issues_by_query(query, issues)

        if parent == "true" and issue_id:
            issues = self.search_issues_and_excluding_parent(issues, issue_id)

        if issue_relation == "true" and issue_id:
            issues = self.filter_issues_excluding_related_issues(issue_id, issues)

        if sub_issue == "true" and issue_id:
            issues = self.filter_root_issues_only(issue_id, issues)

        if cycle == "true":
            issues = self.exclude_issues_in_cycles(issues)

        if module:
            issues = self.exclude_issues_in_module(issues, module)

        if target_date == "none":
            issues = self.filter_issues_without_target_date(issues)

        if ProjectMember.objects.filter(
            project_id=project_id, member=self.request.user, is_active=True, role=5
        ).exists():
            issues = issues.filter(created_by=self.request.user)

        return Response(
            issues.values(
                "name",
                "id",
                "start_date",
                "sequence_id",
                "project__name",
                "project__identifier",
                "project_id",
                "workspace__slug",
                "state__name",
                "state__group",
                "state__color",
            )[:100],
            status=status.HTTP_200_OK,
        )
