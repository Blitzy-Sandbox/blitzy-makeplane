# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""HTTP endpoints for the per-project Intake (triage) workflow.

Exposes three classes mounted under
``/api/workspaces/<slug>/projects/<uuid:project_id>/`` (with legacy
``/inboxes/`` aliases preserved for backward compatibility):

* :class:`IntakeViewSet` -- the per-project intake *container*. Each
  project owns exactly one intake row; this endpoint returns it via the
  ``list`` action and refuses to delete the row marked
  ``is_default=True``.
* :class:`IntakeIssueViewSet` -- the work items queued inside the
  intake. Contributors (including project guests) submit issues; project
  admins and the submitter triage them through the status transitions
  ``Pending (-2) -> Accepted (1) | Rejected (-1) | Snoozed (0) |
  Duplicate (2)``. ``Accepted`` promotes the underlying issue from the
  Triage state to a regular project issue.
* :class:`IntakeWorkItemDescriptionVersionEndpoint` -- read-only access
  to the description version history captured for an intake issue's
  underlying ``Issue`` row.

Architectural notes:

* Authorization combines DRF's :class:`IsAuthenticated` (inherited from
  :class:`plane.app.views.base.BaseViewSet`) with the
  :func:`plane.app.permissions.allow_permission` decorator -- the
  intake-create path is deliberately permissive (``ROLE.GUEST``
  included) so external contributors can submit triage items, while
  status transitions and deletions require ``ROLE.ADMIN`` *or* creator
  status on the underlying :class:`plane.db.models.Issue`.
* Side-effect tasks (``issue_activity``,
  ``issue_description_version_task``) are dispatched via Celery over
  RabbitMQ (per the architectural context: Redis is caching/session
  only). Submitter notifications on status changes are routed through
  the standard issue-activity pipeline.
* Querysets eagerly annotate ``label_ids``, ``assignee_ids``,
  ``module_ids``, ``cycle_id``, ``link_count``, ``attachment_count``,
  and ``sub_issues_count`` so the detail serializer can render a full
  issue payload without N+1 queries.
"""

# Python imports
import json

# Django import
from django.utils import timezone
from django.db.models import Q, Count, OuterRef, Func, F, Prefetch, Subquery
from django.core.serializers.json import DjangoJSONEncoder
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models import Value, UUIDField
from django.db.models.functions import Coalesce

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from ..base import BaseViewSet
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import (
    Intake,
    IntakeIssue,
    Issue,
    State,
    StateGroup,
    IssueLink,
    FileAsset,
    Project,
    ProjectMember,
    CycleIssue,
    IssueDescriptionVersion,
    WorkspaceMember,
)
from plane.app.serializers import (
    IssueCreateSerializer,
    IssueDetailSerializer,
    IntakeSerializer,
    IntakeIssueSerializer,
    IntakeIssueDetailSerializer,
    IssueDescriptionVersionDetailSerializer,
)
from plane.utils.issue_filters import issue_filters
from plane.bgtasks.issue_activities_task import issue_activity
from plane.bgtasks.issue_description_version_task import issue_description_version_task
from plane.app.views.base import BaseAPIView
from plane.utils.timezone_converter import user_timezone_converter
from plane.utils.global_paginator import paginate
from plane.utils.host import base_host
from plane.db.models.intake import SourceType


class IntakeViewSet(BaseViewSet):
    """Per-project intake (triage) container endpoint.

    Resource managed: :class:`plane.db.models.Intake` -- the singleton
    triage container that exists once per project (auto-created on
    project creation; the ``is_default=True`` row cannot be removed).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/intakes/
        POST   /api/workspaces/<slug>/projects/<project_id>/intakes/
        GET    /api/workspaces/<slug>/projects/<project_id>/intakes/<uuid:pk>/
        PATCH  /api/workspaces/<slug>/projects/<project_id>/intakes/<uuid:pk>/
        DELETE /api/workspaces/<slug>/projects/<project_id>/intakes/<uuid:pk>/

        (Also aliased under ``/inboxes/...`` for backward compatibility
        with the pre-rename URL surface; the handlers are identical.)

    Request body (POST / PATCH):
        Fields accepted by :class:`plane.app.serializers.IntakeSerializer`
        (``name``, ``description``, ``view_props`` JSON, ``logo_props``
        JSON, etc.). ``project`` and ``workspace`` are read-only and set
        from URL kwargs.

    Response shape:
        :class:`plane.app.serializers.IntakeSerializer` payload, which
        includes the ``pending_issue_count`` annotation (count of
        intake-issue rows with ``status=-2``) and a nested
        ``project_detail`` block via
        :class:`plane.app.serializers.ProjectLiteSerializer`.

    Permissions:
        permission_classes = [IsAuthenticated]  (inherited from
            :class:`plane.app.views.base.BaseViewSet`).
        Each method is further gated by
        :func:`plane.app.permissions.allow_permission` against project
        membership: ``list`` / ``perform_create`` / ``destroy`` allow
        ``ROLE.ADMIN`` and ``ROLE.MEMBER`` only -- guests cannot create
        or delete the intake container itself.

    Queryset filter logic (``get_queryset``):
        Scopes to ``workspace__slug=kwargs["slug"]`` and
        ``project_id=kwargs["project_id"]``; annotates
        ``pending_issue_count`` from the related
        :class:`plane.db.models.IntakeIssue` rows with ``status=-2``;
        joins ``workspace`` and ``project`` via ``select_related``.

    Behavioral notes:
        ``list`` returns the *first* matching intake (not paginated)
        because the relation is 1:1 with the project. ``destroy``
        refuses to delete the default intake row to preserve the
        application invariant that every project has a triage queue.

    Cross-references:
        - Permissions: ``plane.app.permissions.allow_permission``.
        - Serializers: ``plane.app.serializers.IntakeSerializer``,
          ``plane.app.serializers.ProjectLiteSerializer``.
        - Models: ``plane.db.models.Intake``, ``plane.db.models.IntakeIssue``,
          ``plane.db.models.Project``.
        - URL registration: ``apps/api/plane/app/urls/intake.py``.
    """

    serializer_class = IntakeSerializer
    model = Intake

    def get_queryset(self):
        """Return the project's intake row(s).

        Annotated with ``pending_issue_count`` and joined to workspace/project.
        """
        return (
            super()
            .get_queryset()
            .filter(
                workspace__slug=self.kwargs.get("slug"),
                project_id=self.kwargs.get("project_id"),
            )
            .annotate(pending_issue_count=Count("issue_intake", filter=Q(issue_intake__status=-2)))
            .select_related("workspace", "project")
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def list(self, request, slug, project_id):
        """Return the single intake row for ``(slug, project_id)`` serialized via :class:`IntakeSerializer`."""
        intake = self.get_queryset().first()
        return Response(IntakeSerializer(intake).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def perform_create(self, serializer):
        """Persist the new intake row bound to ``project_id`` from the URL kwargs."""
        serializer.save(project_id=self.kwargs.get("project_id"))

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, pk):
        """Delete the intake row identified by ``pk`` unless it is the default intake (``is_default=True``).

        Returns 400 if the caller targets the default intake -- every
        project must retain at least the canonical triage container.
        """
        intake = Intake.objects.filter(workspace__slug=slug, project_id=project_id, pk=pk).first()
        # Handle default intake delete
        if intake.is_default:
            return Response(
                {"error": "You cannot delete the default intake"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        intake.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IntakeIssueViewSet(BaseViewSet):
    """Work-item CRUD for the project intake (triage) queue.

    Resource managed: :class:`plane.db.models.IntakeIssue` rows linking
    queued :class:`plane.db.models.Issue` instances to the project's
    Intake container. Each row carries a triage ``status`` (PENDING =
    -2 default / REJECTED = -1 / SNOOZED = 0 / ACCEPTED = 1 /
    DUPLICATE = 2), an optional ``snoozed_till`` datetime, an optional
    ``duplicate_to`` Issue FK, and a ``source`` discriminator (default
    ``"IN_APP"``).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/intake-issues/
        POST   /api/workspaces/<slug>/projects/<project_id>/intake-issues/
        GET    /api/workspaces/<slug>/projects/<project_id>/intake-issues/<uuid:pk>/
        PATCH  /api/workspaces/<slug>/projects/<project_id>/intake-issues/<uuid:pk>/
        DELETE /api/workspaces/<slug>/projects/<project_id>/intake-issues/<uuid:pk>/

        (Also aliased under ``/inbox-issues/...`` for backward
        compatibility.)

        IMPORTANT: ``<uuid:pk>`` in the detail routes resolves to the
        underlying ``Issue.id`` (not the ``IntakeIssue.id``); the
        handlers look up the IntakeIssue via ``issue_id=pk``.

    Request body (POST):
        issue (dict, required): Nested
            :class:`plane.app.serializers.IssueCreateSerializer` payload.
            Must include ``name`` (non-empty) and ``priority`` (one of
            ``"low" | "medium" | "high" | "urgent" | "none"``). The
            ``state_id`` is overridden server-side to the project's
            Triage state (auto-created on first intake submission with
            color ``#4E5355`` and sequence ``65000``).
        Other top-level fields are accepted but ignored at create time;
        intake-issue metadata such as ``status`` is initialized to
        PENDING (-2) by the model default.

    Request body (PATCH):
        issue (dict, optional): Partial
            :class:`plane.app.serializers.IssueCreateSerializer` payload
            (``name``, ``description_html``, ``description_json``,
            ``priority``, ``state_id``, ``assignees``, ``labels``,
            ``module_ids``, ``cycle_id``, ``parent_id``, etc.). Guest
            creators are silently restricted to ``name`` +
            ``description_html`` + ``description_json`` -- other fields
            in their payload are dropped.
        status (int, optional): One of ``-2 | -1 | 0 | 1 | 2`` (PENDING
            / REJECTED / SNOOZED / ACCEPTED / DUPLICATE). Only project
            admins, workspace admins, or members above
            ``ROLE.MEMBER.value`` may write this field.
        snoozed_till (datetime, optional): ISO-8601 timestamp; meaningful
            when ``status = 0``.
        duplicate_to (UUID, optional): An existing Issue id; meaningful
            when ``status = 2``.
        source_email (str, optional): For intake items submitted via
            email forwarding (currently unused -- in-app submissions
            always have ``source = "IN_APP"``).
        skip_activity (bool, optional, internal): Suppresses the
            ``issue.activity.updated`` Celery dispatch when this is a
            description-only migration update.

    Query parameters (GET list):
        status (str, optional, default ``"-2"``): Comma-separated list
            of integer statuses to include; ``"null"`` items are
            filtered out. Defaults to PENDING-only.
        order_by (str, optional, default ``"-issue__created_at"``):
            ORM ordering string applied to the queryset.
        Plus any filter accepted by
            :func:`plane.utils.issue_filters.issue_filters` with the
            ``issue__`` lookup prefix (assignees, labels, priority,
            state, etc.).

    Response shape:
        Create / partial_update / retrieve return
            :class:`plane.app.serializers.IntakeIssueDetailSerializer`
            payloads with annotated ``label_ids`` and ``assignee_ids``
            UUID arrays and a nested
            :class:`plane.app.serializers.IssueDetailSerializer` block.
        list returns a paginated
            :class:`plane.app.serializers.IntakeIssueSerializer` array.
        destroy returns HTTP 204.

    Permissions:
        permission_classes = [IsAuthenticated]  (inherited from
            :class:`plane.app.views.base.BaseViewSet`).
        Each method is gated by
        :func:`plane.app.permissions.allow_permission`:
            * ``list`` / ``create`` -- ROLE.ADMIN | ROLE.MEMBER |
              ROLE.GUEST (guests submit and view; deliberately
              permissive so external contributors can file triage
              items).
            * ``retrieve`` -- ROLE.ADMIN | ROLE.MEMBER | ROLE.GUEST,
              plus the Issue's creator regardless of role.
            * ``partial_update`` / ``destroy`` -- ROLE.ADMIN, plus the
              Issue's creator regardless of role. Additional inline
              guards in ``partial_update`` further restrict guests to
              editing only the issue's name / description fields, and
              restrict intake-metadata writes (``status``,
              ``snoozed_till``, ``duplicate_to``) to project admins
              above MEMBER or workspace admins.
        Guest visibility is also gated by
        ``project.guest_view_all_features``: when False, guests can
        only list / retrieve intake-issues they themselves created.

    Queryset filter logic (``get_queryset``):
        Operates on :class:`plane.db.models.Issue` (not IntakeIssue)
        and joins workspace/project/state/parent, prefetches
        assignees/labels/issue_module__module, and prefetches the
        related ``issue_intake`` rows projecting only ``status``,
        ``duplicate_to``, ``snoozed_till``, ``source`` to avoid
        loading the full IntakeIssue payload. Annotates ``cycle_id``
        from the first non-deleted ``CycleIssue``, ``link_count``,
        ``attachment_count`` (filtered to ``ISSUE_ATTACHMENT`` entity
        type), ``sub_issues_count``, and three UUID-array fields
        (``label_ids``, ``assignee_ids``, ``module_ids``) built via
        ``Coalesce(ArrayAgg(...), Value([], output_field=...))`` so
        the detail serializer renders a complete issue payload without
        N+1 queries. ``.distinct()`` is applied because the
        ArrayAgg/Prefetch joins multiply rows.

    Side effects (Celery via RabbitMQ -- NOT Redis):
        Create dispatches ``issue_activity.delay(type="issue.activity.created", ...)``
        and ``issue_description_version_task.delay(... is_creating=True)``.
        Partial-update dispatches ``issue_activity.delay(type="issue.activity.updated")``
        (suppressed when ``skip_activity=True`` and the update is
        description-only -- the "migration description update" path)
        and ``issue_description_version_task.delay(...)``; when intake
        metadata is changed it also dispatches
        ``issue_activity.delay(type="intake.activity.created", notification=False)``.
        Destroy hard-deletes the IntakeIssue row and, when
        ``status in [-2, -1, 0, 2]`` (i.e., NOT ACCEPTED), also
        hard-deletes the underlying Issue row -- accepted issues are
        preserved because they have been promoted to regular project
        issues.

    Idempotency:
        Non-idempotent. Repeated POSTs create distinct Issue +
        IntakeIssue rows. Repeated activity-log dispatches create
        duplicate activity rows; callers (this view) avoid double
        dispatch via the ``skip_activity`` + ``is_description_update``
        guard.

    Cross-references:
        - Permissions: ``plane.app.permissions.allow_permission``.
        - Serializers: ``plane.app.serializers.IntakeIssueSerializer``,
          ``plane.app.serializers.IntakeIssueDetailSerializer``,
          ``plane.app.serializers.IssueCreateSerializer``,
          ``plane.app.serializers.IssueSerializer``.
        - Models: ``plane.db.models.Issue``, ``plane.db.models.IntakeIssue``,
          ``plane.db.models.Intake``, ``plane.db.models.CycleIssue``,
          ``plane.db.models.FileAsset``.
        - Celery tasks (via RabbitMQ): ``plane.bgtasks.issue_activities_task.issue_activity``,
          ``plane.bgtasks.issue_description_version_task``.
        - URL registration: ``apps/api/plane/app/urls/intake.py``.
    """

    serializer_class = IntakeIssueSerializer
    model = IntakeIssue

    filterset_fields = ["status"]

    def get_queryset(self):
        """Return Issues in ``(slug, project_id)`` with intake metadata + count annotations.

        Joins workspace/project/state/parent, prefetches assignees/labels/issue_module__module,
        and annotates ``cycle_id``, ``link_count``, ``attachment_count``, ``sub_issues_count``,
        plus ``label_ids`` / ``assignee_ids`` / ``module_ids`` UUID-array fields.
        """
        return (
            Issue.objects.filter(
                project_id=self.kwargs.get("project_id"),
                workspace__slug=self.kwargs.get("slug"),
            )
            .select_related("workspace", "project", "state", "parent")
            .prefetch_related("assignees", "labels", "issue_module__module")
            .prefetch_related(
                Prefetch(
                    "issue_intake",
                    queryset=IntakeIssue.objects.only("status", "duplicate_to", "snoozed_till", "source"),
                )
            )
            .annotate(
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
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "labels__id",
                        distinct=True,
                        filter=Q(~Q(labels__id__isnull=True) & Q(label_issue__deleted_at__isnull=True)),
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
                            & Q(issue_assignee__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                module_ids=Coalesce(
                    ArrayAgg(
                        "issue_module__module_id",
                        distinct=True,
                        filter=Q(
                            ~Q(issue_module__module_id__isnull=True)
                            & Q(issue_module__module__archived_at__isnull=True)
                            & Q(issue_module__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
        ).distinct()

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        """List intake-issues in the project, filtered by ``?status=`` and other issue filters.

        Defaults the status filter to ``"-2"`` (PENDING) when no ``?status=`` is supplied.
        Guests see only their own submitted items when ``project.guest_view_all_features``
        is False.
        """
        intake = Intake.objects.filter(workspace__slug=slug, project_id=project_id).first()
        if not intake:
            return Response({"error": "Intake not found"}, status=status.HTTP_404_NOT_FOUND)

        project = Project.objects.get(pk=project_id)
        filters = issue_filters(request.GET, "GET", "issue__")
        intake_issue = (
            IntakeIssue.objects.filter(intake_id=intake.id, project_id=project_id, **filters)
            .select_related("issue")
            .prefetch_related("issue__labels")
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "issue__labels__id",
                        distinct=True,
                        filter=Q(~Q(issue__labels__id__isnull=True) & Q(issue__label_issue__deleted_at__isnull=True)),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                )
            )
        ).order_by(request.GET.get("order_by", "-issue__created_at"))
        # Intake status filter
        intake_status = [item for item in request.GET.get("status", "-2").split(",") if item != "null"]
        if intake_status:
            intake_issue = intake_issue.filter(status__in=intake_status)

        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=ROLE.GUEST.value,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
        ):
            intake_issue = intake_issue.filter(created_by=request.user)
        return self.paginate(
            request=request,
            queryset=(intake_issue),
            on_results=lambda intake_issues: IntakeIssueSerializer(intake_issues, many=True).data,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def create(self, request, slug, project_id):
        """Create an Issue + IntakeIssue pair and dispatch the activity + version Celery tasks.

        Validates the nested ``issue.name`` (required) and
        ``issue.priority`` (must be one of ``low/medium/high/urgent/none``).
        Finds or creates the project's Triage state (color
        ``#4E5355``, sequence ``65000``) and forces the new issue
        through it. The IntakeIssue link is created with
        ``source=SourceType.IN_APP`` and defaults to ``status=-2``
        (PENDING).
        """
        if not request.data.get("issue", {}).get("name", False):
            return Response({"error": "Name is required"}, status=status.HTTP_400_BAD_REQUEST)

        # Check for valid priority
        if request.data.get("issue", {}).get("priority", "none") not in [
            "low",
            "medium",
            "high",
            "urgent",
            "none",
        ]:
            return Response({"error": "Invalid priority"}, status=status.HTTP_400_BAD_REQUEST)

        project = Project.objects.get(pk=project_id)

        # get the triage state
        triage_state = State.triage_objects.filter(project_id=project_id, workspace__slug=slug).first()
        if not triage_state:
            triage_state = State.objects.create(
                name="Triage",
                group=StateGroup.TRIAGE.value,
                project_id=project_id,
                workspace_id=project.workspace_id,
                color="#4E5355",
                sequence=65000,
                default=False,
            )
        request.data["issue"]["state_id"] = triage_state.id

        # create an issue
        serializer = IssueCreateSerializer(
            data=request.data.get("issue"),
            context={
                "project_id": project_id,
                "workspace_id": project.workspace_id,
                "default_assignee_id": project.default_assignee_id,
                "allow_triage_state": True,
            },
        )
        if serializer.is_valid():
            serializer.save()
            intake_id = Intake.objects.filter(workspace__slug=slug, project_id=project_id).first()
            # create an intake issue
            intake_issue = IntakeIssue.objects.create(
                intake_id=intake_id.id,
                project_id=project_id,
                issue_id=serializer.data["id"],
                source=SourceType.IN_APP,
            )
            # Create an Issue Activity
            issue_activity.delay(
                type="issue.activity.created",
                requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(serializer.data["id"]),
                project_id=str(project_id),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
                intake=str(intake_issue.id),
            )
            # updated issue description version
            issue_description_version_task.delay(
                updated_issue=json.dumps(request.data, cls=DjangoJSONEncoder),
                issue_id=str(serializer.data["id"]),
                user_id=request.user.id,
                is_creating=True,
            )
            intake_issue = (
                IntakeIssue.objects.select_related("issue")
                .prefetch_related("issue__labels", "issue__assignees")
                .annotate(
                    label_ids=Coalesce(
                        ArrayAgg(
                            "issue__labels__id",
                            distinct=True,
                            filter=Q(
                                ~Q(issue__labels__id__isnull=True) & Q(issue__label_issue__deleted_at__isnull=True)
                            ),
                        ),
                        Value([], output_field=ArrayField(UUIDField())),
                    ),
                    assignee_ids=Coalesce(
                        ArrayAgg(
                            "issue__assignees__id",
                            distinct=True,
                            filter=~Q(issue__assignees__id__isnull=True)
                            & Q(issue__assignees__member_project__is_active=True),
                        ),
                        Value([], output_field=ArrayField(UUIDField())),
                    ),
                )
                .get(
                    intake_id=intake_id.id,
                    issue_id=serializer.data["id"],
                    project_id=project_id,
                )
            )
            serializer = IntakeIssueDetailSerializer(intake_issue)
            return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=Issue)
    def partial_update(self, request, slug, project_id, pk):
        """Partial-update the underlying Issue and/or its intake metadata.

        Then dispatches the issue-activity and description-version Celery
        tasks.

        Multi-layered authorization (in addition to the
        :func:`allow_permission` decorator gate):

        * Caller must be a project member OR a workspace admin -- else
          HTTP 403.
        * Guest-role project members can write to the Issue only
          (``name``, ``description_html``, ``description_json``), and
          only if they are the issue's creator -- other Issue fields
          in the payload are silently dropped.
        * Only project members above ``ROLE.MEMBER.value`` (i.e.,
          ROLE.ADMIN) OR workspace admins may write the IntakeIssue
          metadata (``status``, ``snoozed_till``, ``duplicate_to``,
          ``source_email``).

        Celery side effects depend on which subset was written: Issue
        updates fire ``issue.activity.updated`` (skipped when
        ``skip_activity=True`` and the update is description-only --
        the "migration description update" path) and
        ``issue_description_version_task``; intake metadata changes
        fire ``intake.activity.created`` with ``notification=False``.
        """
        skip_activity = request.data.pop("skip_activity", False)
        is_description_update = request.data.get("description_html") is not None

        intake_id = Intake.objects.filter(workspace__slug=slug, project_id=project_id).first()
        intake_issue = IntakeIssue.objects.get(
            issue_id=pk,
            workspace__slug=slug,
            project_id=project_id,
            intake_id=intake_id,
        )

        project_member = ProjectMember.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            member=request.user,
            is_active=True,
        ).first()

        is_workspace_admin = WorkspaceMember.objects.filter(
            workspace__slug=slug,
            is_active=True,
            member=request.user,
            role=ROLE.ADMIN.value,
        ).exists()

        if not project_member and not is_workspace_admin:
            return Response(
                {"error": "Only admin or creator can update the intake work items"},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Only project members admins and created_by users can access this endpoint
        if ((project_member and project_member.role <= ROLE.GUEST.value) and not is_workspace_admin) and str(
            intake_issue.created_by_id
        ) != str(request.user.id):
            return Response(
                {"error": "You cannot edit intake issues"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get issue data
        issue_data = request.data.pop("issue", False)
        issue_serializer = None
        issue = None
        issue_current_instance = None
        issue_requested_data = None

        # Validate issue data if provided
        if bool(issue_data):
            issue = Issue.objects.annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "labels__id",
                        distinct=True,
                        filter=Q(~Q(labels__id__isnull=True) & Q(label_issue__deleted_at__isnull=True)),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "assignees__id",
                        distinct=True,
                        filter=Q(~Q(assignees__id__isnull=True) & Q(issue_assignee__deleted_at__isnull=True)),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            ).get(pk=intake_issue.issue_id, workspace__slug=slug, project_id=project_id)

            if project_member and project_member.role <= ROLE.GUEST.value:
                issue_data = {
                    "name": issue_data.get("name", issue.name),
                    "description_html": issue_data.get("description_html", issue.description_html),
                    "description_json": issue_data.get("description_json", issue.description_json),
                }

            issue_current_instance = json.dumps(IssueDetailSerializer(issue).data, cls=DjangoJSONEncoder)
            issue_requested_data = json.dumps(issue_data, cls=DjangoJSONEncoder)

            issue_serializer = IssueCreateSerializer(
                issue, data=issue_data, partial=True, context={"project_id": project_id, "allow_triage_state": True}
            )

            if not issue_serializer.is_valid():
                return Response(issue_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # Validate intake issue data if user has permission
        intake_serializer = None
        intake_current_instance = None

        if (project_member and project_member.role > ROLE.MEMBER.value) or is_workspace_admin:
            intake_current_instance = json.dumps(IntakeIssueSerializer(intake_issue).data, cls=DjangoJSONEncoder)
            intake_serializer = IntakeIssueSerializer(intake_issue, data=request.data, partial=True)

            if not intake_serializer.is_valid():
                return Response(intake_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # Both serializers are valid, now save them
        if issue_serializer:
            issue_serializer.save()

            # Check if the update is a migration description update
            is_migration_description_update = skip_activity and is_description_update
            # Log all the updates
            if not is_migration_description_update:
                if issue is not None:
                    issue_activity.delay(
                        type="issue.activity.updated",
                        requested_data=issue_requested_data,
                        actor_id=str(request.user.id),
                        issue_id=str(issue.id),
                        project_id=str(project_id),
                        current_instance=issue_current_instance,
                        epoch=int(timezone.now().timestamp()),
                        notification=True,
                        origin=base_host(request=request, is_app=True),
                        intake=str(intake_issue.id),
                    )
                    # updated issue description version
                    issue_description_version_task.delay(
                        updated_issue=issue_current_instance,
                        issue_id=str(pk),
                        user_id=request.user.id,
                    )

        if intake_serializer:
            intake_serializer.save()
            # create a activity for status change
            issue_activity.delay(
                type="intake.activity.created",
                requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(pk),
                project_id=str(project_id),
                current_instance=intake_current_instance,
                epoch=int(timezone.now().timestamp()),
                notification=False,
                origin=base_host(request=request, is_app=True),
                intake=str(intake_issue.id),
            )

        # Fetch and return the updated intake issue
        intake_issue = (
            IntakeIssue.objects.select_related("issue")
            .prefetch_related("issue__labels", "issue__assignees")
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "issue__labels__id",
                        distinct=True,
                        filter=Q(~Q(issue__labels__id__isnull=True) & Q(issue__label_issue__deleted_at__isnull=True)),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "issue__assignees__id",
                        distinct=True,
                        filter=Q(
                            ~Q(issue__assignees__id__isnull=True) & Q(issue__issue_assignee__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
            .get(intake_id=intake_id.id, issue_id=pk, project_id=project_id)
        )
        serializer = IntakeIssueDetailSerializer(intake_issue).data
        return Response(serializer, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], creator=True, model=Issue)
    def retrieve(self, request, slug, project_id, pk):
        """Return the IntakeIssue detail for ``issue_id=pk`` with label/assignee annotations.

        Guests can only see issues they themselves created when
        ``project.guest_view_all_features`` is False (HTTP 403 otherwise).
        """
        intake_id = Intake.objects.filter(workspace__slug=slug, project_id=project_id).first()
        project = Project.objects.get(pk=project_id)
        intake_issue = (
            IntakeIssue.objects.select_related("issue")
            .prefetch_related("issue__labels", "issue__assignees")
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "issue__labels__id",
                        distinct=True,
                        filter=Q(~Q(issue__labels__id__isnull=True) & Q(issue__label_issue__deleted_at__isnull=True)),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "issue__assignees__id",
                        distinct=True,
                        filter=Q(
                            ~Q(issue__assignees__id__isnull=True) & Q(issue__issue_assignee__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
            .get(intake_id=intake_id.id, issue_id=pk, project_id=project_id)
        )
        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=ROLE.GUEST.value,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
            and not intake_issue.created_by == request.user
        ):
            return Response(
                {"error": "You are not allowed to view this issue"},
                status=status.HTTP_403_FORBIDDEN,
            )
        issue = IntakeIssueDetailSerializer(intake_issue).data
        return Response(issue, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=Issue)
    def destroy(self, request, slug, project_id, pk):
        """Delete the IntakeIssue row and cascade to the Issue if not yet ACCEPTED.

        When the IntakeIssue status is in
        ``[-2, -1, 0, 2]`` (PENDING/REJECTED/SNOOZED/DUPLICATE), the
        underlying ``Issue`` row is also hard-deleted. ACCEPTED
        intake-issues (status ``1``) are not destructively cascaded
        because the Issue has already been promoted into the project's
        main issue list and is managed there.
        """
        intake_id = Intake.objects.filter(workspace__slug=slug, project_id=project_id).first()
        intake_issue = IntakeIssue.objects.get(
            issue_id=pk,
            workspace__slug=slug,
            project_id=project_id,
            intake_id=intake_id,
        )

        # Check the issue status
        if intake_issue.status in [-2, -1, 0, 2]:
            # Delete the issue also
            issue = Issue.objects.filter(workspace__slug=slug, project_id=project_id, pk=pk).first()
            issue.delete()

        intake_issue.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IntakeWorkItemDescriptionVersionEndpoint(BaseAPIView):
    """Read-only description version history for an intake work item's underlying Issue.

    Resource managed:
    :class:`plane.db.models.IssueDescriptionVersion` rows (created by
    the ``issue_description_version_task`` Celery task each time the
    issue description is updated). This endpoint is the intake-side
    surface for reading those snapshots; the equivalent for regular
    project issues lives under
    ``apps/api/plane/app/views/issue/version.py``.

    HTTP methods + URL patterns:
        GET ``.../intake-work-items/<work_item_id>/description-versions/``           -> list
        GET ``.../intake-work-items/<work_item_id>/description-versions/<uuid:pk>/`` -> detail

        (Mounted under ``/api/workspaces/<slug>/projects/<project_id>/``.)

    Query parameters (paginated list mode):
        cursor (str, optional): Opaque pagination cursor consumed by
            :func:`plane.utils.global_paginator.paginate`.

    Response shape:
        Detail mode (with ``<uuid:pk>``):
            :class:`plane.app.serializers.IssueDescriptionVersionDetailSerializer`
            payload.
        List mode (without ``<uuid:pk>``):
            Cursor-paginated dict of fields ``["id", "workspace",
            "project", "issue", "last_saved_at", "owned_by",
            "created_at", "updated_at", "created_by", "updated_by"]``;
            ``created_at`` and ``updated_at`` are converted to the
            requesting user's IANA timezone via
            :func:`plane.utils.timezone_converter.user_timezone_converter`.

    Request body:
        None (GET only). All inputs are URL kwargs or query parameters.

    Permissions:
        permission_classes = [IsAuthenticated]  (inherited from
            :class:`plane.app.views.base.BaseAPIView`).
        Method is further gated by
        :func:`plane.app.permissions.allow_permission` with
        ``[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]`` -- guests may read
        version history, but only for issues they themselves created
        when ``project.guest_view_all_features`` is False.

    Cross-references:
        - Permissions: ``plane.app.permissions.allow_permission``.
        - Serializers: ``plane.app.serializers.IssueDescriptionVersionDetailSerializer``.
        - Models: ``plane.db.models.IssueDescriptionVersion``,
          ``plane.db.models.Issue``, ``plane.db.models.Project``.
        - Celery tasks: ``plane.bgtasks.issue_description_version_task``
          (Celery via RabbitMQ -- populates the version rows that this
          endpoint reads).
        - URL registration: ``apps/api/plane/app/urls/intake.py``.
    """

    def process_paginated_result(self, fields, results, timezone):
        """Project ``results`` onto ``fields`` and convert timestamps to the user's timezone.

        Converts the ``created_at`` and ``updated_at`` columns into the
        requesting user's IANA timezone before returning the paginated dict.
        """
        paginated_data = results.values(*fields)

        datetime_fields = ["created_at", "updated_at"]
        paginated_data = user_timezone_converter(paginated_data, datetime_fields, timezone)

        return paginated_data

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, work_item_id, pk=None):
        """Return one :class:`IssueDescriptionVersion` or a cursor-paginated list of versions.

        When ``pk`` is supplied returns a single version detail; otherwise
        returns a cursor-paginated list of versions for ``work_item_id``.
        Guests are blocked from viewing description history for issues
        they did not create when
        ``project.guest_view_all_features=False`` (HTTP 403).
        """
        project = Project.objects.get(pk=project_id)
        issue = Issue.objects.get(workspace__slug=slug, project_id=project_id, pk=work_item_id)

        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=ROLE.GUEST.value,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
            and not issue.created_by == request.user
        ):
            return Response(
                {"error": "You are not allowed to view this issue"},
                status=status.HTTP_403_FORBIDDEN,
            )

        if pk:
            issue_description_version = IssueDescriptionVersion.objects.get(
                workspace__slug=slug,
                project_id=project_id,
                issue_id=work_item_id,
                pk=pk,
            )

            serializer = IssueDescriptionVersionDetailSerializer(issue_description_version)
            return Response(serializer.data, status=status.HTTP_200_OK)

        cursor = request.GET.get("cursor", None)

        required_fields = [
            "id",
            "workspace",
            "project",
            "issue",
            "last_saved_at",
            "owned_by",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]

        issue_description_versions_queryset = IssueDescriptionVersion.objects.filter(
            workspace__slug=slug, project_id=project_id, issue_id=work_item_id
        )

        paginated_data = paginate(
            base_queryset=issue_description_versions_queryset,
            queryset=issue_description_versions_queryset,
            cursor=cursor,
            on_result=lambda results: self.process_paginated_result(
                required_fields, results, request.user.user_timezone
            ),
        )
        return Response(paginated_data, status=status.HTTP_200_OK)
