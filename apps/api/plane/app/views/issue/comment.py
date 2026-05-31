# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Issue comment and comment-reaction HTTP endpoints.

Exposes :class:`IssueCommentViewSet` for full CRUD on
:class:`IssueComment` (threaded comments on issues) and
:class:`CommentReactionViewSet` for emoji reactions on those comments.

Every write path enqueues
``plane.bgtasks.issue_activities_task.issue_activity`` (Celery via
RabbitMQ) so the comment add/edit/delete event appears in the issue
timeline; create/update on :class:`IssueComment` additionally enqueues
``plane.bgtasks.webhook_task.model_activity`` to fan out webhook
deliveries for the ``issue_comment`` event.

Guests (``ROLE.GUEST`` = role 5) are allowed to comment but only on
issues they themselves created, unless the project's
``guest_view_all_features`` flag is enabled.
"""

# Python imports
import json

# Django imports
from django.utils import timezone
from django.db.models import Exists
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet
from plane.app.serializers import IssueCommentSerializer, CommentReactionSerializer
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import IssueComment, ProjectMember, CommentReaction, Project, Issue
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.host import base_host
from plane.bgtasks.webhook_task import model_activity


class IssueCommentViewSet(BaseViewSet):
    """CRUD endpoint for threaded comments on issues.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/comments/
        POST   /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/comments/
        GET    /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/comments/<pk>/
        PATCH  /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/comments/<pk>/
        DELETE /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/comments/<pk>/

    Request body (POST / PATCH):
        Fields validated by
        :class:`plane.app.serializers.IssueCommentSerializer`:
            * ``comment_html`` (str, required on POST) -- rich-text
              comment body.
            * ``comment_stripped`` (str, optional) -- plain-text mirror.
            * ``access`` (int, optional) -- comment visibility flag.

    Response shape:
        ``IssueCommentSerializer`` output (id, comment_html,
        comment_stripped, access, actor, created_at, updated_at,
        edited_at, plus the ``is_member`` Exists annotation on list).

    Permissions:
        permission_classes -- not set on the class; inherits
        ``[IsAuthenticated]`` from :class:`BaseViewSet`.
        Per-method gates:
            * ``create``: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER,
              ROLE.GUEST])`` plus an inline check that rejects guests
              (``role=5``) who are commenting on an issue they did not
              create when ``project.guest_view_all_features`` is
              ``False`` (HTTP 400 ``"You are not allowed to comment on
              the issue"``).
            * ``partial_update``: ``@allow_permission(
              allowed_roles=[ROLE.ADMIN], creator=True,
              model=IssueComment)`` -- the comment's creator can edit it;
              other members cannot; project admins can edit anyone's.
            * ``destroy``: same as ``partial_update``.

    get_queryset filter logic:
        Filters by ``workspace__slug``, ``project_id``, ``issue_id`` from
        the URL, joins to ensure the requesting user is an active,
        non-archived project member, ``select_related``s project /
        workspace / issue, and annotates ``is_member`` (Exists on
        :class:`ProjectMember`).

    Side effects:
        * POST/PATCH/DELETE enqueue
          ``plane.bgtasks.issue_activities_task.issue_activity`` with
          ``type="comment.activity.{created|updated|deleted}"``.
        * POST/PATCH additionally enqueue
          ``plane.bgtasks.webhook_task.model_activity`` for the
          ``issue_comment`` webhook event (see ``webhook_event``
          attribute).
        * ``partial_update`` sets ``edited_at = now()`` ONLY when
          ``comment_html`` is in the request body and actually differs
          from the existing value -- preserving the original
          ``edited_at`` on no-op or non-content updates.
    """

    serializer_class = IssueCommentSerializer
    model = IssueComment
    webhook_event = "issue_comment"

    filterset_fields = ["issue__id", "workspace__id"]

    def get_queryset(self):
        """Return :class:`IssueComment` rows for the URL's workspace + project + issue.

        Restricted to active project members and annotated with
        ``is_member`` (Exists on :class:`ProjectMember`).
        """
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related("project")
            .select_related("workspace")
            .select_related("issue")
            .annotate(
                is_member=Exists(
                    ProjectMember.objects.filter(
                        workspace__slug=self.kwargs.get("slug"),
                        project_id=self.kwargs.get("project_id"),
                        member_id=self.request.user.id,
                        is_active=True,
                    )
                )
            )
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def create(self, request, slug, project_id, issue_id):
        """Create a new comment on the issue and enqueue activity + webhook Celery tasks.

        Guests (``role=5``) are rejected (HTTP 400) when they attempt to
        comment on an issue they did not create and
        ``project.guest_view_all_features`` is ``False``.
        """
        project = Project.objects.get(pk=project_id)
        issue = Issue.objects.get(pk=issue_id)
        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=5,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
            and not issue.created_by == request.user
        ):
            return Response(
                {"error": "You are not allowed to comment on the issue"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = IssueCommentSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(project_id=project_id, issue_id=issue_id, actor=request.user)
            issue_activity.delay(
                type="comment.activity.created",
                requested_data=json.dumps(serializer.data, cls=DjangoJSONEncoder),
                actor_id=str(self.request.user.id),
                issue_id=str(self.kwargs.get("issue_id")),
                project_id=str(self.kwargs.get("project_id")),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            # Send the model activity
            model_activity.delay(
                model_name="issue_comment",
                model_id=str(serializer.data["id"]),
                requested_data=request.data,
                current_instance=None,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=IssueComment)
    def partial_update(self, request, slug, project_id, issue_id, pk):
        """Edit a comment (creator-or-admin only).

        Sets ``edited_at`` when ``comment_html`` actually changes and
        enqueues the activity + webhook Celery tasks.
        """
        issue_comment = IssueComment.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        requested_data = json.dumps(self.request.data, cls=DjangoJSONEncoder)
        current_instance = json.dumps(IssueCommentSerializer(issue_comment).data, cls=DjangoJSONEncoder)
        serializer = IssueCommentSerializer(issue_comment, data=request.data, partial=True)
        if serializer.is_valid():
            if "comment_html" in request.data and request.data["comment_html"] != issue_comment.comment_html:
                serializer.save(edited_at=timezone.now())
            else:
                serializer.save()
            issue_activity.delay(
                type="comment.activity.updated",
                requested_data=requested_data,
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=current_instance,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            # Send the model activity
            model_activity.delay(
                model_name="issue_comment",
                model_id=str(pk),
                requested_data=request.data,
                current_instance=current_instance,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=IssueComment)
    def destroy(self, request, slug, project_id, issue_id, pk):
        """Delete a comment (creator-or-admin only).

        Enqueues a ``comment.activity.deleted`` Celery task with the
        pre-delete snapshot serialized as ``current_instance``.
        """
        issue_comment = IssueComment.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        current_instance = json.dumps(IssueCommentSerializer(issue_comment).data, cls=DjangoJSONEncoder)
        issue_comment.delete()
        issue_activity.delay(
            type="comment.activity.deleted",
            requested_data=json.dumps({"comment_id": str(pk)}),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class CommentReactionViewSet(BaseViewSet):
    """Emoji-reaction endpoint for issue comments.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/comments/<comment_id>/reactions/
        POST   /api/workspaces/<slug>/projects/<project_id>/comments/<comment_id>/reactions/
        DELETE /api/workspaces/<slug>/projects/<project_id>/comments/<comment_id>/reactions/<reaction_code>/

    Request body (POST):
        Validated by
        :class:`plane.app.serializers.CommentReactionSerializer`:
            * ``reaction`` (str, required) -- emoji code (e.g.,
              ``"thumbs_up"``).

    Response shape:
        ``CommentReactionSerializer`` output (id, reaction, actor,
        comment_id, created_at).

    Permissions:
        permission_classes -- not set on the class; inherits
        ``[IsAuthenticated]`` from :class:`BaseViewSet`.
        Per-method gate: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER,
        ROLE.GUEST])`` on both ``create`` and ``destroy``.

    Uniqueness:
        ``(comment_id, actor, reaction)`` is unique at the DB level;
        :meth:`create` catches :class:`IntegrityError` and returns HTTP
        400 ``"Reaction already exists for the user"`` when the user
        re-adds the same reaction.

    Side effects:
        Each create/destroy enqueues
        ``plane.bgtasks.issue_activities_task.issue_activity`` with
        ``type="comment_reaction.activity.{created|deleted}"`` for the
        comment timeline. The ``issue_id`` field on the activity payload
        is ``None`` because comment reactions are scoped to a comment,
        not directly to an issue.

    get_queryset filter logic:
        Filters by ``workspace__slug``, ``project_id``, ``comment_id``
        from the URL, restricted to active project members; ordered by
        ``-created_at``.
    """

    serializer_class = CommentReactionSerializer
    model = CommentReaction

    def get_queryset(self):
        """Return :class:`CommentReaction` rows for the URL's workspace + project + comment.

        Restricted to active project members and ordered by
        ``-created_at``.
        """
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(comment_id=self.kwargs.get("comment_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .order_by("-created_at")
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def create(self, request, slug, project_id, comment_id):
        """Add an emoji reaction to the comment and enqueue a ``comment_reaction.activity.created`` Celery task.

        Returns HTTP 400 ``"Reaction already exists for the user"`` if
        the user has already added the same reaction code (caught from
        :class:`IntegrityError`).
        """
        try:
            serializer = CommentReactionSerializer(data=request.data)
            if serializer.is_valid():
                serializer.save(
                    project_id=project_id,
                    actor_id=request.user.id,
                    comment_id=comment_id,
                )
                issue_activity.delay(
                    type="comment_reaction.activity.created",
                    requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
                    actor_id=str(request.user.id),
                    issue_id=None,
                    project_id=str(project_id),
                    current_instance=None,
                    epoch=int(timezone.now().timestamp()),
                    notification=True,
                    origin=base_host(request=request, is_app=True),
                )
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response(
                {"error": "Reaction already exists for the user"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def destroy(self, request, slug, project_id, comment_id, reaction_code):
        """Remove the requesting user's reaction matching ``reaction_code`` from the comment.

        Enqueues a ``comment_reaction.activity.deleted`` Celery task
        before deleting the row.
        """
        comment_reaction = CommentReaction.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            comment_id=comment_id,
            reaction=reaction_code,
            actor=request.user,
        )
        issue_activity.delay(
            type="comment_reaction.activity.deleted",
            requested_data=None,
            actor_id=str(self.request.user.id),
            issue_id=None,
            project_id=str(self.kwargs.get("project_id", None)),
            current_instance=json.dumps(
                {
                    "reaction": str(reaction_code),
                    "identifier": str(comment_reaction.id),
                    "comment_id": str(comment_id),
                }
            ),
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        comment_reaction.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
