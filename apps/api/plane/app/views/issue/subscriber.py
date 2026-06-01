# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Issue subscriber HTTP endpoints (notification recipient list).

Exposes :class:`IssueSubscriberViewSet` for managing which users
receive notifications for events on a given issue. Subscribers are
read by :func:`plane.bgtasks.notification_task.notification_task`
(Celery via RabbitMQ) when fanning out notifications for issue
mutations.

The ViewSet uses a DYNAMIC permission override
(:meth:`IssueSubscriberViewSet.get_permissions`) so that self-service
actions (``subscribe``, ``unsubscribe``, ``subscription_status``) drop
from :class:`ProjectEntityPermission` to the looser
:class:`ProjectLitePermission` -- letting project-lite users
self-subscribe to issues they can see even when they cannot mutate
issue content.
"""

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet
from plane.app.serializers import IssueSubscriberSerializer, ProjectMemberLiteSerializer
from plane.app.permissions import ProjectEntityPermission, ProjectLitePermission
from plane.db.models import IssueSubscriber, ProjectMember


class IssueSubscriberViewSet(BaseViewSet):
    """Manage the notification subscriber list for an issue.

    A dynamic permission override allows self-service subscribe /
    unsubscribe under :class:`ProjectLitePermission` while admin
    list / destroy paths remain under :class:`ProjectEntityPermission`.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-subscribers/
                -- action: ``list`` -- returns the project's full
                MEMBER list (for the subscribe-picker UI), NOT the
                subscriber list. Note this unusual semantics.
        DELETE /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-subscribers/<subscriber_id>/
                -- action: ``destroy`` -- admin removes a subscriber.
        POST   /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/subscribe/
                -- action: ``subscribe`` -- self-subscribe.
        DELETE /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/subscribe/
                -- action: ``unsubscribe`` -- self-unsubscribe.
        GET    /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/subscribe/
                -- action: ``subscription_status`` -- ``{"subscribed":
                bool}``.

    Request body:
        - All actions: none. State is determined by ``request.user``
          (for self-service actions) or by ``subscriber_id`` in the URL
          (for admin destroy).

    Response shape:
        - ``list``: list of :class:`ProjectMemberLiteSerializer` output
          (id, member, role, etc.) -- the *member roster* of the
          project, used by the UI to render the subscribe picker.
        - ``destroy`` / ``unsubscribe``: HTTP 204.
        - ``subscribe``: :class:`IssueSubscriberSerializer` output
          (HTTP 201); HTTP 400 ``"User already subscribed to the
          issue."`` if the row already exists.
        - ``subscription_status``: ``{"subscribed": bool}`` (HTTP 200).

    Permissions:
        ``permission_classes = [ProjectEntityPermission]`` -- declared on
        the class attribute (see
        :file:`apps/api/plane/app/views/issue/subscriber.py`). Defined in
        :class:`plane.app.permissions.project.ProjectEntityPermission`.
        Dynamic override via :meth:`get_permissions`: for actions
        ``subscribe``, ``unsubscribe``, ``subscription_status`` the
        permission is switched to :class:`ProjectLitePermission` so
        project-lite users (e.g. invited guests with view-only access)
        can self-subscribe without holding entity-mutation rights.

    get_queryset filter logic:
        Filters :class:`IssueSubscriber` rows by ``workspace__slug``,
        ``project_id``, ``issue_id`` from the URL, restricted to active
        project members on a non-archived project; ordered by
        ``-created_at``; distinct.

    Consumers (Celery via RabbitMQ -- NOT Redis):
        :class:`IssueSubscriber` rows are read by the notification
        pipeline (``plane.bgtasks.notification_task.notification_task``,
        Celery via RabbitMQ) when fanning out notifications for issue
        updates.

    Cross-references:
        - Permissions: ``plane.app.permissions.ProjectEntityPermission``,
          ``plane.app.permissions.ProjectLitePermission``.
        - Serializers: ``plane.app.serializers.IssueSubscriberSerializer``,
          ``plane.app.serializers.ProjectMemberLiteSerializer``.
        - Models: ``plane.db.models.IssueSubscriber``, ``plane.db.models.Issue``,
          ``plane.db.models.ProjectMember``.
        - Celery tasks (via RabbitMQ): ``plane.bgtasks.notification_task.notification_task``
          (consumer; this endpoint writes the rows the task reads).
        - URL registration: ``apps/api/plane/app/urls/issue.py``.
    """

    serializer_class = IssueSubscriberSerializer
    model = IssueSubscriber

    permission_classes = [ProjectEntityPermission]

    def get_permissions(self):
        """Switch to :class:`ProjectLitePermission` for self-service actions.

        Overrides the class-level :class:`ProjectEntityPermission` for
        the ``subscribe``, ``unsubscribe``, and ``subscription_status``
        actions; all other actions retain the default permission.
        """
        if self.action in ["subscribe", "unsubscribe", "subscription_status"]:
            self.permission_classes = [ProjectLitePermission]
        else:
            self.permission_classes = [ProjectEntityPermission]

        return super(IssueSubscriberViewSet, self).get_permissions()

    def perform_create(self, serializer):
        """Inject ``project_id`` and ``issue_id`` from URL kwargs at save time.

        Lets clients POST without those fields in the request body.
        """
        serializer.save(
            project_id=self.kwargs.get("project_id"),
            issue_id=self.kwargs.get("issue_id"),
        )

    def get_queryset(self):
        """Return :class:`IssueSubscriber` rows for the URL's issue scope.

        Filters by ``workspace__slug``, ``project_id``, and ``issue_id``
        from the URL; restricts to rows owned by active project members
        on a non-archived project; orders by ``-created_at``; distinct.
        """
        return (
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
            .order_by("-created_at")
            .distinct()
        )

    def list(self, request, slug, project_id, issue_id):
        """Return the project's full active-member roster (NOT the subscriber list) for the subscribe-picker UI.

        The unusual semantics (``list`` returns ``ProjectMember`` rows,
        not :class:`IssueSubscriber` rows) is intentional and preserved.
        """
        members = ProjectMember.objects.filter(
            workspace__slug=slug, project_id=project_id, is_active=True
        ).select_related("member")
        serializer = ProjectMemberLiteSerializer(members, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def destroy(self, request, slug, project_id, issue_id, subscriber_id):
        """Remove ``subscriber_id`` from the issue's subscriber list.

        Admin path; for self-unsubscribe see :meth:`unsubscribe`.
        """
        issue_subscriber = IssueSubscriber.objects.get(
            project=project_id,
            subscriber=subscriber_id,
            workspace__slug=slug,
            issue=issue_id,
        )
        issue_subscriber.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def subscribe(self, request, slug, project_id, issue_id):
        """Self-subscribe the requesting user to the issue.

        Returns HTTP 400 ``"User already subscribed to the issue."`` if
        the row already exists. Uses :class:`ProjectLitePermission` per
        the dynamic override in :meth:`get_permissions`.
        """
        if IssueSubscriber.objects.filter(
            issue_id=issue_id,
            subscriber=request.user,
            workspace__slug=slug,
            project=project_id,
        ).exists():
            return Response(
                {"message": "User already subscribed to the issue."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        subscriber = IssueSubscriber.objects.create(
            issue_id=issue_id, subscriber_id=request.user.id, project_id=project_id
        )
        serializer = IssueSubscriberSerializer(subscriber)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def unsubscribe(self, request, slug, project_id, issue_id):
        """Self-unsubscribe the requesting user from the issue.

        Uses :class:`ProjectLitePermission` per the dynamic override in
        :meth:`get_permissions`.
        """
        issue_subscriber = IssueSubscriber.objects.get(
            project=project_id,
            subscriber=request.user,
            workspace__slug=slug,
            issue=issue_id,
        )
        issue_subscriber.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def subscription_status(self, request, slug, project_id, issue_id):
        """Return ``{"subscribed": bool}`` indicating whether the requesting user is subscribed to this issue."""
        issue_subscriber = IssueSubscriber.objects.filter(
            issue=issue_id,
            subscriber=request.user,
            workspace__slug=slug,
            project=project_id,
        ).exists()
        return Response({"subscribed": issue_subscriber}, status=status.HTTP_200_OK)
