# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-scoped notification inbox and preference endpoints for authenticated users.

This module exposes the per-user notification inbox API surface: listing,
filtering, item-level state transitions (read/unread, archive/unarchive,
snooze), bulk mark-all-read, an unread-count badge endpoint, and a
per-user notification preference endpoint.

Architectural context:
    - Notifications are PRODUCED asynchronously by Celery tasks in
      ``plane/bgtasks/notification_task.py`` (Celery via RabbitMQ — Redis
      is NOT used for task queueing in this codebase).
    - The endpoints in this module are CONSUMERS that read ``Notification``
      rows and mutate per-user state (``read_at``, ``snoozed_till``,
      ``archived_at``). They do NOT enqueue new notifications.
    - No cache layer is interposed between these endpoints and the
      database: notification state must be strongly consistent so that
      the unread badge and inbox views never disagree.

See also:
    - ``plane/app/urls/notification.py`` (URL routing)
    - ``plane/app/serializers/notification.py`` (response/request shape)
    - ``plane/db/models/notification.py`` (``Notification``,
      ``UserNotificationPreference`` ORM models)
"""

# Django imports
from django.db.models import Exists, OuterRef, Q, Case, When, BooleanField
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

from plane.app.serializers import (
    NotificationSerializer,
    UserNotificationPreferenceSerializer,
)
from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueSubscriber,
    Notification,
    UserNotificationPreference,
    WorkspaceMember,
)
from plane.utils.paginator import BasePaginator
from plane.app.permissions import allow_permission, ROLE

# Module imports
from ..base import BaseAPIView, BaseViewSet


class NotificationViewSet(BaseViewSet, BasePaginator):
    """Per-user notification inbox CRUD plus item-level state transitions.

    Resource:
        ``Notification`` rows where ``receiver = request.user`` and
        ``workspace.slug = <slug>``.

    HTTP methods and URL patterns (from ``plane/app/urls/notification.py``):
        GET    /api/workspaces/<slug>/users/notifications/                       -> list
        GET    /api/workspaces/<slug>/users/notifications/<uuid:pk>/             -> retrieve (inherited)
        PATCH  /api/workspaces/<slug>/users/notifications/<uuid:pk>/             -> partial_update
        DELETE /api/workspaces/<slug>/users/notifications/<uuid:pk>/             -> destroy (inherited)
        POST   /api/workspaces/<slug>/users/notifications/<uuid:pk>/read/        -> mark_read
        DELETE /api/workspaces/<slug>/users/notifications/<uuid:pk>/read/        -> mark_unread
        POST   /api/workspaces/<slug>/users/notifications/<uuid:pk>/archive/     -> archive
        DELETE /api/workspaces/<slug>/users/notifications/<uuid:pk>/archive/     -> unarchive

    Request body (PATCH partial_update):
        snoozed_till (datetime | null, optional): defer the notification
            until the given timestamp; all other request body fields
            are intentionally ignored by ``partial_update``.

    Response shape:
        ``NotificationSerializer`` rendering of one ``Notification`` row
        (list endpoint returns either a paginated envelope from
        ``BasePaginator.paginate`` when ``per_page`` and ``cursor`` are
        provided, or a flat list otherwise). Each item carries the full
        ``Notification`` fields plus the read-only computed fields:
        ``triggered_by_details`` (nested ``UserLiteSerializer``),
        ``is_inbox_issue``, ``is_intake_issue``, and
        ``is_mentioned_notification`` (all booleans annotated on the
        queryset at list time only).

    Permissions:
        - Inherits ``permission_classes = [IsAuthenticated]`` from
          ``BaseViewSet`` (authenticated session required).
        - Each action method is additionally guarded by
          ``@allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER,
          ROLE.GUEST], level="WORKSPACE")`` which restricts access to
          active members of the workspace named by the ``slug`` URL
          parameter.

    Queryset:
        ``get_queryset`` scopes every action to
        ``workspace.slug == slug`` AND ``receiver_id == request.user.id``,
        and eagerly joins ``workspace``, ``project``, ``triggered_by``,
        and ``receiver`` to avoid N+1 lookups when serializing.
    """

    model = Notification
    serializer_class = NotificationSerializer

    def get_queryset(self):
        """Return notifications scoped to the active workspace and authenticated receiver.

        Filters by ``workspace__slug = self.kwargs["slug"]`` and
        ``receiver_id = self.request.user.id`` to enforce per-user inbox
        isolation, then ``select_related`` the four hot foreign keys
        (``workspace``, ``project``, ``triggered_by``, ``receiver``) so
        the standard list/retrieve serializer paths do not trigger
        per-row joins.
        """
        return (
            super()
            .get_queryset()
            .filter(
                workspace__slug=self.kwargs.get("slug"),
                receiver_id=self.request.user.id,
            )
            .select_related("workspace", "project", "triggered_by", "receiver")
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        """List inbox notifications for the active workspace with optional filtering.

        Query parameters:
            snoozed (str, "true" | "false", default "false"): when "true"
                returns rows whose ``snoozed_till`` is in the past OR not
                null; when "false" returns rows whose ``snoozed_till`` is
                in the future OR null.
            archived (str, "true" | "false", default "false"): when
                "true" returns rows where ``archived_at IS NOT NULL``;
                when "false" returns rows where ``archived_at IS NULL``.
            read (str, "true" | "false" | None, optional): when "true"
                returns rows where ``read_at IS NOT NULL``; when "false"
                returns rows where ``read_at IS NULL``; when omitted both
                are returned.
            type (str, comma-separated, default "all"): any combination
                of ``subscribed``, ``assigned``, ``created`` further
                narrows the queryset by issue relationship via
                ``IssueSubscriber``, ``IssueAssignee``, and ``Issue``
                joins respectively. ``created`` is suppressed (returns
                an empty queryset) for non-elevated workspace members
                (``WorkspaceMember.role < 15``).
            mentioned (bool, default False): when truthy returns only
                notifications whose ``sender`` icontains "mentioned";
                when falsy excludes mentions from the result set.
            per_page, cursor (str, optional): when both are provided the
                response is paginated via ``BasePaginator.paginate``
                ordered by the ``order_by`` query parameter (default
                ``-created_at``); otherwise the full queryset is
                serialized in one response.

        Response shape:
            HTTP 200 with either a paginated envelope (when paginated)
            or a flat list of ``NotificationSerializer`` payloads.

        Side effects:
            Read-only — no database writes.
        """
        # Get query parameters
        snoozed = request.GET.get("snoozed", "false")
        archived = request.GET.get("archived", "false")
        read = request.GET.get("read", None)
        type = request.GET.get("type", "all")
        mentioned = request.GET.get("mentioned", False)
        q_filters = Q()

        intake_issue = Issue.objects.filter(
            pk=OuterRef("entity_identifier"),
            issue_intake__status__in=[0, 2, -2],
            workspace__slug=self.kwargs.get("slug"),
        )

        notifications = (
            Notification.objects.filter(workspace__slug=slug, receiver_id=request.user.id)
            .filter(entity_name="issue")
            .annotate(is_inbox_issue=Exists(intake_issue))
            .annotate(is_intake_issue=Exists(intake_issue))
            .annotate(
                is_mentioned_notification=Case(
                    When(sender__icontains="mentioned", then=True),
                    default=False,
                    output_field=BooleanField(),
                )
            )
            .select_related("workspace", "project", "triggered_by", "receiver")
            .order_by("snoozed_till", "-created_at")
        )

        # Filters based on query parameters
        snoozed_filters = {
            "true": Q(snoozed_till__lt=timezone.now()) | Q(snoozed_till__isnull=False),
            "false": Q(snoozed_till__gte=timezone.now()) | Q(snoozed_till__isnull=True),
        }

        notifications = notifications.filter(snoozed_filters[snoozed])

        archived_filters = {
            "true": Q(archived_at__isnull=False),
            "false": Q(archived_at__isnull=True),
        }

        notifications = notifications.filter(archived_filters[archived])

        if read == "false":
            notifications = notifications.filter(read_at__isnull=True)

        if read == "true":
            notifications = notifications.filter(read_at__isnull=False)

        if mentioned:
            notifications = notifications.filter(sender__icontains="mentioned")
        else:
            notifications = notifications.exclude(sender__icontains="mentioned")

        type = type.split(",")
        # Subscribed issues
        if "subscribed" in type:
            issue_ids = (
                IssueSubscriber.objects.filter(workspace__slug=slug, subscriber_id=request.user.id)
                .annotate(created=Exists(Issue.objects.filter(created_by=request.user, pk=OuterRef("issue_id"))))
                .annotate(assigned=Exists(IssueAssignee.objects.filter(pk=OuterRef("issue_id"), assignee=request.user)))
                .filter(created=False, assigned=False)
                .values_list("issue_id", flat=True)
            )
            q_filters |= Q(entity_identifier__in=issue_ids)

        # Assigned Issues
        if "assigned" in type:
            issue_ids = IssueAssignee.objects.filter(workspace__slug=slug, assignee_id=request.user.id).values_list(
                "issue_id", flat=True
            )
            q_filters |= Q(entity_identifier__in=issue_ids)

        # Created issues
        if "created" in type:
            if WorkspaceMember.objects.filter(
                workspace__slug=slug, member=request.user, role__lt=15, is_active=True
            ).exists():
                notifications = notifications.none()
            else:
                issue_ids = Issue.objects.filter(workspace__slug=slug, created_by=request.user).values_list(
                    "pk", flat=True
                )
                q_filters |= Q(entity_identifier__in=issue_ids)

        # Apply the combined Q object filters
        notifications = notifications.filter(q_filters)

        # Pagination
        if request.GET.get("per_page", False) and request.GET.get("cursor", False):
            return self.paginate(
                order_by=request.GET.get("order_by", "-created_at"),
                request=request,
                queryset=(notifications),
                on_results=lambda notifications: NotificationSerializer(notifications, many=True).data,
            )

        serializer = NotificationSerializer(notifications, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        """Patch a single notification's snooze time for the authenticated receiver.

        Only ``snoozed_till`` is honored from the request body; any
        other keys (including ``read_at`` and ``archived_at``) are
        intentionally ignored to prevent clients from bypassing the
        dedicated mark-read/archive endpoints.

        Side effects:
            UPDATE one ``Notification`` row's ``snoozed_till`` column
            on success. Returns HTTP 200 with the serialized
            notification on success or HTTP 400 with serializer errors
            on validation failure.
        """
        notification = Notification.objects.get(workspace__slug=slug, pk=pk, receiver=request.user)
        # Only read_at and snoozed_till can be updated
        notification_data = {"snoozed_till": request.data.get("snoozed_till", None)}
        serializer = NotificationSerializer(notification, data=notification_data, partial=True)

        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def mark_read(self, request, slug, pk):
        """Mark a single notification as read for the authenticated receiver.

        Sets ``read_at`` to ``timezone.now()`` on the targeted row and
        persists it. Idempotent: repeated POSTs simply re-stamp
        ``read_at`` with the latest call time without changing the
        observable read state.

        Side effects:
            UPDATE one ``Notification.read_at`` column. Returns HTTP
            200 with the serialized notification.
        """
        notification = Notification.objects.get(receiver=request.user, workspace__slug=slug, pk=pk)
        notification.read_at = timezone.now()
        notification.save()
        serializer = NotificationSerializer(notification)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def mark_unread(self, request, slug, pk):
        """Mark a single notification as unread for the authenticated receiver.

        Sets ``read_at`` back to ``None`` on the targeted row and
        persists it. Idempotent: repeated DELETEs leave ``read_at``
        as ``None``.

        Side effects:
            UPDATE one ``Notification.read_at`` column. Returns HTTP
            200 with the serialized notification.
        """
        notification = Notification.objects.get(receiver=request.user, workspace__slug=slug, pk=pk)
        notification.read_at = None
        notification.save()
        serializer = NotificationSerializer(notification)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def archive(self, request, slug, pk):
        """Archive a single notification for the authenticated receiver.

        Sets ``archived_at`` to ``timezone.now()`` on the targeted row
        and persists it. Idempotent: repeated POSTs re-stamp
        ``archived_at`` without changing observable archived state.

        Side effects:
            UPDATE one ``Notification.archived_at`` column. Returns
            HTTP 200 with the serialized notification.
        """
        notification = Notification.objects.get(receiver=request.user, workspace__slug=slug, pk=pk)
        notification.archived_at = timezone.now()
        notification.save()
        serializer = NotificationSerializer(notification)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def unarchive(self, request, slug, pk):
        """Restore a single archived notification for the authenticated receiver.

        Sets ``archived_at`` back to ``None`` on the targeted row and
        persists it. Idempotent: repeated DELETEs leave
        ``archived_at`` as ``None``.

        Side effects:
            UPDATE one ``Notification.archived_at`` column. Returns
            HTTP 200 with the serialized notification.
        """
        notification = Notification.objects.get(receiver=request.user, workspace__slug=slug, pk=pk)
        notification.archived_at = None
        notification.save()
        serializer = NotificationSerializer(notification)
        return Response(serializer.data, status=status.HTTP_200_OK)


class UnreadNotificationEndpoint(BaseAPIView):
    """Aggregated unread-notification counter for the inbox badge.

    Resource:
        Two integer counters derived from the authenticated user's
        unread, non-archived, non-snoozed ``Notification`` rows in the
        active workspace.

    HTTP methods and URL patterns:
        GET /api/workspaces/<slug>/users/notifications/unread/

    Response shape (HTTP 200):
        {
            "total_unread_notifications_count": int,
            "mention_unread_notifications_count": int,
        }

        ``total_unread_notifications_count`` excludes mentions (rows
        where ``sender`` icontains "mentioned") to align with the
        primary inbox view, which filters them out by default;
        ``mention_unread_notifications_count`` covers mentions only so
        the UI can render a distinct mentions badge.

    Permissions:
        - Inherits ``permission_classes = [IsAuthenticated]`` from
          ``BaseAPIView`` (authenticated session required).
        - The ``get`` method is additionally guarded by
          ``@allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER,
          ROLE.GUEST], level="WORKSPACE")``.

    Routing notes:
        ``use_read_replica = True`` directs the read through the
        configured PostgreSQL read replica via
        ``ReadReplicaControlMixin`` — acceptable because slightly
        stale unread counts are tolerable for badge UX.
    """

    use_read_replica = True

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        """Compute total and mention-only unread counts for the badge UI.

        Counts ``Notification`` rows for the authenticated receiver in
        the active workspace where ``read_at``, ``archived_at``, and
        ``snoozed_till`` are all NULL, splitting the result into two
        scalars: the non-mention bucket (``sender`` does NOT icontain
        "mentioned") and the mention bucket (``sender`` icontains
        "mentioned").

        Side effects:
            Read-only — no database writes.
        """
        # Watching Issues Count
        unread_notifications_count = (
            Notification.objects.filter(
                workspace__slug=slug,
                receiver_id=request.user.id,
                read_at__isnull=True,
                archived_at__isnull=True,
                snoozed_till__isnull=True,
            )
            .exclude(sender__icontains="mentioned")
            .count()
        )

        mention_notifications_count = Notification.objects.filter(
            workspace__slug=slug,
            receiver_id=request.user.id,
            read_at__isnull=True,
            archived_at__isnull=True,
            snoozed_till__isnull=True,
            sender__icontains="mentioned",
        ).count()

        return Response(
            {
                "total_unread_notifications_count": int(unread_notifications_count),
                "mention_unread_notifications_count": int(mention_notifications_count),
            },
            status=status.HTTP_200_OK,
        )


class MarkAllReadNotificationViewSet(BaseViewSet):
    """Bulk mark-as-read endpoint covering all unread notifications matching a filter.

    Resource:
        Server-side bulk mutation over the authenticated receiver's
        unread ``Notification`` rows in the active workspace.

    HTTP methods and URL patterns:
        POST /api/workspaces/<slug>/users/notifications/mark-all-read/

    Request body:
        snoozed (bool, optional, default False): when True restricts
            the affected set to rows whose ``snoozed_till`` is in the
            past OR not null; when False restricts to rows whose
            ``snoozed_till`` is in the future OR null.
        archived (bool, optional, default False): when True restricts
            to archived rows; when False restricts to non-archived
            rows.
        type (str, optional, default "all"): one of "all", "watching",
            "assigned", "created". Narrows the affected set by issue
            relationship using ``IssueSubscriber``, ``IssueAssignee``,
            or ``Issue.created_by`` respectively. The "created" branch
            is suppressed (yields an empty queryset) for
            non-elevated workspace members
            (``WorkspaceMember.role < 15``).

    Response shape (HTTP 200):
        {"message": "Successful"}

    Permissions:
        - Inherits ``permission_classes = [IsAuthenticated]`` from
          ``BaseViewSet``.
        - The ``create`` method is additionally guarded by
          ``@allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER,
          ROLE.GUEST], level="WORKSPACE")``.

    Idempotency:
        Idempotent. Re-issuing the same POST with the same filter
        produces the same end state — all matching rows have
        ``read_at`` set; rows already read are unaffected by the
        initial filter (which restricts to ``read_at IS NULL``).
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug):
        """Stamp ``read_at`` on every unread notification matching the request filter.

        Loads the filtered unread set in-memory, sets each row's
        ``read_at`` to ``timezone.now()``, and persists the change via
        ``Notification.objects.bulk_update(..., ["read_at"],
        batch_size=100)`` to issue at most ceil(N/100) UPDATE
        statements.

        Side effects:
            UPDATE up to N ``Notification.read_at`` columns where N is
            the number of unread rows matching the filter at call
            time. Returns HTTP 200 with ``{"message": "Successful"}``.
        """
        snoozed = request.data.get("snoozed", False)
        archived = request.data.get("archived", False)
        type = request.data.get("type", "all")

        notifications = (
            Notification.objects.filter(workspace__slug=slug, receiver_id=request.user.id, read_at__isnull=True)
            .select_related("workspace", "project", "triggered_by", "receiver")
            .order_by("snoozed_till", "-created_at")
        )

        # Filter for snoozed notifications
        if snoozed:
            notifications = notifications.filter(Q(snoozed_till__lt=timezone.now()) | Q(snoozed_till__isnull=False))
        else:
            notifications = notifications.filter(Q(snoozed_till__gte=timezone.now()) | Q(snoozed_till__isnull=True))

        # Filter for archived or unarchive
        if archived:
            notifications = notifications.filter(archived_at__isnull=False)
        else:
            notifications = notifications.filter(archived_at__isnull=True)

        # Subscribed issues
        if type == "watching":
            issue_ids = IssueSubscriber.objects.filter(workspace__slug=slug, subscriber_id=request.user.id).values_list(
                "issue_id", flat=True
            )
            notifications = notifications.filter(entity_identifier__in=issue_ids)

        # Assigned Issues
        if type == "assigned":
            issue_ids = IssueAssignee.objects.filter(workspace__slug=slug, assignee_id=request.user.id).values_list(
                "issue_id", flat=True
            )
            notifications = notifications.filter(entity_identifier__in=issue_ids)

        # Created issues
        if type == "created":
            if WorkspaceMember.objects.filter(
                workspace__slug=slug, member=request.user, role__lt=15, is_active=True
            ).exists():
                notifications = Notification.objects.none()
            else:
                issue_ids = Issue.objects.filter(workspace__slug=slug, created_by=request.user).values_list(
                    "pk", flat=True
                )
                notifications = notifications.filter(entity_identifier__in=issue_ids)

        updated_notifications = []
        for notification in notifications:
            notification.read_at = timezone.now()
            updated_notifications.append(notification)
        Notification.objects.bulk_update(updated_notifications, ["read_at"], batch_size=100)
        return Response({"message": "Successful"}, status=status.HTTP_200_OK)


class UserNotificationPreferenceEndpoint(BaseAPIView):
    """Per-user notification preference singleton (read and partial update).

    Resource:
        The authenticated user's single ``UserNotificationPreference``
        row, holding boolean toggles for ``property_change``,
        ``state_change``, ``comment``, ``mention``, and
        ``issue_completed`` notification categories.

    HTTP methods and URL patterns:
        GET   /api/users/me/notification-preferences/  -> get
        PATCH /api/users/me/notification-preferences/  -> patch

    Request body (PATCH):
        Any subset of the ``UserNotificationPreference`` boolean
        toggle fields (``property_change``, ``state_change``,
        ``comment``, ``mention``, ``issue_completed``). The serializer
        accepts a partial payload.

    Response shape:
        ``UserNotificationPreferenceSerializer`` rendering with all
        fields. HTTP 200 on success; HTTP 400 with serializer errors
        on validation failure.

    Permissions:
        Inherits ``permission_classes = [IsAuthenticated]`` from
        ``BaseAPIView``. NOT workspace-scoped — preferences are a
        global per-user singleton, so there is no ``slug`` parameter
        and no ``@allow_permission`` decorator.
    """

    model = UserNotificationPreference
    serializer_class = UserNotificationPreferenceSerializer

    # request the object
    def get(self, request):
        """Return the authenticated user's notification preference record.

        Side effects:
            Read-only. Raises ``UserNotificationPreference.DoesNotExist``
            (translated to HTTP 404 by ``BaseAPIView.handle_exception``)
            if the preference row has not yet been created for the user.
        """
        user_notification_preference = UserNotificationPreference.objects.get(user=request.user)
        serializer = UserNotificationPreferenceSerializer(user_notification_preference)
        return Response(serializer.data, status=status.HTTP_200_OK)

    # update the object
    def patch(self, request):
        """Update the authenticated user's notification preferences from a partial payload.

        Accepts any subset of the boolean toggle fields and persists
        them via the serializer's partial save path. Returns HTTP 200
        with the refreshed serialization on success or HTTP 400 with
        serializer errors on validation failure.

        Side effects:
            UPDATE the user's ``UserNotificationPreference`` row when
            the payload validates.
        """
        user_notification_preference = UserNotificationPreference.objects.get(user=request.user)
        serializer = UserNotificationPreferenceSerializer(user_notification_preference, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
