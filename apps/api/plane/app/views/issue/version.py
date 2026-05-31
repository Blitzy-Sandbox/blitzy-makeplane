# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Read-only version-history HTTP endpoints for issues.

Exposes two endpoints serving the append-only version snapshots
populated by the live-server collaboration callback chain:

* :class:`IssueVersionEndpoint` -- :class:`IssueVersion` rows
  (whole-issue snapshots written by
  :func:`plane.bgtasks.issue_version_sync.issue_version_task`).
* :class:`WorkItemDescriptionVersionEndpoint` --
  :class:`IssueDescriptionVersion` rows (description-only snapshots
  written by
  :func:`plane.bgtasks.issue_description_version_task.issue_description_version_task`,
  triggered by the ``apps/live`` HocusPocus server when it persists a
  Y.Doc).

Both endpoints are GET-only -- versions are never written through the
public API. Pagination is cursor-based via
:func:`plane.utils.global_paginator.paginate`; datetime fields are
converted to the requesting user's timezone before serialization.
"""

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.db.models import (
    IssueVersion,
    IssueDescriptionVersion,
    Project,
    ProjectMember,
    Issue,
)
from ..base import BaseAPIView
from plane.app.serializers import (
    IssueVersionDetailSerializer,
    IssueDescriptionVersionDetailSerializer,
)
from plane.app.permissions import allow_permission, ROLE
from plane.utils.global_paginator import paginate
from plane.utils.timezone_converter import user_timezone_converter


class IssueVersionEndpoint(BaseAPIView):
    """Read-only version history for issues.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/versions/
              -- cursor-paginated list of :class:`IssueVersion` rows.
        GET /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/versions/<pk>/
              -- single :class:`IssueVersion` with full detail.

    Query parameters (list):
        cursor (str, optional): cursor returned by the previous page.

    Response shape:
        - Detail: :class:`IssueVersionDetailSerializer` output.
        - List: ``{"results": [...], "next_cursor": str, ...}``
          (cursor-paginated values dict with fields ``id``, ``workspace``,
          ``project``, ``issue``, ``last_saved_at``, ``owned_by``,
          ``created_at``, ``updated_at``, ``created_by``, ``updated_by``;
          ``created_at`` / ``updated_at`` are converted to the
          requesting user's ``user_timezone``).

    Permissions:
        permission_classes -- not set on the class; inherits
        ``[IsAuthenticated]`` from :class:`BaseAPIView`.
        Per-method gate: ``@allow_permission(allowed_roles=[ROLE.ADMIN,
        ROLE.MEMBER, ROLE.GUEST])``.

    Write path:
        Versions are NEVER created via this endpoint. Rows are written
        by Celery tasks triggered when the live-server collaboration
        layer persists Y.Doc snapshots (see
        ``plane.bgtasks.issue_version_sync``).
    """

    def process_paginated_result(self, fields, results, timezone):
        """Project the paginated queryset to ``fields`` via ``.values(*fields)`` and convert ``created_at`` / ``updated_at`` to the given user ``timezone``."""
        paginated_data = results.values(*fields)

        datetime_fields = ["created_at", "updated_at"]
        paginated_data = user_timezone_converter(paginated_data, datetime_fields, timezone)

        return paginated_data

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id, pk=None):
        """Return one :class:`IssueVersion` (when ``pk`` is given) or a cursor-paginated list of versions for the issue."""
        if pk:
            issue_version = IssueVersion.objects.get(
                workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk
            )

            serializer = IssueVersionDetailSerializer(issue_version)
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

        issue_versions_queryset = IssueVersion.objects.filter(
            workspace__slug=slug, project_id=project_id, issue_id=issue_id
        )

        paginated_data = paginate(
            base_queryset=issue_versions_queryset,
            queryset=issue_versions_queryset,
            cursor=cursor,
            on_result=lambda results: self.process_paginated_result(
                required_fields, results, request.user.user_timezone
            ),
        )

        return Response(paginated_data, status=status.HTTP_200_OK)


class WorkItemDescriptionVersionEndpoint(BaseAPIView):
    """Read-only description-only version history for work items (issues), populated by the live-server collaboration layer.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<project_id>/work-items/<work_item_id>/description-versions/
              -- cursor-paginated list of
              :class:`IssueDescriptionVersion` rows ordered by
              ``-created_at``.
        GET /api/workspaces/<slug>/projects/<project_id>/work-items/<work_item_id>/description-versions/<pk>/
              -- single :class:`IssueDescriptionVersion` with full
              detail.

    Query parameters (list):
        cursor (str, optional): cursor returned by the previous page.

    Response shape:
        - Detail: :class:`IssueDescriptionVersionDetailSerializer`
          output.
        - List: ``{"results": [...], "next_cursor": str, ...}`` (same
          ``required_fields`` shape as :class:`IssueVersionEndpoint`).

    Permissions:
        permission_classes -- not set on the class; inherits
        ``[IsAuthenticated]`` from :class:`BaseAPIView`.
        Per-method gate: ``@allow_permission(allowed_roles=[ROLE.ADMIN,
        ROLE.MEMBER, ROLE.GUEST])``.

    Guest restriction:
        If the requesting user is a project guest
        (``role=ROLE.GUEST.value``) AND
        ``project.guest_view_all_features`` is ``False`` AND the user is
        not the issue's creator, the response is HTTP 403 with
        ``{"error": "You are not allowed to view this issue"}``.

    Write path:
        Rows are written by
        :func:`plane.bgtasks.issue_description_version_task.issue_description_version_task`
        (Celery via RabbitMQ) when the ``apps/live`` HocusPocus server
        persists a Y.Doc -- see tech spec section 5.2.5.4.
    """

    def process_paginated_result(self, fields, results, timezone):
        """Project the paginated queryset to ``fields`` via ``.values(*fields)`` and convert ``created_at`` / ``updated_at`` to the given user ``timezone``."""
        paginated_data = results.values(*fields)

        datetime_fields = ["created_at", "updated_at"]
        paginated_data = user_timezone_converter(paginated_data, datetime_fields, timezone)

        return paginated_data

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, work_item_id, pk=None):
        """Return one :class:`IssueDescriptionVersion` (when ``pk`` is given) or a cursor-paginated list ordered by ``-created_at``.

        Returns HTTP 403 if the requesting user is a project guest
        (``role=ROLE.GUEST.value``) who is not the issue creator AND
        the project does not have ``guest_view_all_features`` enabled.
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
        ).order_by("-created_at")
        paginated_data = paginate(
            base_queryset=issue_description_versions_queryset,
            queryset=issue_description_versions_queryset,
            cursor=cursor,
            on_result=lambda results: self.process_paginated_result(
                required_fields, results, request.user.user_timezone
            ),
        )
        return Response(paginated_data, status=status.HTTP_200_OK)
