# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-level draft-issue endpoints.

Draft issues are workspace-scoped, creator-only scratchpads that can be
edited freely before being promoted to real ``Issue`` rows in a project.
Promotion (``create_draft_to_issue``) moves attachments, optionally links
the issue to a cycle and modules, and emits Celery activity events via
``issue_activity.delay`` (Celery via RabbitMQ, per architectural
context).
"""

# Python imports
import json

# Django imports
from django.utils import timezone
from django.core import serializers
from django.core.serializers.json import DjangoJSONEncoder
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models import Q, UUIDField, Value, Subquery, OuterRef
from django.db.models.functions import Coalesce
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import (
    IssueCreateSerializer,
    DraftIssueCreateSerializer,
    DraftIssueSerializer,
    DraftIssueDetailSerializer,
)
from plane.db.models import (
    Issue,
    DraftIssue,
    CycleIssue,
    ModuleIssue,
    DraftIssueCycle,
    Workspace,
    FileAsset,
)
from .. import BaseViewSet
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.issue_filters import issue_filters
from plane.utils.host import base_host


class WorkspaceDraftIssueViewSet(BaseViewSet):
    """Manage workspace-scoped draft issues created by the caller.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<str:slug>/draft-issues/
        POST   /api/workspaces/<str:slug>/draft-issues/
        GET    /api/workspaces/<str:slug>/draft-issues/<uuid:pk>/
        PATCH  /api/workspaces/<str:slug>/draft-issues/<uuid:pk>/
        DELETE /api/workspaces/<str:slug>/draft-issues/<uuid:pk>/
        POST   /api/workspaces/<str:slug>/draft-to-issue/<uuid:draft_id>/

    Request body (POST/PATCH):
        ``DraftIssueCreateSerializer`` fields -- ``name``, ``project_id``
        (optional on draft, required on promotion), ``description_html``,
        ``priority``, ``state_id``, ``parent_id``, ``assignees``,
        ``labels``, ``cycle_id``, ``module_ids``, ``start_date``,
        ``target_date``, ``estimate_point``.

    Request body (POST ``create_draft_to_issue``):
        ``IssueCreateSerializer`` fields plus optional ``cycle_id`` and
        ``module_ids``; the project comes from the draft itself.

    Response shape:
        list: paginated ``DraftIssueSerializer`` rows, restricted to the
            caller's drafts ordered by ``-created_at``.
        create: subset of draft fields (``id``, ``name``, ``state_id``,
            ``sort_order``, ``completed_at``, ``estimate_point``,
            ``priority``, ``start_date``, ``target_date``, ``project_id``,
            ``parent_id``, ``cycle_id``, ``module_ids``, ``label_ids``,
            ``assignee_ids``, audit fields, ``type_id``,
            ``description_html``).
        partial_update: HTTP 204.
        retrieve: ``DraftIssueDetailSerializer``.
        destroy: HTTP 204.
        create_draft_to_issue: ``IssueCreateSerializer`` on success.

    Permissions:
        list/create: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER,
            ROLE.GUEST], level="WORKSPACE")`` -- any active workspace
            member.
        partial_update: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER],
            creator=True, model=Issue, level="WORKSPACE")`` -- only the
            draft's creator (guests excluded).
        retrieve: ``@allow_permission([ROLE.ADMIN], creator=True,
            model=Issue, level="WORKSPACE")`` -- admin or draft creator.
        destroy: ``@allow_permission([ROLE.ADMIN], creator=True,
            model=DraftIssue, level="WORKSPACE")`` -- admin or draft
            creator.
        create_draft_to_issue: ``@allow_permission([ROLE.ADMIN,
            ROLE.MEMBER], level="WORKSPACE")`` -- guests cannot promote.

    Side effects (``create_draft_to_issue``):
        * Persists a new ``Issue`` via ``IssueCreateSerializer.save()``.
        * Emits ``issue_activity.delay(type="issue.activity.created", ...)``
          (Celery via RabbitMQ).
        * If ``cycle_id`` is supplied, creates a ``CycleIssue`` row and
          emits ``issue_activity.delay(type="cycle.activity.created",
          ...)``.
        * If ``module_ids`` is supplied, bulk-creates ``ModuleIssue`` rows
          (batch size 10) and emits one
          ``issue_activity.delay(type="module.activity.created", ...)``
          per module.
        * Reassigns every ``FileAsset`` with the draft id to the new issue
          and switches ``entity_type`` to ``ISSUE_DESCRIPTION``.
        * Deletes the draft after the issue is wired up.

    Queryset (``get_queryset``):
        Annotates ``cycle_id`` via a deferred subquery against
        ``DraftIssueCycle`` and aggregates ``label_ids``, ``assignee_ids``,
        ``module_ids`` (each filtered to exclude soft-deleted associations
        and inactive project memberships).
    """

    model = DraftIssue

    def get_queryset(self):
        """Return draft issues with associated id arrays annotated.

        Annotates each draft with its associated ``cycle_id`` (latest non-
        deleted ``DraftIssueCycle`` row) and ``label_ids`` /
        ``assignee_ids`` / ``module_ids`` aggregated from active, non-
        deleted associations.
        """
        return (
            DraftIssue.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("workspace", "project", "state", "parent")
            .prefetch_related("assignees", "labels", "draft_issue_module__module")
            .annotate(
                cycle_id=Subquery(
                    DraftIssueCycle.objects.filter(draft_issue=OuterRef("id"), deleted_at__isnull=True).values(
                        "cycle_id"
                    )[:1]
                )
            )
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "labels__id",
                        distinct=True,
                        filter=Q(~Q(labels__id__isnull=True) & (Q(draft_label_issue__deleted_at__isnull=True))),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "assignees__id",
                        distinct=True,
                        filter=Q(
                            ~Q(assignees__id__isnull=True)
                            & Q(assignees__member_project__is_active=True)
                            & Q(draft_issue_assignee__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                module_ids=Coalesce(
                    ArrayAgg(
                        "draft_issue_module__module_id",
                        distinct=True,
                        filter=Q(
                            ~Q(draft_issue_module__module_id__isnull=True)
                            & Q(draft_issue_module__module__archived_at__isnull=True)
                            & Q(draft_issue_module__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
        ).distinct()

    @method_decorator(gzip_page)
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        """Return a gzip-compressed, paginated list of the caller's drafts.

        Applies legacy filters from ``issue_filters(request.query_params,
        "GET")``, then restricts to drafts ``created_by=request.user``
        ordered by ``-created_at``. The response is wrapped by
        ``gzip_page`` because draft lists can be long.
        """
        filters = issue_filters(request.query_params, "GET")
        issues = self.get_queryset().filter(created_by=request.user).order_by("-created_at")

        issues = issues.filter(**filters)
        # List Paginate
        return self.paginate(
            request=request,
            queryset=(issues),
            on_results=lambda issues: DraftIssueSerializer(issues, many=True).data,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug):
        """Persist a new draft issue for the caller.

        The workspace id is resolved from ``slug``; ``project_id`` from
        the payload (may be ``None`` until the draft is later promoted).
        Returns the projected field subset listed in the class
        docstring.
        """
        workspace = Workspace.objects.get(slug=slug)

        serializer = DraftIssueCreateSerializer(
            data=request.data,
            context={
                "workspace_id": workspace.id,
                "project_id": request.data.get("project_id", None),
            },
        )
        if serializer.is_valid():
            serializer.save()
            issue = (
                self.get_queryset()
                .filter(pk=serializer.data.get("id"))
                .values(
                    "id",
                    "name",
                    "state_id",
                    "sort_order",
                    "completed_at",
                    "estimate_point",
                    "priority",
                    "start_date",
                    "target_date",
                    "project_id",
                    "parent_id",
                    "cycle_id",
                    "module_ids",
                    "label_ids",
                    "assignee_ids",
                    "created_at",
                    "updated_at",
                    "created_by",
                    "updated_by",
                    "type_id",
                    "description_html",
                )
                .first()
            )

            return Response(issue, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(
        allowed_roles=[ROLE.ADMIN, ROLE.MEMBER],
        creator=True,
        model=Issue,
        level="WORKSPACE",
    )
    def partial_update(self, request, slug, pk):
        """Apply a partial update to one of the caller's drafts.

        Returns HTTP 404 if no draft matches the supplied ``pk`` for the
        caller. On success the response is HTTP 204 -- the frontend
        already holds the updated state because
        ``DraftIssueCreateSerializer`` is strict about field validation.
        """
        issue = self.get_queryset().filter(pk=pk, created_by=request.user).first()

        if not issue:
            return Response({"error": "Issue not found"}, status=status.HTTP_404_NOT_FOUND)

        project_id = request.data.get("project_id", issue.project_id)

        serializer = DraftIssueCreateSerializer(
            issue,
            data=request.data,
            partial=True,
            context={
                "project_id": project_id,
                "cycle_id": request.data.get("cycle_id", "not_provided"),
            },
        )

        if serializer.is_valid():
            serializer.save()

            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=Issue, level="WORKSPACE")
    def retrieve(self, request, slug, pk=None):
        """Return one of the caller's drafts as ``DraftIssueDetailSerializer``.

        Returns HTTP 404 if no draft matches the supplied ``pk`` for the
        caller.
        """
        issue = self.get_queryset().filter(pk=pk, created_by=request.user).first()

        if not issue:
            return Response(
                {"error": "The required object does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = DraftIssueDetailSerializer(issue)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=DraftIssue, level="WORKSPACE")
    def destroy(self, request, slug, pk=None):
        """Delete a draft by id (hard delete via ``DraftIssue.delete``)."""
        draft_issue = DraftIssue.objects.get(workspace__slug=slug, pk=pk)
        draft_issue.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def create_draft_to_issue(self, request, slug, draft_id):
        """Promote a draft into a real issue, wiring cycle/modules and assets.

        Requires the draft to carry a ``project_id``. On success:

        1. Persists a new ``Issue`` via ``IssueCreateSerializer`` using
           the draft's project and workspace.
        2. Emits ``issue_activity.delay(type="issue.activity.created",
           ...)`` (Celery via RabbitMQ).
        3. If ``cycle_id`` is supplied, creates a ``CycleIssue`` row and
           emits ``issue_activity.delay(type="cycle.activity.created",
           ...)``.
        4. If ``module_ids`` is supplied, bulk-creates ``ModuleIssue``
           rows (batch size 10) and emits one
           ``issue_activity.delay(type="module.activity.created", ...)``
           per module.
        5. Reassigns every ``FileAsset.draft_issue_id`` to the new issue
           id and switches ``entity_type`` to ``ISSUE_DESCRIPTION``.
        6. Deletes the draft.

        Returns the created issue payload on HTTP 201; HTTP 400 if the
        draft lacks a ``project_id`` or serializer validation fails.
        """
        draft_issue = self.get_queryset().filter(pk=draft_id).first()

        if not draft_issue.project_id:
            return Response(
                {"error": "Project is required to create an issue."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = IssueCreateSerializer(
            data=request.data,
            context={
                "project_id": draft_issue.project_id,
                "workspace_id": draft_issue.project.workspace_id,
                "default_assignee_id": draft_issue.project.default_assignee_id,
            },
        )

        if serializer.is_valid():
            serializer.save()

            issue_activity.delay(
                type="issue.activity.created",
                requested_data=json.dumps(self.request.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(serializer.data.get("id", None)),
                project_id=str(draft_issue.project_id),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )

            if request.data.get("cycle_id", None):
                created_records = CycleIssue.objects.create(
                    cycle_id=request.data.get("cycle_id", None),
                    issue_id=serializer.data.get("id", None),
                    project_id=draft_issue.project_id,
                    workspace_id=draft_issue.workspace_id,
                    created_by_id=draft_issue.created_by_id,
                    updated_by_id=draft_issue.updated_by_id,
                )
                # Capture Issue Activity
                issue_activity.delay(
                    type="cycle.activity.created",
                    requested_data=None,
                    actor_id=str(self.request.user.id),
                    issue_id=None,
                    project_id=str(self.kwargs.get("project_id", None)),
                    current_instance=json.dumps(
                        {
                            "updated_cycle_issues": None,
                            "created_cycle_issues": serializers.serialize("json", [created_records]),
                        }
                    ),
                    epoch=int(timezone.now().timestamp()),
                    notification=True,
                    origin=base_host(request=request, is_app=True),
                )

            if request.data.get("module_ids", []):
                # bulk create the module
                ModuleIssue.objects.bulk_create(
                    [
                        ModuleIssue(
                            module_id=module,
                            issue_id=serializer.data.get("id", None),
                            workspace_id=draft_issue.workspace_id,
                            project_id=draft_issue.project_id,
                            created_by_id=draft_issue.created_by_id,
                            updated_by_id=draft_issue.updated_by_id,
                        )
                        for module in request.data.get("module_ids", [])
                    ],
                    batch_size=10,
                )
                # Update the activity
                _ = [
                    issue_activity.delay(
                        type="module.activity.created",
                        requested_data=json.dumps({"module_id": str(module)}),
                        actor_id=str(request.user.id),
                        issue_id=serializer.data.get("id", None),
                        project_id=draft_issue.project_id,
                        current_instance=None,
                        epoch=int(timezone.now().timestamp()),
                        notification=True,
                        origin=base_host(request=request, is_app=True),
                    )
                    for module in request.data.get("module_ids", [])
                ]

            # Update file assets
            file_assets = FileAsset.objects.filter(draft_issue_id=draft_id)
            file_assets.update(
                issue_id=serializer.data.get("id", None),
                entity_type=FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
                draft_issue_id=None,
            )

            # delete the draft issue
            draft_issue.delete()

            return Response(serializer.data, status=status.HTTP_201_CREATED)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
