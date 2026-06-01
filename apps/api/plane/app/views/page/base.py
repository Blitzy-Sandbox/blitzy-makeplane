# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace page CRUD, favorites, description binary callback, and duplication endpoints.

This module defines the FOUR DRF view classes that constitute Plane's
main page API surface, plus the module-level recursive-SQL helper used
by archive / unarchive flows. All endpoints are mounted under
``/api/workspaces/<slug>/projects/<project_id>/pages/...`` (see
:mod:`plane.app.urls.page` for the full URL map):

* :class:`PageViewSet` -- main ``ModelViewSet`` for page CRUD,
  archive / unarchive, lock / unlock, access toggle (Public / Private),
  and a per-project summary aggregator.
* :class:`PageFavoriteViewSet` -- user favorite toggle on pages via
  :class:`plane.db.models.UserFavorite` with
  ``entity_type="page"``.
* :class:`PagesDescriptionViewSet` -- streams the Y.js binary
  description on ``GET`` and accepts the LIVE-SERVER CALLBACK on
  ``PATCH``. The PATCH endpoint is the destination for every persisted
  Y.js update broadcast by :mod:`apps.live` (see live-server callback
  contract below).
* :class:`PageDuplicateEndpoint` -- clones a page, reassigns
  ownership / audit metadata, recreates :class:`ProjectPage` junction
  rows, and queues S3 asset duplication via Celery.

The module-level helper
:func:`unarchive_archive_page_and_descendants` performs a recursive SQL
``WITH RECURSIVE ... UPDATE`` against the ``pages`` table to set the
archive marker on a page AND every transitive sub-page in one
statement. This is the low-level mechanism used by both
:meth:`PageViewSet.archive` and :meth:`PageViewSet.unarchive`.

Live-server callback contract (tech spec §5.2.1.4 -- BINDING):

* Pages own THREE description fields:
    * ``description_html`` (TextField) -- rendered HTML for UI and
      export.
    * ``description_binary`` (BinaryField) -- Y.js binary state,
      WRITTEN by :mod:`apps.live` via the PATCH callback below.
    * ``description_stripped`` (TextField) -- text-only, auto-derived
      from ``description_html`` in :meth:`Page.save` for full-text
      search.
* The :mod:`apps.live` HocusPocus server holds the live Y.Doc for
  each page. On a 10-second debounced persistence (tech spec
  §5.2.5.4), :mod:`apps.live.extensions.database` PATCHes
  ``/pages/<page_id>/description/`` (handled by
  :meth:`PagesDescriptionViewSet.partial_update`) with the
  ``description_binary`` (base64-encoded) plus the rendered
  ``description_html`` and ``description_json`` payloads.
* HTML→binary backfill: on first live-server load, if
  ``description_binary`` is empty (e.g., legacy pages predating Y.js
  collaboration), :mod:`apps.live` converts ``description_html`` to
  Y.js binary state once and PATCHes the result back -- this is
  idempotent (happens at most once per page).
* Conflict resolution: Y.js CRDT auto-merge -- no explicit resolver
  callback is registered. Last-writer-wins is structural via the
  CRDT, not a separate policy.

Architectural context (per the shared rules from
:doc:`/AGENT_ACTION_PLAN`):

* Celery workers consume tasks from RabbitMQ; Redis is used for
  caching / session only.
* Page version snapshots are written by the Celery tasks
  :func:`plane.bgtasks.page_version_task.track_page_version` (queued
  from :meth:`PagesDescriptionViewSet.partial_update`) and
  :func:`plane.bgtasks.page_transaction_task.page_transaction`
  (queued from :meth:`PageViewSet.create`,
  :meth:`PageViewSet.partial_update`,
  :meth:`PagesDescriptionViewSet.partial_update`, and
  :meth:`PageDuplicateEndpoint.post`).
* S3 asset duplication (page-embedded images / attachments) is
  handled by
  :func:`plane.bgtasks.copy_s3_object.copy_s3_objects_of_description_and_assets`,
  queued from :meth:`PageDuplicateEndpoint.post`.
* Recent-visit logging is handled by
  :func:`plane.bgtasks.recent_visited_task.recent_visited_task`,
  queued from :meth:`PageViewSet.retrieve` when
  ``?track_visit=true``.
"""

# Python imports
import json
from datetime import datetime
from django.core.serializers.json import DjangoJSONEncoder

# Django imports
from django.db import connection
from django.db.models import (
    Exists,
    OuterRef,
    Q,
    Value,
    UUIDField,
    Count,
    Case,
    When,
    IntegerField,
)
from django.http import StreamingHttpResponse
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models.functions import Coalesce

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import (
    PageSerializer,
    PageDetailSerializer,
    PageBinaryUpdateSerializer,
)
from plane.db.models import (
    Page,
    PageLog,
    UserFavorite,
    ProjectMember,
    ProjectPage,
    Project,
    UserRecentVisit,
)
from plane.utils.error_codes import ERROR_CODES

# Local imports
from ..base import BaseAPIView, BaseViewSet
from plane.bgtasks.page_transaction_task import page_transaction
from plane.bgtasks.page_version_task import track_page_version
from plane.bgtasks.recent_visited_task import recent_visited_task
from plane.bgtasks.copy_s3_object import copy_s3_objects_of_description_and_assets
from plane.app.permissions import ProjectPagePermission


def unarchive_archive_page_and_descendants(page_id, archived_at):
    """Recursively set ``archived_at`` on a page and its transitive sub-pages.

    Pass ``archived_at=datetime.now()`` to archive the subtree, or
    ``archived_at=None`` to unarchive it. The recursion uses a single
    ``WITH RECURSIVE`` SQL UPDATE that walks ``parent_id`` links in
    the ``pages`` table to identify every descendant in one
    statement, sidestepping Python-side ORM traversal cost for deep
    page hierarchies.
    """
    # Your SQL query
    sql = """
    WITH RECURSIVE descendants AS (
        SELECT id FROM pages WHERE id = %s
        UNION ALL
        SELECT pages.id FROM pages, descendants WHERE pages.parent_id = descendants.id
    )
    UPDATE pages SET archived_at = %s WHERE id IN (SELECT id FROM descendants);
    """

    # Execute the SQL query
    with connection.cursor() as cursor:
        cursor.execute(sql, [page_id, archived_at])


class PageViewSet(BaseViewSet):
    """Workspace page CRUD plus archive / lock / access state transitions.

    Resource managed:
        :class:`plane.db.models.Page` -- collaborative documents
        scoped to a workspace and one-or-more projects (via the
        :class:`plane.db.models.ProjectPage` junction). A page carries
        three description fields (``description_html``,
        ``description_binary``, ``description_stripped``,
        ``description_json``), an ``owned_by`` user, a binary
        ``access`` flag (Public=0, Private=1), an optional self-FK
        ``parent`` for sub-page hierarchies, an ``is_locked`` flag for
        collaboration locks, and an ``archived_at`` date for soft
        archive (not soft-delete -- archived pages still exist and
        can be unarchived).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/pages-summary/
            -- aggregate counts via ``summary`` action.
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/pages/
            -- ``list`` (top-level pages only; sub-pages filtered out
            by the ``parent__isnull=True`` clause in get_queryset).
        POST   /api/workspaces/<slug>/projects/<uuid:project_id>/pages/
            -- ``create``.
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/
            -- ``retrieve``.
        PATCH  /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/
            -- ``partial_update``.
        DELETE /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/
            -- ``destroy`` (only allowed AFTER archive).
        POST   /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/archive/
            -- ``archive``.
        DELETE /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/archive/
            -- ``unarchive``.
        POST   /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/lock/
            -- ``lock``.
        DELETE /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/lock/
            -- ``unlock``.
        POST   /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/access/
            -- ``access`` (toggle Public/Private).

    Request body (POST create):
        name (str, optional): page name.
        description_html (str, optional, default ``"<p></p>"``):
            rendered HTML; passed through to :meth:`Page.save` which
            also derives ``description_stripped``.
        description_binary (bytes, optional, default ``None``): Y.js
            binary state; usually ``None`` on create -- the live
            server's HTML→binary backfill will populate it on first
            connect.
        description_json (JSON, optional, default ``{}``): TipTap
            document JSON.
        access (int enum, optional, default 0): ``Page.PUBLIC_ACCESS``
            (0) or ``Page.PRIVATE_ACCESS`` (1).
        parent (UUID, optional): parent page for sub-page hierarchy.
        labels (list[UUID], optional, write-only): label UUIDs to
            attach via the :class:`PageLabel` junction.
        color (str, optional): UI color token.
        view_props / logo_props (JSON, optional).

    Request body (PATCH partial_update):
        Same fields as POST, all optional. Edit gates:
            * If ``page.is_locked`` -- rejects with HTTP 400
              ``{"error": "Page is locked"}``.
            * If a ``parent`` UUID is supplied, the parent page must
              exist in the same workspace + project + not be deleted;
              otherwise raises and falls through to
              :class:`Page.DoesNotExist` handling (which returns HTTP
              400 -- the error message is misleadingly
              "Access cannot be updated since this page is owned by
              someone else", preserved per system boundary).
            * Changing ``access`` is restricted to the page owner;
              non-owners receive HTTP 400.

    Response shape:
        :class:`plane.app.serializers.PageSerializer` for list /
        summary, :class:`plane.app.serializers.PageDetailSerializer`
        for retrieve / create / partial_update (the detail serializer
        adds ``description_html`` to the list serializer's field set).
        Notably, the binary ``description_binary`` is NEVER returned
        by these endpoints -- it is streamed separately via
        :class:`PagesDescriptionViewSet.retrieve`.

        Detail responses additionally include:
            * ``is_favorite`` (bool) -- Exists subquery annotation.
            * ``label_ids`` (list[UUID]) -- ArrayAgg of attached
              labels.
            * ``project_ids`` (list[UUID]) -- ArrayAgg of the
              projects this page belongs to.
            * ``issue_ids`` (list[UUID]) -- attached only on
              :meth:`retrieve` from :class:`PageLog` rows with
              ``entity_name="issue"``.

    Permissions:
        ``permission_classes = [ProjectPagePermission]`` -- declared on
        the class attribute (see
        :file:`apps/api/plane/app/views/page/base.py`). Defined in
        :class:`plane.app.permissions.page.ProjectPagePermission`.
            -- defined in :mod:`plane.app.permissions.page`. Enforces:
            (1) the requesting user is an active project member;
            (2) for private pages, the user is the owner OR a
                workspace admin;
            (3) for public pages, role-based (ADMIN / MEMBER, and
                GUEST when the project has
                ``guest_view_all_features``).

    Side effects (Celery via RabbitMQ -- NOT Redis):
        * ``create`` queues
          ``page_transaction.delay(new_description_html, old=None,
          page_id)`` for activity logging.
        * ``partial_update`` queues ``page_transaction.delay(...)``
          ONLY if ``description_html`` is in the request payload
          (other field-only patches do not emit transactions).
        * ``retrieve`` queues
          ``recent_visited_task.delay(slug, entity_name="page",
          entity_identifier=page_id, user_id, project_id)`` when the
          ``?track_visit=true`` query param is present (default true).
        * ``archive`` hard-deletes related :class:`UserFavorite`
          rows for this page across all users.
        * ``destroy`` requires ``archived_at IS NOT NULL`` first
          (HTTP 400 ``"The page should be archived before deleting"``
          otherwise), detaches child pages' parent FK, hard-deletes
          the page, and cascade-deletes :class:`UserFavorite` +
          :class:`UserRecentVisit` rows.

    Queryset filter logic (``get_queryset``):
        Restricts to pages in the URL workspace where the requesting
        user is an ACTIVE project member, the project is not
        archived, the page is TOP-LEVEL (``parent__isnull=True``),
        and either the page is PUBLIC or the user is the owner
        (``Q(owned_by=user) | Q(access=0)``). Annotates
        ``is_favorite`` (Exists subquery), ``label_ids`` and
        ``project_ids`` (ArrayAgg). Orders by ``-is_favorite,
        -created_at``. Note: sub-pages (with non-null parent) are
        intentionally excluded from list views -- they appear only
        via parent-page traversal.

        Architectural note: heavy ``.annotate(...)`` aggregation;
        the migrator container runs Django migrations before this
        view loads at request time, so the underlying schema
        (``pages``, ``project_pages``, ``page_labels``, ``user_favorites``)
        is guaranteed to be present.

    Class attributes:
        * ``serializer_class = PageSerializer``
        * ``model = Page``
        * ``permission_classes = [ProjectPagePermission]``
        * ``search_fields = ["name"]`` -- enables ``?search=<q>`` via
          DRF's ``SearchFilter`` (inherited from
          :class:`BaseViewSet`).

    Cross-references:
        - Permissions: ``plane.app.permissions.ProjectPagePermission``,
          ``plane.app.permissions.allow_permission``.
        - Serializers: ``plane.app.serializers.PageSerializer``,
          ``plane.app.serializers.PageDetailSerializer``,
          ``plane.app.serializers.PageLogSerializer``,
          ``plane.app.serializers.SubPageSerializer``.
        - Models: ``plane.db.models.Page``, ``plane.db.models.ProjectPage``,
          ``plane.db.models.PageLog``, ``plane.db.models.UserFavorite``,
          ``plane.db.models.UserRecentVisit``.
        - Celery tasks (via RabbitMQ):
            ``plane.bgtasks.page_transaction_task.page_transaction``,
            ``plane.bgtasks.recent_visited_task``.
        - URL registration: ``apps/api/plane/app/urls/page.py``.
    """

    serializer_class = PageSerializer
    model = Page
    permission_classes = [ProjectPagePermission]
    search_fields = ["name"]

    def get_queryset(self):
        """Return TOP-LEVEL pages in the URL workspace/project for the requesting user.

        Restricts to Public OR owned pages and annotates each row
        with ``is_favorite``, ``label_ids``, and ``project_ids``.
        """
        subquery = UserFavorite.objects.filter(
            user=self.request.user,
            entity_type="page",
            entity_identifier=OuterRef("pk"),
            workspace__slug=self.kwargs.get("slug"),
        )
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(
                projects__project_projectmember__member=self.request.user,
                projects__project_projectmember__is_active=True,
                projects__archived_at__isnull=True,
            )
            .filter(parent__isnull=True)
            .filter(Q(owned_by=self.request.user) | Q(access=0))
            .prefetch_related("projects")
            .select_related("workspace")
            .select_related("owned_by")
            .annotate(is_favorite=Exists(subquery))
            .order_by(self.request.GET.get("order_by", "-created_at"))
            .prefetch_related("labels")
            .order_by("-is_favorite", "-created_at")
            .annotate(
                project=Exists(
                    ProjectPage.objects.filter(page_id=OuterRef("id"), project_id=self.kwargs.get("project_id"))
                )
            )
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "page_labels__label_id",
                        distinct=True,
                        filter=~Q(page_labels__label_id__isnull=True),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                project_ids=Coalesce(
                    ArrayAgg("projects__id", distinct=True, filter=~Q(projects__id=True)),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
            .filter(project=True)
            .distinct()
        )

    def create(self, request, slug, project_id):
        """Create a workspace/project page and queue an activity log entry.

        Queues a ``page_transaction`` Celery task for activity
        logging and returns the page via PageDetailSerializer.
        """
        serializer = PageSerializer(
            data=request.data,
            context={
                "project_id": project_id,
                "owned_by_id": request.user.id,
                "description_json": request.data.get("description_json", {}),
                "description_binary": request.data.get("description_binary", None),
                "description_html": request.data.get("description_html", "<p></p>"),
            },
        )

        if serializer.is_valid():
            serializer.save()
            # capture the page transaction
            page_transaction.delay(
                new_description_html=request.data.get("description_html", "<p></p>"),
                old_description_html=None,
                page_id=serializer.data["id"],
            )
            page = self.get_queryset().get(pk=serializer.data["id"])
            serializer = PageDetailSerializer(page)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def partial_update(self, request, slug, project_id, page_id):
        """Patch a page; reject locked pages and gate ``access`` changes to the owner.

        Validates the ``parent`` FK when supplied and queues
        ``page_transaction`` only when ``description_html`` changes.
        """
        try:
            page = Page.objects.get(
                pk=page_id,
                workspace__slug=slug,
                projects__id=project_id,
                project_pages__deleted_at__isnull=True,
            )

            if page.is_locked:
                return Response({"error": "Page is locked"}, status=status.HTTP_400_BAD_REQUEST)

            parent = request.data.get("parent", None)
            if parent:
                _ = Page.objects.get(
                    pk=parent,
                    workspace__slug=slug,
                    projects__id=project_id,
                    project_pages__deleted_at__isnull=True,
                )

            # Only update access if the page owner is the requesting  user
            if page.access != request.data.get("access", page.access) and page.owned_by_id != request.user.id:
                return Response(
                    {"error": "Access cannot be updated since this page is owned by someone else"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            serializer = PageDetailSerializer(page, data=request.data, partial=True)
            page_description = page.description_html
            if serializer.is_valid():
                serializer.save()
                # capture the page transaction
                if request.data.get("description_html"):
                    page_transaction.delay(
                        new_description_html=request.data.get("description_html", "<p></p>"),
                        old_description_html=page_description,
                        page_id=page_id,
                    )

                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except Page.DoesNotExist:
            return Response(
                {"error": "Access cannot be updated since this page is owned by someone else"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def retrieve(self, request, slug, project_id, page_id=None):
        """Return a page with ``issue_ids`` from PageLog and optionally log a recent visit.

        Queues ``recent_visited_task`` for UserRecentVisit logging
        when ``?track_visit=true``. GUEST users see only owned pages
        unless ``guest_view_all_features`` is enabled on the project.
        """
        page = self.get_queryset().filter(pk=page_id).first()
        project = Project.objects.get(pk=project_id)
        track_visit = request.query_params.get("track_visit", "true").lower() == "true"

        """
        if the role is guest and guest_view_all_features is false and owned by is not
        the requesting user then dont show the page
        """

        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=5,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
            and not page.owned_by == request.user
        ):
            return Response(
                {"error": "You are not allowed to view this page"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if page is None:
            return Response({"error": "Page not found"}, status=status.HTTP_404_NOT_FOUND)
        else:
            issue_ids = PageLog.objects.filter(page_id=page_id, entity_name="issue").values_list(
                "entity_identifier", flat=True
            )
            data = PageDetailSerializer(page).data
            data["issue_ids"] = issue_ids
            if track_visit:
                recent_visited_task.delay(
                    slug=slug,
                    entity_name="page",
                    entity_identifier=page_id,
                    user_id=request.user.id,
                    project_id=project_id,
                )
            return Response(data, status=status.HTTP_200_OK)

    def lock(self, request, slug, project_id, page_id):
        """Set ``is_locked=True`` to block collaborative editing on the page.

        While locked, :class:`PagesDescriptionViewSet.partial_update`
        rejects Y.js update PATCHes from :mod:`apps.live`.
        """
        page = Page.objects.get(
            pk=page_id,
            workspace__slug=slug,
            projects__id=project_id,
            project_pages__deleted_at__isnull=True,
        )

        page.is_locked = True
        page.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def unlock(self, request, slug, project_id, page_id):
        """Set ``is_locked=False`` on the page so collaborative editing is re-enabled."""
        page = Page.objects.get(
            pk=page_id,
            workspace__slug=slug,
            projects__id=project_id,
            project_pages__deleted_at__isnull=True,
        )

        page.is_locked = False
        page.save()

        return Response(status=status.HTTP_204_NO_CONTENT)

    def access(self, request, slug, project_id, page_id):
        """Toggle the page's visibility between Public (0) and Private (1).

        Only the page owner may change visibility; non-owners
        receive HTTP 400.
        """
        access = request.data.get("access", 0)
        page = Page.objects.get(
            pk=page_id,
            workspace__slug=slug,
            projects__id=project_id,
            project_pages__deleted_at__isnull=True,
        )

        # Only update access if the page owner is the requesting user
        if page.access != request.data.get("access", page.access) and page.owned_by_id != request.user.id:
            return Response(
                {"error": "Access cannot be updated since this page is owned by someone else"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        page.access = access
        page.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def list(self, request, slug, project_id):
        """List the project's top-level pages with GUEST visibility filtering.

        GUEST users see only owned pages unless
        ``guest_view_all_features`` is enabled on the project.
        """
        queryset = self.get_queryset()
        project = Project.objects.get(pk=project_id)
        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=5,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
        ):
            queryset = queryset.filter(owned_by=request.user)
        pages = PageSerializer(queryset, many=True).data
        return Response(pages, status=status.HTTP_200_OK)

    def archive(self, request, slug, project_id, page_id):
        """Archive the page and all transitive sub-pages via recursive SQL.

        Cascade-deletes related UserFavorite rows for this page.
        Only the page owner or workspace admin may archive.
        """
        page = Page.objects.get(
            pk=page_id,
            workspace__slug=slug,
            projects__id=project_id,
            project_pages__deleted_at__isnull=True,
        )

        # only the owner or admin can archive the page
        if (
            ProjectMember.objects.filter(
                project_id=project_id, member=request.user, is_active=True, role__lte=15
            ).exists()
            and request.user.id != page.owned_by_id
        ):
            return Response(
                {"error": "Only the owner or admin can archive the page"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        UserFavorite.objects.filter(
            entity_type="page",
            entity_identifier=page_id,
            project_id=project_id,
            workspace__slug=slug,
        ).delete()

        unarchive_archive_page_and_descendants(page_id, datetime.now())

        return Response({"archived_at": str(datetime.now())}, status=status.HTTP_200_OK)

    def unarchive(self, request, slug, project_id, page_id):
        """Unarchive the page and all sub-pages via recursive SQL.

        If the parent is still archived, detach the parent FK to
        preserve the
        unarchive-doesn't-leak-into-archived-subtree invariant.
        """
        page = Page.objects.get(
            pk=page_id,
            workspace__slug=slug,
            projects__id=project_id,
            project_pages__deleted_at__isnull=True,
        )

        # only the owner or admin can un archive the page
        if (
            ProjectMember.objects.filter(
                project_id=project_id, member=request.user, is_active=True, role__lte=15
            ).exists()
            and request.user.id != page.owned_by_id
        ):
            return Response(
                {"error": "Only the owner or admin can un archive the page"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # if parent archived then page will be un archived breaking hierarchy
        if page.parent_id and page.parent.archived_at:
            page.parent = None
            page.save(update_fields=["parent"])

        unarchive_archive_page_and_descendants(page_id, None)

        return Response(status=status.HTTP_204_NO_CONTENT)

    def destroy(self, request, slug, project_id, page_id):
        """Hard-delete an ARCHIVED page (rejects unarchived with HTTP 400).

        Only the page owner or workspace admin (role=20) may
        delete. Detaches all child pages' parent FK then
        cascade-deletes UserFavorite + UserRecentVisit rows for
        this page.
        """
        page = Page.objects.get(
            pk=page_id,
            workspace__slug=slug,
            projects__id=project_id,
            project_pages__deleted_at__isnull=True,
        )

        if page.archived_at is None:
            return Response(
                {"error": "The page should be archived before deleting"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if page.owned_by_id != request.user.id and (
            not ProjectMember.objects.filter(
                workspace__slug=slug,
                member=request.user,
                role=20,
                project_id=project_id,
                is_active=True,
            ).exists()
        ):
            return Response(
                {"error": "Only admin or owner can delete the page"},
                status=status.HTTP_403_FORBIDDEN,
            )

        # remove parent from all the children
        _ = Page.objects.filter(
            parent_id=page_id,
            projects__id=project_id,
            workspace__slug=slug,
            project_pages__deleted_at__isnull=True,
        ).update(parent=None)

        page.delete()
        # Delete the user favorite page
        UserFavorite.objects.filter(
            project=project_id,
            workspace__slug=slug,
            entity_identifier=page_id,
            entity_type="page",
        ).delete()
        # Delete the page from recent visit
        UserRecentVisit.objects.filter(
            project_id=project_id,
            workspace__slug=slug,
            entity_identifier=page_id,
            entity_name="page",
        ).delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def summary(self, request, slug, project_id):
        """Return aggregate page counts for the project.

        Returns ``public_pages`` (access=0, active),
        ``private_pages`` (access=1, active), and ``archived_pages``
        (any access, archived). GUESTs see only owned pages unless
        ``guest_view_all_features`` is enabled on the project.
        """
        queryset = (
            Page.objects.filter(workspace__slug=slug)
            .filter(
                projects__project_projectmember__member=self.request.user,
                projects__project_projectmember__is_active=True,
                projects__archived_at__isnull=True,
            )
            .filter(parent__isnull=True)
            .filter(Q(owned_by=request.user) | Q(access=0))
            .annotate(
                project=Exists(
                    ProjectPage.objects.filter(page_id=OuterRef("id"), project_id=self.kwargs.get("project_id"))
                )
            )
            .filter(project=True)
            .distinct()
        )

        project = Project.objects.get(pk=project_id)
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
            queryset = queryset.filter(owned_by=request.user)

        stats = queryset.aggregate(
            public_pages=Count(
                Case(
                    When(access=Page.PUBLIC_ACCESS, archived_at__isnull=True, then=1),
                    output_field=IntegerField(),
                )
            ),
            private_pages=Count(
                Case(
                    When(access=Page.PRIVATE_ACCESS, archived_at__isnull=True, then=1),
                    output_field=IntegerField(),
                )
            ),
            archived_pages=Count(Case(When(archived_at__isnull=False, then=1), output_field=IntegerField())),
        )

        return Response(stats, status=status.HTTP_200_OK)


class PageFavoriteViewSet(BaseViewSet):
    """Toggle the requesting user's favorite flag on workspace pages.

    Resource managed:
        :class:`plane.db.models.UserFavorite` rows with
        ``entity_type="page"`` and
        ``entity_identifier=<page_id>``. Favorites are user-scoped
        (each user sees only their own favorites) and project-scoped
        (the favorite row carries a ``project_id`` FK).

    HTTP methods + URL patterns:
        POST   /api/workspaces/<slug>/projects/<uuid:project_id>/favorite-pages/<uuid:page_id>/
        DELETE /api/workspaces/<slug>/projects/<uuid:project_id>/favorite-pages/<uuid:page_id>/

    Request body:
        Empty -- the favorite target is identified entirely by URL
        kwargs (``slug``, ``project_id``, ``page_id``) and the
        requesting user.

    Response shape:
        POST: HTTP 204 NO_CONTENT with empty body (non-standard for
            a create response -- preserved per system boundary).
        DELETE: HTTP 204 NO_CONTENT with empty body.

    Permissions:
        Decoration-driven via ``@allow_permission([ROLE.ADMIN,
        ROLE.MEMBER])`` on every method -- this BYPASSES the
        class-level ``permission_classes`` (inherited from
        :class:`BaseViewSet` as ``[IsAuthenticated]``). GUEST role
        is INTENTIONALLY excluded from favorite operations.

    URL kwarg mapping:
        The ``page_id`` URL kwarg maps to
        ``UserFavorite.entity_identifier`` -- NOT to the UserFavorite
        row's own primary key. The destroy filter combines
        ``user=request.user``, ``entity_type="page"``,
        ``entity_identifier=page_id``, ``project=project_id``, and
        ``workspace__slug=slug`` to locate the row.

    Side effects:
        ``destroy`` performs a HARD delete (``soft=False``) so the
        UserFavorite row is fully removed (no soft-delete tombstone).
    """

    model = UserFavorite

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id, page_id):
        """Create a UserFavorite row for the requesting user on this page.

        The row carries ``entity_type="page"`` and
        ``entity_identifier=page_id``. Returns HTTP 204.
        """
        _ = UserFavorite.objects.create(
            project_id=project_id,
            entity_identifier=page_id,
            entity_type="page",
            user=request.user,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, page_id):
        """Hard-delete the requesting user's favorite for this page.

        Uses ``soft=False`` so the UserFavorite row is fully removed
        (no soft-delete tombstone).
        """
        page_favorite = UserFavorite.objects.get(
            project=project_id,
            user=request.user,
            workspace__slug=slug,
            entity_identifier=page_id,
            entity_type="page",
        )
        page_favorite.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PagesDescriptionViewSet(BaseViewSet):
    """Stream the Y.js binary description on GET; accept the live-server callback on PATCH.

    This is the LIVE-SERVER CALLBACK SURFACE for collaborative page
    editing -- ``PATCH /pages/<page_id>/description/`` is the
    destination for every persisted Y.js update broadcast by
    :mod:`apps.live` (tech spec §5.2.1.4, §5.2.5.4).

    Resource managed:
        The ``description_binary`` (BinaryField),
        ``description_html`` (TextField), and ``description_json``
        (JSONField) columns of :class:`plane.db.models.Page`. These
        are mutated only via the PATCH endpoint below;
        ``description_stripped`` is auto-derived from
        ``description_html`` in :meth:`Page.save`.

    HTTP methods + URL patterns:
        GET   /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/description/
            -- streams the Y.js binary state as
            ``Content-Type: application/octet-stream`` with
            ``Content-Disposition: attachment; filename="page_description.bin"``.
        PATCH /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/description/
            -- LIVE-SERVER CALLBACK ENDPOINT.

    Request body (PATCH -- live-server payload):
        description_binary (str, optional): base64-encoded Y.js
            binary state. Decoded and validated by
            :class:`plane.app.serializers.PageBinaryUpdateSerializer.validate_description_binary`
            via ``base64.b64decode`` plus
            :func:`plane.utils.content_validator.validate_binary_data`
            (which checks the buffer is a parseable
            ``Y.encodeStateAsUpdateV2`` payload).
        description_html (str, optional): rendered HTML at the time
            of save -- validated by
            :func:`plane.utils.content_validator.validate_html_content`.
        description_json (JSON, optional): TipTap document JSON.

        All three fields are persisted in a single transaction by
        :class:`PageBinaryUpdateSerializer.save` so the binary, the
        HTML, and the JSON stay coherent.

    Response shape (GET):
        :class:`django.http.StreamingHttpResponse` with
        ``content_type="application/octet-stream"`` and body equal
        to the raw ``description_binary`` bytes (or empty bytes if
        the field is NULL -- the live-server treats empty as the
        cue to trigger HTML→binary backfill).

    Response shape (PATCH):
        Success: HTTP 200 ``{"message": "Updated successfully"}``.
        Locked: HTTP 400
            ``{"error_code": ERROR_CODES["PAGE_LOCKED"] (4701),
            "error_message": "PAGE_LOCKED"}``.
        Archived: HTTP 400
            ``{"error_code": ERROR_CODES["PAGE_ARCHIVED"] (4702),
            "error_message": "PAGE_ARCHIVED"}``.
        Validation failure: HTTP 400 with the serializer's error
            dict (e.g., invalid base64, malformed binary, HTML
            content rejected by the validator).

    Permissions:
        ``permission_classes = [ProjectPagePermission]`` -- declared on
        the class attribute (see
        :file:`apps/api/plane/app/views/page/base.py`). Defined in
        :class:`plane.app.permissions.page.ProjectPagePermission`.
            -- same as :class:`PageViewSet`. The page itself is
            additionally guarded in the view bodies by the
            ``Q(owned_by=user) | Q(access=0)`` filter (public OR
            owned), preventing non-owners from reading or writing
            private page bodies.

    Live-server callback contract (tech spec §5.2.1.4 -- BINDING):
        :mod:`apps.live` HocusPocus extension
        :mod:`apps.live.extensions.database` holds the live Y.Doc
        per page. On a 10-second debounced persistence (tech spec
        §5.2.5.4), it converts the Y.Doc to all three formats via
        :func:`getAllDocumentFormatsFromDocumentEditorBinaryData`
        (from :mod:`@plane.editor`) and PATCHes this endpoint with
        the resulting ``{description_binary, description_html,
        description_json}`` triple.

        HTML→binary backfill: on first live-server load
        (``fetchDocument`` in
        :mod:`apps.live.extensions.database`), if the GET above
        returns empty bytes, the live server converts
        ``description_html`` to a Y.js binary state via
        :func:`getBinaryDataFromDocumentEditorHTMLString` then
        immediately PATCHes back to seed
        ``description_binary``. This is idempotent (one-time per
        page) and preserves the pre-collaboration HTML content as
        the initial Y.Doc state.

        Conflict resolution: Y.js CRDT auto-merge. There is no
        explicit conflict-resolution callback registered -- the
        CRDT's last-writer-wins resolution is structural.

    Edit gates:
        * If ``page.is_locked`` -- PATCH rejects with
          PAGE_LOCKED error (live server treats this as a signal
          to disconnect Y.js clients via force-close).
        * If ``page.archived_at IS NOT NULL`` -- PATCH rejects with
          PAGE_ARCHIVED error.

    Side effects (PATCH -- Celery via RabbitMQ, NOT Redis):
        * On successful save, queues
          ``page_transaction.delay(new_html, old_html, page_id)`` --
          but ONLY when the request supplied ``description_html``
          (this avoids spurious activity entries for binary-only
          updates that race with the HTML render).
        * ALWAYS queues ``track_page_version.delay(page_id,
          existing_instance, user_id)`` where ``existing_instance``
          is a JSON snapshot of the PRE-save ``description_html``;
          this is the canonical write path that produces
          :class:`plane.db.models.PageVersion` rows visible via
          :class:`plane.app.views.page.version.PageVersionEndpoint`.
        * Celery workers (RabbitMQ-backed) execute both tasks
          asynchronously after the HTTP response is returned.

    Cross-references:
        - Permissions: ``plane.app.permissions.ProjectPagePermission``.
        - Serializers: ``plane.app.serializers.PageBinaryUpdateSerializer``.
        - Models: ``plane.db.models.Page``, ``plane.db.models.PageVersion``.
        - Celery tasks (via RabbitMQ):
            ``plane.bgtasks.page_transaction_task.page_transaction``,
            ``plane.bgtasks.page_version_task.track_page_version``.
        - URL registration: ``apps/api/plane/app/urls/page.py``.
        - Cross-system contract: ``apps/live/src/extensions/database.ts``
          (PATCHes this endpoint via the 10s debounced persistence).
    """

    permission_classes = [ProjectPagePermission]

    def retrieve(self, request, slug, project_id, page_id):
        """Stream the page's ``description_binary`` Y.js state to the live server.

        Returns ``application/octet-stream`` with the raw binary
        bytes, or empty bytes when the field is NULL (the live
        server treats empty as the cue to trigger HTML→binary
        backfill). Enforced for Public OR owned pages.
        """
        page = Page.objects.get(
            Q(owned_by=self.request.user) | Q(access=0),
            pk=page_id,
            workspace__slug=slug,
            projects__id=project_id,
            project_pages__deleted_at__isnull=True,
        )
        binary_data = page.description_binary

        def stream_data():
            if binary_data:
                yield binary_data
            else:
                yield b""

        response = StreamingHttpResponse(stream_data(), content_type="application/octet-stream")
        response["Content-Disposition"] = 'attachment; filename="page_description.bin"'
        return response

    def partial_update(self, request, slug, project_id, page_id):
        """LIVE-SERVER CALLBACK: persist a Y.js update for the page.

        Saves ``description_binary``, ``description_html``, and
        ``description_json`` in one transaction then queues
        ``page_transaction`` (only when ``description_html`` was
        provided) and always queues ``track_page_version`` Celery
        tasks. Rejects locked or archived pages with PAGE_LOCKED /
        PAGE_ARCHIVED error codes.
        """
        page = Page.objects.get(
            Q(owned_by=self.request.user) | Q(access=0),
            pk=page_id,
            workspace__slug=slug,
            projects__id=project_id,
            project_pages__deleted_at__isnull=True,
        )

        if page.is_locked:
            return Response(
                {
                    "error_code": ERROR_CODES["PAGE_LOCKED"],
                    "error_message": "PAGE_LOCKED",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if page.archived_at:
            return Response(
                {
                    "error_code": ERROR_CODES["PAGE_ARCHIVED"],
                    "error_message": "PAGE_ARCHIVED",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Store the old description_html before saving (needed for both tasks)
        old_description_html = page.description_html

        # Serialize the existing instance
        existing_instance = json.dumps({"description_html": old_description_html}, cls=DjangoJSONEncoder)

        # Use serializer for validation and update
        serializer = PageBinaryUpdateSerializer(page, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()

            # Capture the page transaction
            if request.data.get("description_html"):
                page_transaction.delay(
                    new_description_html=request.data.get("description_html", "<p></p>"),
                    old_description_html=old_description_html,
                    page_id=page_id,
                )

            # Run background tasks
            track_page_version.delay(
                page_id=page_id,
                existing_instance=existing_instance,
                user_id=request.user.id,
            )
            return Response({"message": "Updated successfully"})
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PageDuplicateEndpoint(BaseAPIView):
    """Clone a page (with its description) and queue S3 asset duplication.

    Resource managed:
        Produces a new :class:`plane.db.models.Page` row by cloning
        the existing page's columns (name suffixed with " (Copy)"),
        reassigns ``owned_by`` / ``created_by`` / ``updated_by`` to
        the requesting user, and recreates
        :class:`plane.db.models.ProjectPage` junction rows for every
        project the source page belongs to. The clone has
        ``description_binary = None`` -- the live server's
        HTML→binary backfill will rebuild it from
        ``description_html`` on first connect.

    HTTP methods + URL patterns:
        POST /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/duplicate/

    Request body:
        Empty -- the source page is identified entirely by URL
        kwargs.

    Response shape:
        HTTP 201 with
        :class:`plane.app.serializers.PageDetailSerializer` output
        of the cloned page (including the new UUID, the suffixed
        ``name``, all project IDs).

    Permissions:
        ``permission_classes = [ProjectPagePermission]`` -- declared on
        the class attribute (see
        :file:`apps/api/plane/app/views/page/base.py`). Defined in
        :class:`plane.app.permissions.page.ProjectPagePermission`.

        Additional gate inside :meth:`post`:
            If the source page has ``access == Page.PRIVATE_ACCESS``
            (1) and the requesting user is NOT the owner, the
            duplicate is rejected with HTTP 403
            ``{"error": "Permission denied"}``.

    Side effects (Celery via RabbitMQ -- NOT Redis):
        * Creates a fresh row in :class:`Page` with a new primary
          key, ``" (Copy)"``-suffixed name, ``description_binary =
          None``, and the requesting user as
          ``owned_by`` / ``created_by`` / ``updated_by``.
        * Recreates :class:`ProjectPage` rows for every project the
          source page belonged to, mapped to the new page's UUID.
        * Queues
          ``page_transaction.delay(new_description_html=page.description_html,
          old_description_html=None, page_id=<new>)`` for activity
          logging.
        * Queues
          ``copy_s3_objects_of_description_and_assets.delay(
          entity_name="PAGE", entity_identifier=<new>, project_id,
          slug, user_id)`` to duplicate the page's S3-stored asset
          uploads (images / files embedded in the description). The
          ``project_id`` argument refers to the LAST project_id from
          the ``for project_id in project_ids:`` loop above (not the
          URL kwarg) -- preserved per the no-refactoring system
          boundary.

    Architectural notes:
        * The ``description_binary = None`` reset is intentional --
          duplicating the binary directly would produce two Y.Docs
          with the same client IDs, breaking the CRDT merge
          guarantee. Forcing HTML→binary backfill gives the clone
          a clean Y.Doc derived from the rendered HTML.
        * S3 asset copy is asynchronous; the response returns
          before the new objects are available, so consumers must
          refresh after a delay to see embedded image previews.

    Cross-references:
        - Permissions: ``plane.app.permissions.ProjectPagePermission``.
        - Serializers: ``plane.app.serializers.PageDetailSerializer``.
        - Models: ``plane.db.models.Page``, ``plane.db.models.ProjectPage``,
          ``plane.db.models.FileAsset``.
        - Celery tasks (via RabbitMQ):
            ``plane.bgtasks.page_transaction_task.page_transaction``,
            ``plane.bgtasks.copy_s3_object.copy_s3_objects_of_description_and_assets``.
        - URL registration: ``apps/api/plane/app/urls/page.py``.
    """

    permission_classes = [ProjectPagePermission]

    def post(self, request, slug, project_id, page_id):
        """Clone the source page and queue activity logging plus S3 asset copy.

        Private pages are restricted to the owner (HTTP 403
        otherwise). Reassigns ownership / audit metadata, recreates
        ProjectPage rows for every project the source page belonged
        to, then queues ``page_transaction`` and
        ``copy_s3_objects_of_description_and_assets`` Celery tasks.
        """
        page = Page.objects.get(
            pk=page_id,
            workspace__slug=slug,
            projects__id=project_id,
            project_pages__deleted_at__isnull=True,
        )

        # check for permission
        if page.access == Page.PRIVATE_ACCESS and page.owned_by_id != request.user.id:
            return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

        # get all the project ids where page is present
        project_ids = ProjectPage.objects.filter(page_id=page_id).values_list("project_id", flat=True)

        page.pk = None
        page.name = f"{page.name} (Copy)"
        page.description_binary = None
        page.owned_by = request.user
        page.created_by = request.user
        page.updated_by = request.user
        page.save()

        for project_id in project_ids:
            ProjectPage.objects.create(
                workspace_id=page.workspace_id,
                project_id=project_id,
                page_id=page.id,
                created_by_id=page.created_by_id,
                updated_by_id=page.updated_by_id,
            )

        page_transaction.delay(
            new_description_html=page.description_html,
            old_description_html=None,
            page_id=page.id,
        )

        # Copy the s3 objects uploaded in the page
        copy_s3_objects_of_description_and_assets.delay(
            entity_name="PAGE",
            entity_identifier=page.id,
            project_id=project_id,
            slug=slug,
            user_id=request.user.id,
        )

        page = (
            Page.objects.filter(pk=page.id)
            .annotate(
                project_ids=Coalesce(
                    ArrayAgg("projects__id", distinct=True, filter=~Q(projects__id=True)),
                    Value([], output_field=ArrayField(UUIDField())),
                )
            )
            .first()
        )
        serializer = PageDetailSerializer(page)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
