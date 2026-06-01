# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public issue / comment / reaction / vote endpoints for the ``plane.space`` API.

Defines the six anchor-resolved endpoints that power the
published-deploy-board UI's interactive features:

* :class:`ProjectIssuesPublicEndpoint` -- anchor-scoped list of issues
  with grouping, sub-grouping, ordering, filtering, and offset
  pagination (via :class:`GroupedOffsetPaginator` /
  :class:`SubGroupedOffsetPaginator`). Anonymous-readable.
* :class:`IssueCommentPublicViewSet` -- issue comments CRUD; reads are
  anonymous, writes are authenticated; gated by
  :attr:`DeployBoard.is_comments_enabled` and restricted to
  ``access="EXTERNAL"`` comments.
* :class:`IssueReactionPublicViewSet` -- issue-level reaction CRUD
  gated by :attr:`DeployBoard.is_reactions_enabled`.
* :class:`CommentReactionPublicViewSet` -- comment-level reaction
  CRUD gated by :attr:`DeployBoard.is_reactions_enabled`.
* :class:`IssueVotePublicViewSet` -- issue upvote/downvote upsert
  gated by :attr:`DeployBoard.is_votes_enabled`.
* :class:`IssueRetrievePublicEndpoint` -- single-issue retrieve with
  inlined ``vote_items`` and ``reaction_items`` JSON arrays for the
  detail view; anonymous-readable.

All endpoints mount under ``api/public/`` and resolve a
:class:`DeployBoard` row by ``anchor`` to derive workspace + project
scope. Anonymous viewers reach a deliberate subset of the surface
(``list`` / ``retrieve`` / list-style reads); first-class write
actions require ``IsAuthenticated`` and additionally register
:class:`ProjectPublicMember` rows on every write -- this is how Plane
tracks the long-lived list of authenticated visitors who have
interacted with a public board (so they can later be promoted to
full :class:`ProjectMember` rows by an admin).

Every write enqueues an ``issue_activity`` Celery task via RabbitMQ
(NOT Redis -- Redis is caching/session only) so the wider
notification + activity-feed pipelines stay in sync with public-board
interactions.
"""

# Python imports
import json

# Django imports
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models.functions import Coalesce, JSONObject
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone
from django.db.models import (
    Exists,
    F,
    Q,
    Prefetch,
    UUIDField,
    Case,
    When,
    JSONField,
    Value,
    OuterRef,
    Func,
    CharField,
    Subquery,
)
from django.db.models.functions import Concat

# Third Party imports
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated


# Module imports
from .base import BaseAPIView, BaseViewSet

# fetch the space app grouper function separately
from plane.space.utils.grouper import (
    issue_group_values,
    issue_on_results,
    issue_queryset_grouper,
)


from plane.utils.order_queryset import order_issue_queryset
from plane.utils.paginator import GroupedOffsetPaginator, SubGroupedOffsetPaginator
from plane.app.serializers import (
    CommentReactionSerializer,
    IssueCommentSerializer,
    IssueReactionSerializer,
    IssueVoteSerializer,
)
from plane.db.models import (
    Issue,
    IssueComment,
    IssueLink,
    IssueReaction,
    ProjectMember,
    CommentReaction,
    DeployBoard,
    IssueVote,
    ProjectPublicMember,
    FileAsset,
    CycleIssue,
)
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.issue_filters import issue_filters


class ProjectIssuesPublicEndpoint(BaseAPIView):
    """Anchor-scoped LIST of issues for a published deploy-board (grouped + paginated).

    HTTP methods and URL patterns:
        GET /api/public/anchor/<str:anchor>/issues/
            (name: ``project-issues``)

    Request body:
        None (LIST-only endpoint; all parameters are read from
        ``request.query_params``).

    Query parameters:
        order_by (str, optional, default=``"-created_at"``): ordering
            field; passed through
            :func:`plane.utils.order_queryset.order_issue_queryset`
            which applies the canonical ordering precedence (priority
            overrides created_at by default for most fields).
        group_by (str, optional): single-axis grouping field (e.g.
            ``"state"``, ``"priority"``, ``"labels"``, ``"assignees"``,
            ``"cycle"``, ``"module"``). When set, the response uses
            :class:`GroupedOffsetPaginator`.
        sub_group_by (str, optional): second-axis grouping field. When
            set in addition to ``group_by``, the response uses
            :class:`SubGroupedOffsetPaginator`. If
            ``group_by == sub_group_by``, returns 400 with
            ``{"error": "Group by and sub group by cannot have same
            parameters"}``.
        Any filter recognized by
            :func:`plane.utils.issue_filters.issue_filters` (priority,
            state, labels, assignees, start_date, target_date, etc.).

    Response shape:
        200 OK: paginated payload via :class:`BaseAPIView.paginate` --
            specific shape depends on the paginator used. When
            ungrouped: simple offset envelope with ``results`` list.
            When grouped: payload includes ``group_by_fields`` list
            and ``count_filter`` exclusion of archived / draft issues
            and of issues stuck in intake states 1 / -1 / 2.
        400 Bad Request: when ``group_by == sub_group_by``.
        404 Not Found: ``{"error": "Project is not published"}`` when
            the anchor does not resolve to a project-entity
            :class:`DeployBoard` row.

    Permissions:
        ``permission_classes = [AllowAny]``.

    Queryset filter:
        Starts from :class:`Issue.issue_objects` (the manager that
        already excludes archived + draft + soft-deleted rows by
        default), filters to ``workspace.slug`` + ``project_id`` from
        the deploy board, then applies user filters from
        ``issue_filters``. Annotates each row with:

        * ``cycle_id``: the active :class:`CycleIssue` (NULL when not
          in any cycle);
        * ``link_count``: number of :class:`IssueLink` rows;
        * ``attachment_count``: number of
          :class:`FileAsset.EntityTypeContext.ISSUE_ATTACHMENT` rows
          (description attachments are NOT counted);
        * ``sub_issues_count``: number of issues whose ``parent`` is
          this row.

        The pagination call additionally applies a ``count_filter``
        excluding ``archived_at IS NOT NULL`` and ``is_draft=True``
        and intake-state issues (status in 1 / -1 / 2 OR not in
        intake at all) -- so the displayed count matches what would
        be visible.

    Side effects:
        None -- read-only endpoint, no Celery dispatch, no
        :class:`ProjectPublicMember` registration.
    """

    permission_classes = [AllowAny]

    def get(self, request, anchor):
        """List issues for ``anchor``'s deploy board with grouping/pagination.

        Resolves the deploy board (404 if absent), filters
        :class:`Issue.issue_objects` to the board's workspace +
        project, annotates ``cycle_id`` / ``link_count`` /
        ``attachment_count`` / ``sub_issues_count``, applies
        user-supplied filters and ordering, then paginates via the
        appropriate :class:`GroupedOffsetPaginator` /
        :class:`SubGroupedOffsetPaginator` based on ``group_by`` /
        ``sub_group_by`` query parameters.
        """
        filters = issue_filters(request.query_params, "GET")
        order_by_param = request.GET.get("order_by", "-created_at")

        deploy_board = DeployBoard.objects.filter(anchor=anchor, entity_name="project").first()
        if not deploy_board:
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)

        project_id = deploy_board.entity_identifier
        slug = deploy_board.workspace.slug

        issue_queryset = (
            Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id)
            .select_related("workspace", "project", "state", "parent")
            .prefetch_related("assignees", "labels", "issue_module__module")
            .prefetch_related(
                Prefetch(
                    "issue_reactions",
                    queryset=IssueReaction.objects.select_related("actor"),
                )
            )
            .prefetch_related(Prefetch("votes", queryset=IssueVote.objects.select_related("actor")))
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
        ).distinct()

        issue_queryset = issue_queryset.filter(**filters)

        # Issue queryset
        issue_queryset, order_by_param = order_issue_queryset(
            issue_queryset=issue_queryset, order_by_param=order_by_param
        )

        # Group by
        group_by = request.GET.get("group_by", False)
        sub_group_by = request.GET.get("sub_group_by", False)

        # issue queryset
        issue_queryset = issue_queryset_grouper(queryset=issue_queryset, group_by=group_by, sub_group_by=sub_group_by)

        if group_by:
            if sub_group_by:
                if group_by == sub_group_by:
                    return Response(
                        {"error": "Group by and sub group by cannot have same parameters"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                else:
                    return self.paginate(
                        request=request,
                        order_by=order_by_param,
                        queryset=issue_queryset,
                        on_results=lambda issues: issue_on_results(
                            group_by=group_by, issues=issues, sub_group_by=sub_group_by
                        ),
                        paginator_cls=SubGroupedOffsetPaginator,
                        group_by_fields=issue_group_values(
                            field=group_by,
                            slug=slug,
                            project_id=project_id,
                            filters=filters,
                        ),
                        sub_group_by_fields=issue_group_values(
                            field=sub_group_by,
                            slug=slug,
                            project_id=project_id,
                            filters=filters,
                        ),
                        group_by_field_name=group_by,
                        sub_group_by_field_name=sub_group_by,
                        count_filter=Q(
                            Q(issue_intake__status=1)
                            | Q(issue_intake__status=-1)
                            | Q(issue_intake__status=2)
                            | Q(issue_intake__isnull=True),
                            archived_at__isnull=True,
                            is_draft=False,
                        ),
                    )
            else:
                # Group paginate
                return self.paginate(
                    request=request,
                    order_by=order_by_param,
                    queryset=issue_queryset,
                    on_results=lambda issues: issue_on_results(
                        group_by=group_by, issues=issues, sub_group_by=sub_group_by
                    ),
                    paginator_cls=GroupedOffsetPaginator,
                    group_by_fields=issue_group_values(
                        field=group_by,
                        slug=slug,
                        project_id=project_id,
                        filters=filters,
                    ),
                    group_by_field_name=group_by,
                    count_filter=Q(
                        Q(issue_intake__status=1)
                        | Q(issue_intake__status=-1)
                        | Q(issue_intake__status=2)
                        | Q(issue_intake__isnull=True),
                        archived_at__isnull=True,
                        is_draft=False,
                    ),
                )
        else:
            return self.paginate(
                order_by=order_by_param,
                request=request,
                queryset=issue_queryset,
                on_results=lambda issues: issue_on_results(group_by=group_by, issues=issues, sub_group_by=sub_group_by),
            )


class IssueCommentPublicViewSet(BaseViewSet):
    """Anchor-scoped issue-comments CRUD for published deploy-boards.

    HTTP methods and URL patterns:
        GET    /api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/comments/
                  (name: ``issue-comments``)
        POST   (same path)
        GET    /api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/comments/<uuid:pk>/
                  (name: ``issue-comment-detail``)
        PATCH  (same detail path)
        DELETE (same detail path)

    Request body (POST):
        comment_html (str, required): rendered HTML.
        comment_json (dict, optional): ProseMirror/TipTap JSON.
        comment_stripped (str, optional): plain-text fallback.
        actor and access are SERVER-SET -- ``actor=request.user``,
            ``access="EXTERNAL"``. Clients cannot override these.

    Request body (PATCH):
        Partial subset of the POST schema; ``actor`` / ``access``
        cannot be re-set by clients.

    Request body (DELETE):
        None.

    Response shape:
        LIST 200 OK: array of :class:`IssueCommentSerializer`
            payloads, ordered by ``created_at`` ascending, annotated
            with ``is_member`` (Exists subquery: True when the
            comment author is a current active
            :class:`ProjectMember`).
        POST 201 Created: :class:`IssueCommentSerializer` payload.
        PATCH 200 OK: :class:`IssueCommentSerializer` payload.
        DELETE 204 No Content on success.
        POST/PATCH/DELETE 400 Bad Request: ``{"error": "Comments are
            not enabled for this project"}`` when
            ``deploy_board.is_comments_enabled`` is False, OR
            serializer error payload on invalid POST/PATCH.

    Permissions (``get_permissions`` override):
        ``[AllowAny]`` for ``list`` / ``retrieve``;
        ``[IsAuthenticated]`` for ``create`` / ``partial_update`` /
        ``destroy``. Anonymous viewers can READ comments but cannot
        post / edit / delete.

    Queryset filter (``get_queryset``):
        Resolves :class:`DeployBoard` by anchor +
        ``entity_name="project"``; returns
        :class:`IssueComment.objects.none()` if
        ``is_comments_enabled=False``. Otherwise scopes to:

        * workspace + issue_id from URL kwargs;
        * ``access="EXTERNAL"`` (INTERNAL comments are NOT exposed
          on the public surface -- this is a SECURITY BOUNDARY);
        * select_related on project / workspace / issue;
        * ``is_member`` Exists annotation indicating whether the
          comment's actor is a current active project member (used
          by the UI to distinguish staff replies from
          anonymous-visitor comments).

        Ordered by ``created_at`` ascending (oldest first -- comment
        threads read top-to-bottom).

    Edit/delete authorization (inline in ``partial_update`` /
    ``destroy``):
        :class:`IssueComment.objects.get(pk=pk, actor=request.user)`
        -- only the comment's original actor can edit or delete it.
        Non-author requests raise
        :class:`IssueComment.DoesNotExist`, which the base handler
        maps to 404.

    Background tasks (Celery via RabbitMQ -- NOT Redis):
        Every successful write enqueues
        :func:`plane.bgtasks.issue_activities_task.issue_activity`
        with ``type="comment.activity.created"`` / ``...updated`` /
        ``...deleted`` so downstream activity-feed / notification
        consumers stay in sync.

    Visitor tracking:
        On every successful POST, if the actor is not already a
        :class:`ProjectMember`, a :class:`ProjectPublicMember` row
        is created (or fetched). This lets workspace owners later
        see which authenticated users interacted with a published
        board.
    """

    serializer_class = IssueCommentSerializer
    model = IssueComment

    filterset_fields = ["issue__id", "workspace__id"]

    def get_permissions(self):
        """Return ``[AllowAny]`` for list/retrieve, ``[IsAuthenticated]`` for writes."""
        if self.action in ["list", "retrieve"]:
            self.permission_classes = [AllowAny]
        else:
            self.permission_classes = [IsAuthenticated]

        return super(IssueCommentPublicViewSet, self).get_permissions()

    def get_queryset(self):
        """Return ``EXTERNAL``-access :class:`IssueComment` rows for the resolved board.

        Returns an empty queryset when ``is_comments_enabled`` is
        False or the anchor does not resolve. Annotates each row
        with ``is_member`` (True when the comment's actor is a
        current active :class:`ProjectMember`); ordered by
        ``created_at`` ascending. The ``access="EXTERNAL"`` filter is
        a SECURITY BOUNDARY -- INTERNAL comments (staff-only) are
        never exposed on the public surface.
        """
        try:
            project_deploy_board = DeployBoard.objects.get(anchor=self.kwargs.get("anchor"), entity_name="project")
            if project_deploy_board.is_comments_enabled:
                return self.filter_queryset(
                    super()
                    .get_queryset()
                    .filter(workspace_id=project_deploy_board.workspace_id)
                    .filter(issue_id=self.kwargs.get("issue_id"))
                    .filter(access="EXTERNAL")
                    .select_related("project")
                    .select_related("workspace")
                    .select_related("issue")
                    .annotate(
                        is_member=Exists(
                            ProjectMember.objects.filter(
                                workspace_id=project_deploy_board.workspace_id,
                                project_id=project_deploy_board.project_id,
                                member_id=self.request.user.id,
                                is_active=True,
                            )
                        )
                    )
                    .distinct()
                ).order_by("created_at")
            return IssueComment.objects.none()
        except DeployBoard.DoesNotExist:
            return IssueComment.objects.none()

    def create(self, request, anchor, issue_id):
        """Create an ``access="EXTERNAL"`` comment on a public-board issue.

        Forces ``actor=request.user`` and ``access="EXTERNAL"``
        server-side (client values are ignored). On success enqueues
        ``comment.activity.created`` via Celery (RabbitMQ) and
        registers a :class:`ProjectPublicMember` row if the actor is
        not yet a project member.
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")

        if not project_deploy_board.is_comments_enabled:
            return Response(
                {"error": "Comments are not enabled for this project"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = IssueCommentSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(
                project_id=project_deploy_board.project_id,
                issue_id=issue_id,
                actor=request.user,
                access="EXTERNAL",
            )
            issue_activity.delay(
                type="comment.activity.created",
                requested_data=json.dumps(serializer.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_deploy_board.project_id),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
            )
            if not ProjectMember.objects.filter(
                project_id=project_deploy_board.project_id,
                member=request.user,
                is_active=True,
            ).exists():
                # Add the user for workspace tracking
                _ = ProjectPublicMember.objects.get_or_create(
                    project_id=project_deploy_board.project_id, member=request.user
                )

            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def partial_update(self, request, anchor, issue_id, pk):
        """Update a comment authored by ``request.user`` on a public-board issue.

        Author-only: the lookup
        ``IssueComment.objects.get(pk=pk, actor=request.user)``
        raises DoesNotExist (mapped to 404 by the base handler) when
        a different user attempts the edit. On success enqueues
        ``comment.activity.updated`` via Celery (RabbitMQ).
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")

        if not project_deploy_board.is_comments_enabled:
            return Response(
                {"error": "Comments are not enabled for this project"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        comment = IssueComment.objects.get(pk=pk, actor=request.user)
        serializer = IssueCommentSerializer(comment, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            issue_activity.delay(
                type="comment.activity.updated",
                requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_deploy_board.project_id),
                current_instance=json.dumps(IssueCommentSerializer(comment).data, cls=DjangoJSONEncoder),
                epoch=int(timezone.now().timestamp()),
            )
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def destroy(self, request, anchor, issue_id, pk):
        """Delete a comment authored by ``request.user`` on a public-board issue.

        Author-only (same lookup pattern as ``partial_update``). On
        success enqueues ``comment.activity.deleted`` via Celery
        (RabbitMQ) BEFORE the row is removed so the activity payload
        can capture the pre-delete state.
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")

        if not project_deploy_board.is_comments_enabled:
            return Response(
                {"error": "Comments are not enabled for this project"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        comment = IssueComment.objects.get(pk=pk, actor=request.user)
        issue_activity.delay(
            type="comment.activity.deleted",
            requested_data=json.dumps({"comment_id": str(pk)}),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_deploy_board.project_id),
            current_instance=json.dumps(IssueCommentSerializer(comment).data, cls=DjangoJSONEncoder),
            epoch=int(timezone.now().timestamp()),
        )
        comment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueReactionPublicViewSet(BaseViewSet):
    """Anchor-scoped issue-reaction CRUD for published deploy-boards.

    HTTP methods and URL patterns:
        GET    /api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/reactions/
                  (name: ``issue-reactions``)
        POST   (same path)
        DELETE /api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/reactions/<str:reaction_code>/
                  (name: ``issue-reaction-delete``)

    Request body (POST):
        reaction (str, required): emoji shortcode / reaction code
            (e.g. ``"1f44d"``); validated by
            :class:`IssueReactionSerializer`.

    Request body (DELETE):
        None -- the reaction to delete is identified by
        ``reaction_code`` in the URL path (NOT by primary key),
        restricted to reactions authored by ``request.user``.

    Response shape:
        LIST 200 OK: array of :class:`IssueReactionSerializer`
            payloads ordered by ``-created_at``.
        POST 201 Created: :class:`IssueReactionSerializer` payload
            OR 400 Bad Request serializer-error payload.
        DELETE 204 No Content on success.
        POST/DELETE 400 Bad Request: ``{"error": "Reactions are not
            enabled for this project board"}`` when
            ``deploy_board.is_reactions_enabled`` is False.

    Permissions:
        Inherits ``BaseViewSet.permission_classes = [IsAuthenticated]``
        -- list/retrieve and write all require auth (unlike
        :class:`IssueCommentPublicViewSet`, which uses a permissions
        override to allow anonymous reads).

    Queryset filter (``get_queryset``):
        Resolves :class:`DeployBoard` by workspace ``slug`` and
        ``project_id`` from URL kwargs (NOT by ``anchor``), gates on
        ``is_reactions_enabled=True``, scopes to workspace + project
        + issue, orders by ``-created_at``.

    Background tasks (Celery via RabbitMQ -- NOT Redis):
        ``issue_reaction.activity.created`` on POST,
        ``issue_reaction.activity.deleted`` on DELETE.

    Visitor tracking:
        On every successful POST, if the actor is not already a
        :class:`ProjectMember`, a :class:`ProjectPublicMember` row
        is created.
    """

    serializer_class = IssueReactionSerializer
    model = IssueReaction

    def get_queryset(self):
        """Return :class:`IssueReaction` rows for the resolved board (gated on ``is_reactions_enabled``)."""
        try:
            project_deploy_board = DeployBoard.objects.get(
                workspace__slug=self.kwargs.get("slug"),
                project_id=self.kwargs.get("project_id"),
            )
            if project_deploy_board.is_reactions_enabled:
                return (
                    super()
                    .get_queryset()
                    .filter(workspace__slug=self.kwargs.get("slug"))
                    .filter(project_id=self.kwargs.get("project_id"))
                    .filter(issue_id=self.kwargs.get("issue_id"))
                    .order_by("-created_at")
                    .distinct()
                )
            return IssueReaction.objects.none()
        except DeployBoard.DoesNotExist:
            return IssueReaction.objects.none()

    def create(self, request, anchor, issue_id):
        """Create a reaction on a public-board issue.

        Gated on ``deploy_board.is_reactions_enabled``. Registers a
        :class:`ProjectPublicMember` if the actor is not yet a
        project member, then enqueues
        ``issue_reaction.activity.created`` via Celery (RabbitMQ).
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")

        if not project_deploy_board.is_reactions_enabled:
            return Response(
                {"error": "Reactions are not enabled for this project board"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = IssueReactionSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(
                project_id=project_deploy_board.project_id,
                issue_id=issue_id,
                actor=request.user,
            )
            if not ProjectMember.objects.filter(
                project_id=project_deploy_board.project_id,
                member=request.user,
                is_active=True,
            ).exists():
                # Add the user for workspace tracking
                _ = ProjectPublicMember.objects.get_or_create(
                    project_id=project_deploy_board.project_id, member=request.user
                )
            issue_activity.delay(
                type="issue_reaction.activity.created",
                requested_data=json.dumps(self.request.data, cls=DjangoJSONEncoder),
                actor_id=str(self.request.user.id),
                issue_id=str(self.kwargs.get("issue_id", None)),
                project_id=str(project_deploy_board.project_id),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def destroy(self, request, anchor, issue_id, reaction_code):
        """Delete the caller's own reaction identified by ``reaction_code`` (path).

        The reaction is looked up by ``actor=request.user`` +
        ``reaction=reaction_code`` so users can only remove their own
        reactions. Enqueues ``issue_reaction.activity.deleted`` via
        Celery (RabbitMQ).
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")

        if not project_deploy_board.is_reactions_enabled:
            return Response(
                {"error": "Reactions are not enabled for this project board"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        issue_reaction = IssueReaction.objects.get(
            workspace_id=project_deploy_board.workspace_id,
            issue_id=issue_id,
            reaction=reaction_code,
            actor=request.user,
        )
        issue_activity.delay(
            type="issue_reaction.activity.deleted",
            requested_data=None,
            actor_id=str(self.request.user.id),
            issue_id=str(self.kwargs.get("issue_id", None)),
            project_id=str(project_deploy_board.project_id),
            current_instance=json.dumps({"reaction": str(reaction_code), "identifier": str(issue_reaction.id)}),
            epoch=int(timezone.now().timestamp()),
        )
        issue_reaction.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CommentReactionPublicViewSet(BaseViewSet):
    """Anchor-scoped comment-reaction CRUD for published deploy-boards.

    HTTP methods and URL patterns:
        GET    /api/public/anchor/<str:anchor>/comments/<uuid:comment_id>/reactions/
                  (name: ``comment-reactions``)
        POST   (same path)
        DELETE /api/public/anchor/<str:anchor>/comments/<uuid:comment_id>/reactions/<str:reaction_code>/
                  (name: ``comment-reaction-delete``)

    Request body (POST):
        reaction (str, required): emoji shortcode / reaction code;
            validated by :class:`CommentReactionSerializer`.

    Request body (DELETE):
        None -- reaction identified by ``reaction_code`` (path) and
        ``actor=request.user``.

    Response shape:
        LIST 200 OK: array of :class:`CommentReactionSerializer`
            payloads ordered by ``-created_at``.
        POST 201 Created OR 400 serializer-error payload.
        DELETE 204 No Content on success.
        POST/DELETE 400 Bad Request: ``{"error": "Reactions are not
            enabled for this board"}`` when ``is_reactions_enabled``
            is False.

    Permissions:
        Inherits ``BaseViewSet.permission_classes = [IsAuthenticated]``.

    Queryset filter (``get_queryset``):
        Resolves :class:`DeployBoard` by ``anchor`` +
        ``entity_name``; gates on ``is_reactions_enabled``; scopes to
        workspace + project + comment_id; orders by ``-created_at``.

    Background tasks (Celery via RabbitMQ -- NOT Redis):
        ``comment_reaction.activity.created`` on POST,
        ``comment_reaction.activity.deleted`` on DELETE.

    Visitor tracking:
        On every successful POST, if the actor is not already a
        :class:`ProjectMember`, a :class:`ProjectPublicMember` row
        is created.
    """

    serializer_class = CommentReactionSerializer
    model = CommentReaction

    def get_queryset(self):
        """Return :class:`CommentReaction` rows for the resolved board (gated on ``is_reactions_enabled``)."""
        try:
            project_deploy_board = DeployBoard.objects.get(anchor=self.kwargs.get("anchor"), entity_name="project")
            if project_deploy_board.is_reactions_enabled:
                return (
                    super()
                    .get_queryset()
                    .filter(workspace_id=project_deploy_board.workspace_id)
                    .filter(project_id=project_deploy_board.project_id)
                    .filter(comment_id=self.kwargs.get("comment_id"))
                    .order_by("-created_at")
                    .distinct()
                )
            return CommentReaction.objects.none()
        except DeployBoard.DoesNotExist:
            return CommentReaction.objects.none()

    def create(self, request, anchor, comment_id):
        """Create a reaction on a public-board comment.

        Gated on ``deploy_board.is_reactions_enabled``. Registers a
        :class:`ProjectPublicMember` if the actor is not yet a
        project member, then enqueues
        ``comment_reaction.activity.created`` via Celery (RabbitMQ).
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")

        if not project_deploy_board.is_reactions_enabled:
            return Response(
                {"error": "Reactions are not enabled for this board"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = CommentReactionSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(
                project_id=project_deploy_board.project_id,
                comment_id=comment_id,
                actor=request.user,
            )
            if not ProjectMember.objects.filter(
                project_id=project_deploy_board.project_id,
                member=request.user,
                is_active=True,
            ).exists():
                # Add the user for workspace tracking
                _ = ProjectPublicMember.objects.get_or_create(
                    project_id=project_deploy_board.project_id, member=request.user
                )
            issue_activity.delay(
                type="comment_reaction.activity.created",
                requested_data=json.dumps(self.request.data, cls=DjangoJSONEncoder),
                actor_id=str(self.request.user.id),
                issue_id=None,
                project_id=str(self.kwargs.get("project_id", None)),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def destroy(self, request, anchor, comment_id, reaction_code):
        """Delete the caller's own comment-reaction identified by ``reaction_code``.

        Author-only lookup (``actor=request.user``). Enqueues
        ``comment_reaction.activity.deleted`` via Celery (RabbitMQ).
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")
        if not project_deploy_board.is_reactions_enabled:
            return Response(
                {"error": "Reactions are not enabled for this board"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        comment_reaction = CommentReaction.objects.get(
            project_id=project_deploy_board.project_id,
            workspace_id=project_deploy_board.workspace_id,
            comment_id=comment_id,
            reaction=reaction_code,
            actor=request.user,
        )
        issue_activity.delay(
            type="comment_reaction.activity.deleted",
            requested_data=None,
            actor_id=str(self.request.user.id),
            issue_id=None,
            project_id=str(project_deploy_board.project_id),
            current_instance=json.dumps(
                {
                    "reaction": str(reaction_code),
                    "identifier": str(comment_reaction.id),
                    "comment_id": str(comment_id),
                }
            ),
            epoch=int(timezone.now().timestamp()),
        )
        comment_reaction.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueVotePublicViewSet(BaseViewSet):
    """Anchor-scoped issue voting (1 / -1 upsert) for published deploy-boards.

    HTTP methods and URL patterns:
        GET    /api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/votes/
                  (name: ``issue-votes``)
        POST   (same path)
        DELETE (same path -- no ``pk`` parameter; vote is identified
                 by actor + issue_id) (name: ``issue-vote``)

    Request body (POST):
        vote (int, optional, default=``1``): ``1`` = upvote,
            ``-1`` = downvote. Stored on the existing
            :class:`IssueVote` row (looked up by
            ``(actor, project, issue)``) if present, or on a
            newly-created row if absent -- this is an UPSERT pattern
            via :class:`IssueVote.objects.get_or_create`.

    Request body (DELETE):
        None -- the vote to delete is uniquely identified by
        ``actor=request.user`` + ``issue_id`` + project + workspace.

    Response shape:
        LIST 200 OK: array of :class:`IssueVoteSerializer` payloads.
        POST 201 Created: :class:`IssueVoteSerializer` payload.
        DELETE 204 No Content on success.

        Gating on ``is_votes_enabled=False`` is enforced via
        :func:`get_queryset` (returns ``IssueVote.objects.none()``);
        action handlers (``create``/``destroy``) do NOT raise an
        explicit 400 for disabled votes -- instead the create
        proceeds and the next list call returns empty.

        # INTENT UNCLEAR: ``create`` and ``destroy`` do not check
        # ``is_votes_enabled`` (unlike comments / reactions which
        # explicitly 400 when disabled). Inputs proceed and write
        # rows; only LIST is gated. Observed; documented; not
        # modified.

    Permissions:
        Inherits ``BaseViewSet.permission_classes = [IsAuthenticated]``.

    Queryset filter (``get_queryset``):
        Resolves :class:`DeployBoard` using
        ``workspace__slug=anchor``.

        # INTENT UNCLEAR: this is a NON-OBVIOUS use of the ``anchor``
        # URL kwarg as a workspace slug filter -- verified against
        # the source, NOT modified.

        Gates on ``is_votes_enabled``; scopes to workspace + project
        + issue_id.

    Background tasks (Celery via RabbitMQ -- NOT Redis):
        ``issue_vote.activity.created`` on POST,
        ``issue_vote.activity.deleted`` on DELETE.

    Visitor tracking:
        On every POST, if the actor is not already a
        :class:`ProjectMember`, a :class:`ProjectPublicMember` row
        is created.
    """

    model = IssueVote
    serializer_class = IssueVoteSerializer

    def get_queryset(self):
        """Return :class:`IssueVote` rows for the resolved board (gated on ``is_votes_enabled``)."""
        try:
            project_deploy_board = DeployBoard.objects.get(
                workspace__slug=self.kwargs.get("anchor"), entity_name="project"
            )
            if project_deploy_board.is_votes_enabled:
                return (
                    super()
                    .get_queryset()
                    .filter(issue_id=self.kwargs.get("issue_id"))
                    .filter(workspace_id=project_deploy_board.workspace_id)
                    .filter(project_id=project_deploy_board.project_id)
                )
            return IssueVote.objects.none()
        except DeployBoard.DoesNotExist:
            return IssueVote.objects.none()

    def create(self, request, anchor, issue_id):
        """Upsert the caller's vote on a public-board issue.

        Uses :class:`IssueVote.objects.get_or_create` keyed on
        ``(actor, project, issue)`` so each user can have at most
        ONE vote row per issue; subsequent calls update the ``vote``
        value on the existing row rather than creating duplicates.
        Registers a :class:`ProjectPublicMember` if the actor is not
        yet a project member, then enqueues
        ``issue_vote.activity.created`` via Celery (RabbitMQ).
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")
        issue_vote, _ = IssueVote.objects.get_or_create(
            actor_id=request.user.id,
            project_id=project_deploy_board.project_id,
            issue_id=issue_id,
        )
        # Add the user for workspace tracking
        if not ProjectMember.objects.filter(
            project_id=project_deploy_board.project_id,
            member=request.user,
            is_active=True,
        ).exists():
            _ = ProjectPublicMember.objects.get_or_create(
                project_id=project_deploy_board.project_id, member=request.user
            )
        issue_vote.vote = request.data.get("vote", 1)
        issue_vote.save()
        issue_activity.delay(
            type="issue_vote.activity.created",
            requested_data=json.dumps(self.request.data, cls=DjangoJSONEncoder),
            actor_id=str(self.request.user.id),
            issue_id=str(self.kwargs.get("issue_id", None)),
            project_id=str(project_deploy_board.project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
        )
        serializer = IssueVoteSerializer(issue_vote)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def destroy(self, request, anchor, issue_id):
        """Delete the caller's own vote on a public-board issue.

        Vote is identified by ``actor=request.user`` + ``issue_id``
        -- callers cannot delete other users' votes. Enqueues
        ``issue_vote.activity.deleted`` via Celery (RabbitMQ).
        """
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")
        issue_vote = IssueVote.objects.get(
            issue_id=issue_id,
            actor_id=request.user.id,
            project_id=project_deploy_board.project_id,
            workspace_id=project_deploy_board.workspace_id,
        )
        issue_activity.delay(
            type="issue_vote.activity.deleted",
            requested_data=None,
            actor_id=str(self.request.user.id),
            issue_id=str(self.kwargs.get("issue_id", None)),
            project_id=str(project_deploy_board.project_id),
            current_instance=json.dumps({"vote": str(issue_vote.vote), "identifier": str(issue_vote.id)}),
            epoch=int(timezone.now().timestamp()),
        )
        issue_vote.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueRetrievePublicEndpoint(BaseAPIView):
    """Anchor-scoped single-issue RETRIEVE with inlined votes and reactions.

    HTTP methods and URL patterns:
        GET /api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/
            (name: ``issue-detail``)

    Request body:
        None.

    Response shape:
        200 OK: a single dict (``.values(...).first()``) projecting:
            id, name, state_id, sort_order, description_json,
            description_html, description_stripped,
            description_binary, module_ids (UUID[]),
            label_ids (UUID[]), assignee_ids (UUID[]),
            estimate_point, priority, start_date, target_date,
            sequence_id, project_id, parent_id, cycle_id,
            created_by, state__group, vote_items (JSON[]),
            reaction_items (JSON[]).

        Any field may be ``None`` for the matching issue; the entire
        response is ``None`` when no row matches (the ``.first()``
        terminator returns ``None``; Response then returns
        ``200 OK null`` -- this is the API's "not-found" mode for
        the detail endpoint, which is deliberately permissive given
        that the deploy board has already been resolved upstream).

    Permissions:
        ``permission_classes = [AllowAny]``.

    Queryset filter:
        :class:`Issue.issue_objects` (excludes archived / draft /
        soft-deleted by default) filtered to ``pk=issue_id`` +
        workspace slug + project_id from the resolved deploy board.

    Annotations:
        * ``cycle_id``: active :class:`CycleIssue` (NULL if none).
        * ``label_ids`` / ``assignee_ids`` / ``module_ids``: UUID
          arrays via :class:`ArrayAgg` + :class:`Coalesce`, with
          DISTINCT and per-relation soft-delete filters. Projected
          as UUID arrays (NOT as expanded member records) -- this is
          a SECURITY BOUNDARY against leaking member PII to
          anonymous viewers on public boards.
        * ``vote_items``: an :class:`ArrayAgg` of
          :class:`JSONObject` rows, each containing ``vote`` and an
          ``actor_details`` sub-object with ``id``, ``first_name``,
          ``last_name``, ``avatar``, ``avatar_url`` (computed:
          prefixes ``"/api/assets/v2/static/"`` to ``avatar_asset``
          when set, falls back to the legacy ``avatar`` URL
          otherwise), and ``display_name``.
        * ``reaction_items``: ditto, with ``reaction`` instead of
          ``vote``, and the actor sub-object built from
          ``issue_reactions__actor`` fields.

        # INTENT UNCLEAR: inside the ``reaction_items`` JSONObject,
        # the ``avatar_url`` ``Case``/``When`` branches use
        # ``votes__actor__avatar_asset`` and
        # ``votes__actor__avatar`` rather than the matching
        # ``issue_reactions__actor__*`` fields. This appears to mix
        # vote-actor and reaction-actor identities when computing
        # the avatar URL inside the reaction_items annotation; the
        # surrounding ``id`` / ``first_name`` / ``last_name`` /
        # ``display_name`` fields on the same ``actor_details``
        # block correctly use ``issue_reactions__actor__*``. Per
        # system boundaries the SQL is documented as observed and
        # NOT modified.
    """

    permission_classes = [AllowAny]

    def get(self, request, anchor, issue_id):
        """Return a single-row dict for ``issue_id`` with inlined votes/reactions.

        Resolves the deploy board (raises
        :class:`DeployBoard.DoesNotExist` -> 404 via base handler),
        filters :class:`Issue.issue_objects` to ``pk=issue_id``, then
        annotates ``cycle_id``, UUID arrays (``label_ids`` /
        ``assignee_ids`` / ``module_ids``), and JSON arrays
        (``vote_items`` / ``reaction_items``) before projecting via
        ``.values(...)``. The UUID-array projection is a SECURITY
        BOUNDARY against leaking member PII to anonymous viewers.
        """
        deploy_board = DeployBoard.objects.get(anchor=anchor)

        issue_queryset = (
            Issue.issue_objects.filter(
                pk=issue_id,
                workspace__slug=deploy_board.workspace.slug,
                project_id=deploy_board.project_id,
            )
            .select_related("workspace", "project", "state", "parent")
            .prefetch_related("assignees", "labels", "issue_module__module")
            .annotate(
                cycle_id=Subquery(
                    CycleIssue.objects.filter(issue=OuterRef("id"), deleted_at__isnull=True).values("cycle_id")[:1]
                )
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
                        filter=~Q(issue_module__module_id__isnull=True)
                        & Q(issue_module__module__archived_at__isnull=True)
                        & Q(issue_module__deleted_at__isnull=True),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
            .prefetch_related(
                Prefetch(
                    "issue_reactions",
                    queryset=IssueReaction.objects.select_related("issue", "actor"),
                )
            )
            .prefetch_related(Prefetch("votes", queryset=IssueVote.objects.select_related("actor")))
            .annotate(
                vote_items=ArrayAgg(
                    Case(
                        When(
                            votes__isnull=False,
                            votes__deleted_at__isnull=True,
                            then=JSONObject(
                                vote=F("votes__vote"),
                                actor_details=JSONObject(
                                    id=F("votes__actor__id"),
                                    first_name=F("votes__actor__first_name"),
                                    last_name=F("votes__actor__last_name"),
                                    avatar=F("votes__actor__avatar"),
                                    avatar_url=Case(
                                        When(
                                            votes__actor__avatar_asset__isnull=False,
                                            then=Concat(
                                                Value("/api/assets/v2/static/"),
                                                F("votes__actor__avatar_asset"),
                                                Value("/"),
                                            ),
                                        ),
                                        When(
                                            votes__actor__avatar_asset__isnull=True,
                                            then=F("votes__actor__avatar"),
                                        ),
                                        default=Value(None),
                                        output_field=CharField(),
                                    ),
                                    display_name=F("votes__actor__display_name"),
                                ),
                            ),
                        ),
                        default=None,
                        output_field=JSONField(),
                    ),
                    filter=Case(
                        When(
                            votes__isnull=False,
                            votes__deleted_at__isnull=True,
                            then=True,
                        ),
                        default=False,
                        output_field=JSONField(),
                    ),
                    distinct=True,
                ),
                reaction_items=ArrayAgg(
                    Case(
                        When(
                            issue_reactions__isnull=False,
                            issue_reactions__deleted_at__isnull=True,
                            then=JSONObject(
                                reaction=F("issue_reactions__reaction"),
                                actor_details=JSONObject(
                                    id=F("issue_reactions__actor__id"),
                                    first_name=F("issue_reactions__actor__first_name"),
                                    last_name=F("issue_reactions__actor__last_name"),
                                    avatar=F("issue_reactions__actor__avatar"),
                                    avatar_url=Case(
                                        When(
                                            votes__actor__avatar_asset__isnull=False,
                                            then=Concat(
                                                Value("/api/assets/v2/static/"),
                                                F("votes__actor__avatar_asset"),
                                                Value("/"),
                                            ),
                                        ),
                                        When(
                                            votes__actor__avatar_asset__isnull=True,
                                            then=F("votes__actor__avatar"),
                                        ),
                                        default=Value(None),
                                        output_field=CharField(),
                                    ),
                                    display_name=F("issue_reactions__actor__display_name"),
                                ),
                            ),
                        ),
                        default=None,
                        output_field=JSONField(),
                    ),
                    filter=Case(
                        When(
                            issue_reactions__isnull=False,
                            issue_reactions__deleted_at__isnull=True,
                            then=True,
                        ),
                        default=False,
                        output_field=JSONField(),
                    ),
                    distinct=True,
                ),
            )
            .values(
                "id",
                "name",
                "state_id",
                "sort_order",
                "description_json",
                "description_html",
                "description_stripped",
                "description_binary",
                "module_ids",
                "label_ids",
                "assignee_ids",
                "estimate_point",
                "priority",
                "start_date",
                "target_date",
                "sequence_id",
                "project_id",
                "parent_id",
                "cycle_id",
                "created_by",
                "state__group",
                "vote_items",
                "reaction_items",
            )
        ).first()

        return Response(issue_queryset, status=status.HTTP_200_OK)
