# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Read-only page version history HTTP endpoint.

Defines :class:`PageVersionEndpoint`, the DRF ``APIView`` subclass that
exposes the immutable :class:`plane.db.models.PageVersion` snapshots
written by the page-version Celery pipeline. Mounted at:

* ``GET /api/workspaces/<slug>/projects/<project_id>/pages/<page_id>/versions/``
* ``GET /api/workspaces/<slug>/projects/<project_id>/pages/<page_id>/versions/<pk>/``

Versions are NEVER written by direct API calls. They are produced
exclusively by the Celery tasks
:func:`plane.bgtasks.page_version_task.track_page_version` (queued by
:class:`plane.app.views.page.base.PagesDescriptionViewSet` on every
binary description update) and
:func:`plane.bgtasks.page_transaction_task.page_transaction` (queued on
create / partial_update / duplicate). Celery workers consume these tasks
from RabbitMQ; Redis is used for caching and session only.

Live-server callback context (tech spec §5.2.1.4): the
:mod:`apps.live` HocusPocus server holds the live Y.Doc per page and
PATCHes :class:`PagesDescriptionViewSet` on a 10-second debounce (tech
spec §5.2.5.4), which in turn queues ``track_page_version.delay(...)``
to persist a new ``PageVersion`` row -- making this read-only endpoint
the canonical history view of every committed Y.js update.
"""

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.db.models import PageVersion
from ..base import BaseAPIView
from plane.app.serializers import PageVersionSerializer, PageVersionDetailSerializer
from plane.app.permissions import ProjectPagePermission


class PageVersionEndpoint(BaseAPIView):
    """Read-only access to page version snapshots (collaborative-document history).

    Resource managed:
        :class:`plane.db.models.PageVersion` -- immutable per-save
        snapshots of a page's ``description_binary`` (Y.js state),
        ``description_html`` (rendered HTML), ``description_json``
        (TipTap document), and ``description_stripped`` (text-only), plus
        ``last_saved_at``, ``owned_by``, ``workspace``, and ``page`` FKs.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/versions/
            -- list mode (no ``pk`` kwarg): returns ALL versions for the
            page.
        GET /api/workspaces/<slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/versions/<uuid:pk>/
            -- detail mode (``pk`` kwarg provided): returns one version
            with its full binary + HTML + JSON description payload.

    Request body:
        None -- this endpoint is read-only.

    Response shape (list):
        Array of dictionaries serialized by
        :class:`plane.app.serializers.PageVersionSerializer`:
            * ``id`` (UUID), ``workspace`` (UUID), ``page`` (UUID),
            * ``last_saved_at`` (datetime),
            * ``owned_by`` (UUID),
            * ``created_at`` / ``updated_at`` (datetime),
            * ``created_by`` / ``updated_by`` (UUID).
        Notably EXCLUDES ``description_binary`` / ``description_html`` /
        ``description_json`` to keep list payloads small -- binary
        snapshots can be many kilobytes each.

    Response shape (detail):
        Single dictionary serialized by
        :class:`plane.app.serializers.PageVersionDetailSerializer`:
            All list-mode fields PLUS:
            * ``description_binary`` (bytes / base64 in JSON
              transport) -- the Y.js state snapshot.
            * ``description_html`` (str) -- rendered HTML at save time.
            * ``description_json`` (JSONField) -- TipTap document.

    Permissions:
        ``permission_classes = [ProjectPagePermission]`` -- declared on
        the class attribute (see
        :file:`apps/api/plane/app/views/page/version.py`). Defined in
        :class:`plane.app.permissions.page.ProjectPagePermission`. Enforces:
            (1) the requesting user is an active project member,
            (2) for private pages (``Page.access == 1``), the user is
                either the page owner or the workspace admin,
            (3) for public pages, role-based access (ADMIN / MEMBER, and
                GUEST when the project has ``guest_view_all_features``).
        The page_id URL kwarg is what the permission class uses to
        locate the parent page; the version's own ``pk`` is checked
        only for existence in :meth:`get`.

    Side effects (Celery via RabbitMQ -- NOT Redis):
        None -- this endpoint is strictly read-only. It performs no
        writes, no Celery dispatches, no cache invalidation. Version
        rows are mutated only by:
            * :func:`plane.bgtasks.page_version_task.track_page_version`
              -- creates a new ``PageVersion`` row from the page's current
              ``description_binary`` + ``description_html`` +
              ``description_json``.
            * :func:`plane.bgtasks.page_transaction_task.page_transaction`
              -- writes the activity-log delta for each transaction.

        Both tasks are queued via Celery (RabbitMQ) from
        :class:`plane.app.views.page.base.PagesDescriptionViewSet.partial_update`
        and :class:`PageViewSet.create` / ``partial_update`` /
        :class:`PageDuplicateEndpoint`.

    Queryset filter logic (in :meth:`get`):
        ``PageVersion.objects.filter(workspace__slug=slug,
        page_id=page_id)`` -- ordered by the model's default
        ``-created_at`` ordering (see
        :class:`plane.db.models.PageVersion.Meta`). Note: this filter
        does NOT include ``project_id`` because :class:`PageVersion`
        does not have a ``project`` FK -- pages can span multiple
        projects via the :class:`ProjectPage` junction. Project
        scoping is enforced by :class:`ProjectPagePermission`, which
        verifies the page is reachable from the URL's ``project_id``.

    Cross-references:
        - Permissions: ``plane.app.permissions.ProjectPagePermission``.
        - Serializers: ``plane.app.serializers.PageVersionSerializer``,
          ``plane.app.serializers.PageVersionDetailSerializer``.
        - Models: ``plane.db.models.PageVersion``, ``plane.db.models.Page``.
        - Celery tasks (via RabbitMQ): ``plane.bgtasks.page_version_task.track_page_version``
          (writes the rows this endpoint reads).
        - URL registration: ``apps/api/plane/app/urls/page.py``.
    """

    permission_classes = [ProjectPagePermission]

    def get(self, request, slug, project_id, page_id, pk=None):
        """Return a single PageVersion when ``pk`` is supplied, else list all versions for the page.

        Detail mode (``pk`` set) serializes
        :class:`PageVersionDetailSerializer` with the full
        ``description_binary`` + ``description_html`` + ``description_json``
        payload. List mode (``pk`` is ``None``) returns the lighter
        :class:`PageVersionSerializer` representation, which omits the
        binary/HTML/JSON description content for response-size efficiency.
        """
        # Check if pk is provided
        if pk:
            # Return a single page version
            page_version = PageVersion.objects.get(workspace__slug=slug, page_id=page_id, pk=pk)
            # Serialize the page version
            serializer = PageVersionDetailSerializer(page_version)
            return Response(serializer.data, status=status.HTTP_200_OK)
        # Return all page versions
        page_versions = PageVersion.objects.filter(workspace__slug=slug, page_id=page_id)
        # Serialize the page versions
        serializer = PageVersionSerializer(page_versions, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
