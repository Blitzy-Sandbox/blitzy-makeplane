# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""HTTP endpoint exposing the merged issue activity + comment timeline.

Returns the chronological feed for a single issue by reading append-only
:class:`plane.db.models.IssueActivity` rows (excluding ``comment``,
``vote``, ``reaction``, ``draft`` field-changes that are not displayed in
the timeline UI) and merging them with
:class:`plane.db.models.IssueComment` rows. Activities themselves are
WRITTEN by ``plane.bgtasks.issue_activities_task.issue_activity`` (Celery
via RabbitMQ) on the post-save side of issue mutations -- this endpoint
is strictly read-only and does not enqueue any tasks.
"""

# Python imports
from itertools import chain

# Django imports
from django.db.models import Prefetch, Q
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseAPIView
from plane.app.serializers import IssueActivitySerializer, IssueCommentSerializer
from plane.app.permissions import ProjectEntityPermission, allow_permission, ROLE
from plane.db.models import IssueActivity, IssueComment, CommentReaction, IntakeIssue


class IssueActivityEndpoint(BaseAPIView):
    """Read-only timeline endpoint merging :class:`IssueActivity` and :class:`IssueComment` rows for a single issue.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/history/

    Query parameters:
        created_at__gt (ISO datetime, optional): when present, returns only
            rows with ``created_at`` strictly greater than this timestamp
            (used for incremental polling).
        activity_type (str, optional): one of ``"issue-property"`` or
            ``"issue-comment"``. When set, the response is the
            single-typed list (activities or comments) instead of the
            merged feed; the special ``"issue-property"`` mode additionally
            prefetches ``IntakeIssue.source_email/source/extra`` for the
            issue's intake record (if any) and exposes it via the
            ``source_data`` SerializerMethodField on
            :class:`plane.app.serializers.IssueActivitySerializer`.

    Request body:
        None (GET only).

    Response shape:
        When no ``activity_type`` is supplied (default merged mode): a JSON
        array of serialized :class:`IssueActivity` and :class:`IssueComment`
        rows sorted ascending by ``created_at``. Activity rows carry
        ``verb`` + ``field`` + ``old_value`` + ``new_value`` + ``actor`` +
        ``created_at``; comment rows carry ``comment_html`` + ``actor`` +
        ``access`` + prefetched ``comment_reactions``.

        When ``activity_type=issue-property`` is supplied: a JSON array of
        :class:`plane.app.serializers.IssueActivitySerializer` rows only.

        When ``activity_type=issue-comment`` is supplied: a JSON array of
        :class:`plane.app.serializers.IssueCommentSerializer` rows only.

    Permissions:
        permission_classes = [ProjectEntityPermission]
        Per-method gate: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])``
        -- guests can read the timeline of issues they are otherwise allowed
        to view; project-level visibility is enforced by
        :class:`plane.app.permissions.ProjectEntityPermission` and the
        ``project__project_projectmember__member=self.request.user`` filter
        applied in the queryset.

    Read replica:
        ``use_read_replica = True`` -- this endpoint opts into the
        read-replica routing provided by
        :class:`plane.utils.core.mixins.ReadReplicaControlMixin` (see
        :mod:`plane.app.views.base`).

    Response compression:
        ``@method_decorator(gzip_page)`` -- timelines for long-lived issues
        can be large; gzip is applied at the view layer.

    Notes:
        Activities are append-only and WRITTEN by Celery tasks (RabbitMQ)
        in :mod:`plane.bgtasks.issue_activities_task`. This endpoint never
        writes; there is no POST / PATCH / DELETE handler.
    """

    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    @method_decorator(gzip_page)
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        """Return the merged activity + comment timeline for ``issue_id``.

        The base activity queryset excludes ``field in {comment, vote,
        reaction, draft}`` rows; comment rows are added via the
        :class:`plane.db.models.IssueComment` table (with prefetched
        ``comment_reactions``) and merged using
        :func:`itertools.chain` sorted by ``created_at`` ascending.
        ``?activity_type=issue-property`` and ``?activity_type=issue-comment``
        short-circuit the merge and return only the requested slice;
        ``?created_at__gt=<iso-datetime>`` enables incremental polling.
        """
        filters = {}
        if request.GET.get("created_at__gt", None) is not None:
            filters = {"created_at__gt": request.GET.get("created_at__gt")}

        issue_activities = (
            IssueActivity.objects.filter(issue_id=issue_id)
            .filter(
                ~Q(field__in=["comment", "vote", "reaction", "draft"]),
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
                workspace__slug=slug,
            )
            .filter(**filters)
            .select_related("actor", "workspace", "issue", "project")
        ).order_by("created_at")
        issue_comments = (
            IssueComment.objects.filter(issue_id=issue_id)
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
                workspace__slug=slug,
            )
            .filter(**filters)
            .order_by("created_at")
            .select_related("actor", "issue", "project", "workspace")
            .prefetch_related(
                Prefetch(
                    "comment_reactions",
                    queryset=CommentReaction.objects.select_related("actor"),
                )
            )
        )

        if request.GET.get("activity_type", None) == "issue-property":
            issue_activities = issue_activities.prefetch_related(
                Prefetch(
                    "issue__issue_intake",
                    queryset=IntakeIssue.objects.only("source_email", "source", "extra"),
                    to_attr="source_data",
                )
            )
            issue_activities = IssueActivitySerializer(issue_activities, many=True).data
            return Response(issue_activities, status=status.HTTP_200_OK)

        if request.GET.get("activity_type", None) == "issue-comment":
            issue_comments = IssueCommentSerializer(issue_comments, many=True).data
            return Response(issue_comments, status=status.HTTP_200_OK)

        result_list = sorted(
            chain(issue_activities, issue_comments),
            key=lambda instance: instance["created_at"],
        )

        return Response(result_list, status=status.HTTP_200_OK)
