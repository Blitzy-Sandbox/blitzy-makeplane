# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Issue-link HTTP endpoints (AAP section 0.6.4 worked example).

Exposes :class:`IssueLinkViewSet` for full CRUD on :class:`IssueLink` --
URL records attached to an issue to reference external resources like
Figma boards, Notion pages, GitHub PRs, etc. On every create / update
the URL is dispatched to
:func:`plane.bgtasks.work_item_link_task.crawl_work_item_link_title`
(Celery via RabbitMQ) which scrapes the destination page title
asynchronously and updates the row in place. Every write also enqueues
``plane.bgtasks.issue_activities_task.issue_activity`` so the change
appears in the issue timeline.
"""

# Python imports
import json

# Django imports
from django.utils import timezone
from django.core.serializers.json import DjangoJSONEncoder

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet
from plane.app.serializers import IssueLinkSerializer
from plane.app.permissions import ProjectEntityPermission
from plane.db.models import IssueLink
from plane.bgtasks.issue_activities_task import issue_activity
from plane.bgtasks.work_item_link_task import crawl_work_item_link_title
from plane.utils.host import base_host


class IssueLinkViewSet(BaseViewSet):
    """CRUD endpoint for URL records attached to an issue (e.g. links to Figma boards, Notion pages, GitHub PRs).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-links/
                (action: ``list``)
        POST   /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-links/
                (action: ``create``)
        GET    /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-links/<pk>/
                (action: ``retrieve``)
        PATCH  /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-links/<pk>/
                (action: ``partial_update``)
        DELETE /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-links/<pk>/
                (action: ``destroy``)

    Request body (POST / PATCH):
        Fields validated by
        :class:`plane.app.serializers.IssueLinkSerializer`:
            * ``url`` (URL, required on POST) -- the external URL.
            * ``title`` (str, optional) -- human-readable label;
              automatically refreshed by the title-crawler Celery task
              after save.
            * ``metadata`` (JSONField, optional) -- typically the
              client-scraped OpenGraph image, favicon, description.

    Response shape:
        ``IssueLinkSerializer`` output (id, url, title, metadata,
        created_by, created_at, updated_at). After ``create`` /
        ``partial_update`` the row is re-fetched through
        :meth:`get_queryset` so the response reflects any annotations
        added by the queryset.

    Permissions:
        permission_classes = [ProjectEntityPermission]
            -- declared on the class attribute (see
            ``apps/api/plane/app/views/issue/link.py``).
            Members of the project (active ``ProjectMember`` row,
            role >= GUEST) may CRUD links; non-members receive HTTP
            403. See :class:`plane.app.permissions.project.ProjectEntityPermission`.

    get_queryset filter logic:
        Filters by ``workspace__slug``, ``project_id``, ``issue_id`` from
        URL kwargs, restricts to active project members on a
        non-archived project, orders by ``-created_at``, distinct.

    Side effects (Celery via RabbitMQ -- NOT Redis):
        * ``create`` / ``partial_update`` enqueue
          ``crawl_work_item_link_title.delay(...)`` (see
          :func:`plane.bgtasks.work_item_link_task.crawl_work_item_link_title`)
          which fetches the destination page's ``<title>``
          asynchronously and updates the row in place. The worker is
          NON-idempotent only insofar as it overwrites ``title`` --
          safe to retry.
        * Every write enqueues ``issue_activity.delay(...)`` (see
          :func:`plane.bgtasks.issue_activities_task.issue_activity`)
          with ``type="link.activity.{created|updated|deleted}"`` so the
          change appears in the issue activity timeline.

    Cross-references:
        * Permission: :class:`plane.app.permissions.ProjectEntityPermission`
          (``apps/api/plane/app/permissions/project.py``)
        * Serializer: :class:`plane.app.serializers.IssueLinkSerializer`
          (``apps/api/plane/app/serializers/issue.py``)
        * Model: :class:`plane.db.models.IssueLink`
          (``apps/api/plane/db/models/issue.py``)
        * Title scraper task: ``apps/api/plane/bgtasks/work_item_link_task.py``
        * Activity task: ``apps/api/plane/bgtasks/issue_activities_task.py``
    """

    permission_classes = [ProjectEntityPermission]

    model = IssueLink
    serializer_class = IssueLinkSerializer

    def get_queryset(self):
        """Return :class:`IssueLink` rows for the URL's workspace + project + issue.

        Restricted to active project members on a non-archived project;
        ordered by ``-created_at``.
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

    def create(self, request, slug, project_id, issue_id):
        """Create a new link on the issue and return the re-fetched serialized row.

        Enqueues the title-scraper Celery task and a
        ``link.activity.created`` activity (Celery via RabbitMQ).
        """
        serializer = IssueLinkSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(project_id=project_id, issue_id=issue_id)
            crawl_work_item_link_title.delay(serializer.data.get("id"), serializer.data.get("url"))
            issue_activity.delay(
                type="link.activity.created",
                requested_data=json.dumps(serializer.data, cls=DjangoJSONEncoder),
                actor_id=str(self.request.user.id),
                issue_id=str(self.kwargs.get("issue_id")),
                project_id=str(self.kwargs.get("project_id")),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )

            issue_link = self.get_queryset().get(id=serializer.data.get("id"))
            serializer = IssueLinkSerializer(issue_link)

            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def partial_update(self, request, slug, project_id, issue_id, pk):
        """Update the link and return the re-fetched serialized row.

        Re-enqueues the title-scraper Celery task (URL may have changed)
        and a ``link.activity.updated`` activity (Celery via RabbitMQ).
        """
        issue_link = IssueLink.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        requested_data = json.dumps(request.data, cls=DjangoJSONEncoder)
        current_instance = json.dumps(IssueLinkSerializer(issue_link).data, cls=DjangoJSONEncoder)

        serializer = IssueLinkSerializer(issue_link, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            crawl_work_item_link_title.delay(serializer.data.get("id"), serializer.data.get("url"))

            issue_activity.delay(
                type="link.activity.updated",
                requested_data=requested_data,
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=current_instance,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            issue_link = self.get_queryset().get(id=serializer.data.get("id"))
            serializer = IssueLinkSerializer(issue_link)

            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def destroy(self, request, slug, project_id, issue_id, pk):
        """Capture a snapshot, enqueue a delete activity, then delete the row.

        Enqueues ``link.activity.deleted`` via Celery / RabbitMQ.
        """
        issue_link = IssueLink.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        current_instance = json.dumps(IssueLinkSerializer(issue_link).data, cls=DjangoJSONEncoder)
        issue_activity.delay(
            type="link.activity.deleted",
            requested_data=json.dumps({"link_id": str(pk)}),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        issue_link.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
