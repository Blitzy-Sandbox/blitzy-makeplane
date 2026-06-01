# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public ``IntakeIssue`` submission ViewSet for the ``plane.space`` API.

Defines :class:`IntakeIssuePublicViewSet`, the single :class:`BaseViewSet`
that orchestrates the **public intake submission flow** for published
deploy boards: it lets anonymous and authenticated visitors submit issues
into a project's intake pipeline (gated by :attr:`DeployBoard.intake`),
and lets the SUBMITTER edit or delete their own submissions before a
triager accepts them.

Mounted under ``api/public/anchor/<str:anchor>/intakes/<uuid:intake_id>/``,
with the legacy alias ``inbox-issues/`` preserved for backwards
compatibility (see ``apps/api/plane/space/urls/intake.py``). The view
enqueues issue-activity events via Celery (RabbitMQ broker) on create
and partial_update so the wider activity-feed / notification pipeline
stays in sync; Redis is NOT used by this surface (caching/session only
per the platform's broker/cache separation).

Triage state lifecycle: incoming submissions are pinned to the
project's :class:`StateGroup.TRIAGE` :class:`State`. The view will
lazily create a ``"Triage"`` state row (sequence=65000, color="#4E5355")
on first submission if the project doesn't have one -- this preserves
the intake invariant that EVERY intake submission lives in a
triage-grouped state until a triager moves it forward.
"""

# Python imports
import json

# Django import
from django.utils import timezone
from django.db.models import Q, OuterRef, Func, F, Prefetch
from django.core.serializers.json import DjangoJSONEncoder

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .base import BaseViewSet
from plane.db.models import IntakeIssue, Issue, IssueLink, FileAsset, DeployBoard, State, StateGroup
from plane.app.serializers import (
    IssueSerializer,
    IntakeIssueSerializer,
    IssueCreateSerializer,
    IssueStateIntakeSerializer,
)
from plane.utils.issue_filters import issue_filters
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models.intake import SourceType


class IntakeIssuePublicViewSet(BaseViewSet):
    """Anchor-scoped public CRUD for :class:`IntakeIssue` submissions on published boards.

    HTTP methods and URL patterns
        (from ``apps/api/plane/space/urls/intake.py``):

        GET    /api/public/anchor/<str:anchor>/intakes/<uuid:intake_id>/intake-issues/
        GET    /api/public/anchor/<str:anchor>/intakes/<uuid:intake_id>/inbox-issues/
                  (legacy alias; both route names: ``intake-issues-list`` /
                  ``inbox-issues-list``)
            Lists intake submissions for the given board.
        POST   (same paths)
            Submits a new intake issue (anonymous-creatable when the
            board does not require auth at the URLconf layer).
        GET    /api/public/anchor/<str:anchor>/intakes/<uuid:intake_id>/intake-issues/<uuid:pk>/
                  (name: ``intake-issue-detail``)
            Retrieves a single submission.
        PATCH  (same detail path)
            Partial-update of a submission's name / description (only
            the original submitter is permitted to edit).
        DELETE (same detail path)
            Deletes a submission (only the original submitter is
            permitted to delete).

    Request body (POST):
        issue (dict, required):
            name (str, required): issue title; missing => 400
                ``{"error": "Name is required"}``.
            description_html (str, optional, default=``"<p></p>"``):
                rendered HTML representation of the description.
            description_json (dict, optional, default=``{}``):
                ProseMirror / TipTap JSON document for the description.
            priority (str, optional, default=``"low"`` on save but
                validated against ``["low", "medium", "high", "urgent",
                "none"]`` from the request payload; default validation
                value=``"none"``).

    Request body (PATCH):
        issue (dict, optional): partial issue payload -- any of
            ``name``, ``description_html``, ``description_json`` may be
            supplied; unsupplied fields fall back to the current issue
            values. Other top-level keys on the request payload are
            ignored.

    Request body (DELETE):
        None.

    Response shape:
        LIST 200 OK: array of :class:`IssueStateIntakeSerializer`
            payloads, each enriched with ``bridge_id`` (the
            :class:`IntakeIssue.id` joining the issue back into the
            intake row), ``sub_issues_count``, ``link_count``,
            ``attachment_count``, and a prefetched ``issue_intake``
            mini-payload (``status``, ``duplicate_to``, ``snoozed_till``,
            ``source``).
        POST 200 OK: :class:`IssueStateIntakeSerializer` payload for the
            newly created issue.
        POST/PATCH/RETRIEVE/DESTROY 400 Bad Request:
            ``{"error": "Intake is not enabled for this Project Board"}``
            when ``deploy_board.intake is None`` (intake feature is
            disabled on the resolved board).
        POST 400 Bad Request: ``{"error": "Name is required"}`` (missing
            issue.name) or ``{"error": "Invalid priority"}`` (priority
            outside the allowlist).
        PATCH 200 OK: :class:`IssueCreateSerializer` payload after the
            update, OR 400 Bad Request with serializer errors.
        PATCH/DELETE 400 Bad Request:
            ``{"error": "You cannot edit intake issues"}`` /
            ``{"error": "You cannot delete intake issue"}`` when the
            requester is NOT the original creator
            (``intake_issue.created_by_id``).
        RETRIEVE 200 OK: :class:`IssueStateIntakeSerializer` payload.
        DELETE 204 No Content on success.

    Permissions:
        Inherits ``BaseViewSet.permission_classes = [IsAuthenticated]``;
        creator-only gates on PATCH / DELETE are enforced inline by
        comparing ``intake_issue.created_by_id`` to ``request.user.id``.

    Queryset filter (``get_queryset``):
        Resolves :class:`DeployBoard` by workspace slug + project_id
        (NOT by anchor -- note that ``get_queryset`` uses the
        ``slug`` / ``project_id`` URL kwargs supplied by alternate
        routes, whereas the action handlers use ``anchor``). Returns
        :class:`IntakeIssue` rows filtered to:
            * ``snoozed_till >= now()`` OR ``snoozed_till IS NULL``
              (snoozed-away submissions are hidden until their snooze
              expires);
            * matching ``project_id`` / ``workspace.slug`` /
              ``intake_id`` kwargs;
            * ``select_related("issue", "workspace", "project")`` for
              efficient single-query rendering.
        Returns :class:`IntakeIssue.objects.none()` when no deploy
        board resolves.

    Background tasks (Celery via RabbitMQ -- NOT Redis):
        :func:`plane.bgtasks.issue_activities_task.issue_activity` is
        enqueued via ``.delay(...)`` on both ``create`` (with
        ``type="issue.activity.created"``) and ``partial_update`` (with
        ``type="issue.activity.updated"``) -- these populate the
        issue's activity log asynchronously.

    Triage state contract:
        On ``create``, the view looks up
        :meth:`State.triage_objects.filter(...)` first; if the project
        has no Triage state yet it lazily creates one
        (``name="Triage"``, ``group=StateGroup.TRIAGE``,
        ``color="#4E5355"``, ``sequence=65000``, ``default=False``).
        See :class:`apps/api/plane/space/views/state.py:ProjectStatesEndpoint`
        -- that endpoint deliberately EXCLUDES triage states from the
        public state list, so the two are coordinated.
    """

    serializer_class = IntakeIssueSerializer
    model = IntakeIssue

    filterset_fields = ["status"]

    def get_queryset(self):
        """Return snooze-aware :class:`IntakeIssue` rows for the resolved deploy board.

        Resolves :class:`DeployBoard` by workspace slug + project_id
        from URL kwargs, then filters intake issues to those whose
        ``snoozed_till`` is in the future or unset, scoped to the URL's
        ``intake_id``. Returns an empty queryset when no deploy board
        resolves.
        """
        project_deploy_board = DeployBoard.objects.get(
            workspace__slug=self.kwargs.get("slug"),
            project_id=self.kwargs.get("project_id"),
        )
        if project_deploy_board is not None:
            return self.filter_queryset(
                super()
                .get_queryset()
                .filter(
                    Q(snoozed_till__gte=timezone.now()) | Q(snoozed_till__isnull=True),
                    project_id=self.kwargs.get("project_id"),
                    workspace__slug=self.kwargs.get("slug"),
                    intake_id=self.kwargs.get("intake_id"),
                )
                .select_related("issue", "workspace", "project")
            )
        return IntakeIssue.objects.none()

    def list(self, request, anchor, intake_id):
        """List intake issues for ``anchor``'s board with bridge/link/attachment counts.

        Returns 400 when ``deploy_board.intake is None`` (intake feature
        is disabled on the resolved board). Annotates each
        :class:`Issue` row with ``bridge_id`` (the
        :class:`IntakeIssue.id`), ``sub_issues_count``, ``link_count``,
        and ``attachment_count`` (the last computed against
        ``FileAsset.EntityTypeContext.ISSUE_ATTACHMENT`` only -- other
        attachment types are NOT included in the count), and prefetches
        the ``issue_intake`` mini-payload for triage UI rendering.
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")
        if project_deploy_board.intake is None:
            return Response(
                {"error": "Intake is not enabled for this Project Board"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        filters = issue_filters(request.query_params, "GET")
        issues = (
            Issue.objects.filter(
                issue_intake__intake_id=intake_id,
                workspace_id=project_deploy_board.workspace_id,
                project_id=project_deploy_board.project_id,
            )
            .filter(**filters)
            .annotate(bridge_id=F("issue_intake__id"))
            .select_related("workspace", "project", "state", "parent")
            .prefetch_related("assignees", "labels")
            .order_by("issue_intake__snoozed_till", "issue_intake__status")
            .annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
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
            .prefetch_related(
                Prefetch(
                    "issue_intake",
                    queryset=IntakeIssue.objects.only("status", "duplicate_to", "snoozed_till", "source"),
                )
            )
        )
        issues_data = IssueStateIntakeSerializer(issues, many=True).data
        return Response(issues_data, status=status.HTTP_200_OK)

    def create(self, request, anchor, intake_id):
        """Submit a new :class:`Issue` + :class:`IntakeIssue` pair for triage.

        Validates ``issue.name`` (required) and ``issue.priority`` (must
        be in ``["low", "medium", "high", "urgent", "none"]``). Looks up
        or lazily creates the project's Triage state, creates the
        :class:`Issue` pinned to that state, enqueues an
        ``issue.activity.created`` event via Celery (RabbitMQ), then
        creates the :class:`IntakeIssue` bridge row tagged with
        ``SourceType.IN_APP``.
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")
        if project_deploy_board.intake is None:
            return Response(
                {"error": "Intake is not enabled for this Project Board"},
                status=status.HTTP_400_BAD_REQUEST,
            )

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

        # get the triage state
        triage_state = State.triage_objects.filter(
            project_id=project_deploy_board.project_id, workspace_id=project_deploy_board.workspace_id
        ).first()

        if not triage_state:
            triage_state = State.objects.create(
                name="Triage",
                group=StateGroup.TRIAGE.value,
                project_id=project_deploy_board.project_id,
                workspace_id=project_deploy_board.workspace_id,
                color="#4E5355",
                sequence=65000,
                default=False,
            )

        # create an issue
        issue = Issue.objects.create(
            name=request.data.get("issue", {}).get("name"),
            description_json=request.data.get("issue", {}).get("description_json", {}),
            description_html=request.data.get("issue", {}).get("description_html", "<p></p>"),
            priority=request.data.get("issue", {}).get("priority", "low"),
            project_id=project_deploy_board.project_id,
            state_id=triage_state.id,
        )

        # Create an Issue Activity
        issue_activity.delay(
            type="issue.activity.created",
            requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
            actor_id=str(request.user.id),
            issue_id=str(issue.id),
            project_id=str(project_deploy_board.project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
        )
        # create an intake issue
        IntakeIssue.objects.create(
            intake_id=intake_id,
            project_id=project_deploy_board.project_id,
            issue=issue,
            source=SourceType.IN_APP,
        )

        serializer = IssueStateIntakeSerializer(issue)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def partial_update(self, request, anchor, intake_id, pk):
        """Update the submitter's own intake issue's name / description fields.

        Returns 400 when the requester is not the original
        ``intake_issue.created_by_id`` (intake submitters can only edit
        their own submissions before they are accepted). Writes through
        :class:`IssueCreateSerializer` with
        ``context={"allow_triage_state": True}`` so the issue can stay
        in its triage state during the edit, then enqueues an
        ``issue.activity.updated`` event via Celery (RabbitMQ).
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")
        if project_deploy_board.intake is None:
            return Response(
                {"error": "Intake is not enabled for this Project Board"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        intake_issue = IntakeIssue.objects.get(
            pk=pk,
            workspace_id=project_deploy_board.workspace_id,
            project_id=project_deploy_board.project_id,
            intake_id=intake_id,
        )
        # Get the project member
        if str(intake_issue.created_by_id) != str(request.user.id):
            return Response(
                {"error": "You cannot edit intake issues"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get issue data
        issue_data = request.data.pop("issue", False)

        issue = Issue.objects.get(
            pk=intake_issue.issue_id,
            workspace_id=project_deploy_board.workspace_id,
            project_id=project_deploy_board.project_id,
        )
        # viewers and guests since only viewers and guests
        issue_data = {
            "name": issue_data.get("name", issue.name),
            "description_html": issue_data.get("description_html", issue.description_html),
            "description_json": issue_data.get("description_json", issue.description_json),
        }

        issue_serializer = IssueCreateSerializer(
            issue,
            data=issue_data,
            partial=True,
            context={"project_id": project_deploy_board.project_id, "allow_triage_state": True},
        )

        if issue_serializer.is_valid():
            current_instance = issue
            # Log all the updates
            requested_data = json.dumps(issue_data, cls=DjangoJSONEncoder)
            if issue is not None:
                issue_activity.delay(
                    type="issue.activity.updated",
                    requested_data=requested_data,
                    actor_id=str(request.user.id),
                    issue_id=str(issue.id),
                    project_id=str(project_deploy_board.project_id),
                    current_instance=json.dumps(IssueSerializer(current_instance).data, cls=DjangoJSONEncoder),
                    epoch=int(timezone.now().timestamp()),
                )
            issue_serializer.save()
            return Response(issue_serializer.data, status=status.HTTP_200_OK)
        return Response(issue_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def retrieve(self, request, anchor, intake_id, pk):
        """Return the :class:`IssueStateIntakeSerializer` payload for a single submission."""
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")
        if project_deploy_board.intake is None:
            return Response(
                {"error": "Intake is not enabled for this Project Board"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        intake_issue = IntakeIssue.objects.get(
            pk=pk,
            workspace_id=project_deploy_board.workspace_id,
            project_id=project_deploy_board.project_id,
            intake_id=intake_id,
        )
        issue = Issue.objects.get(
            pk=intake_issue.issue_id,
            workspace_id=project_deploy_board.workspace_id,
            project_id=project_deploy_board.project_id,
        )
        serializer = IssueStateIntakeSerializer(issue)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def destroy(self, request, anchor, intake_id, pk):
        """Hard-delete the submitter's own intake issue (creator-only).

        Returns 400 when the requester is not the original
        ``intake_issue.created_by_id``. The ``.delete()`` call cascades
        to the underlying :class:`Issue` only through the model FK
        relationships declared at the database layer (no explicit
        ``Issue.delete()`` is invoked here).
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")
        if project_deploy_board.intake is None:
            return Response(
                {"error": "Intake is not enabled for this Project Board"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        intake_issue = IntakeIssue.objects.get(
            pk=pk,
            workspace_id=project_deploy_board.workspace_id,
            project_id=project_deploy_board.project_id,
            intake_id=intake_id,
        )

        if str(intake_issue.created_by_id) != str(request.user.id):
            return Response(
                {"error": "You cannot delete intake issue"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        intake_issue.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
