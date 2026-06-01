# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Anchor-scoped public ``FileAsset`` endpoints for the ``plane.space`` API.

Defines three :class:`BaseAPIView` subclasses that orchestrate the
presigned-S3 upload + soft-delete + restore + bulk-reassign lifecycle for
file assets attached to issue descriptions and issue comments on
published deploy boards:

* :class:`EntityAssetEndpoint` -- full CRUD with mixed permissions
  (anonymous GET to download, authenticated POST/PATCH/DELETE for upload
  orchestration).
* :class:`AssetRestoreEndpoint` -- authenticated restore of a soft-deleted
  asset (resets ``is_deleted`` + ``deleted_at`` on a row found via
  :class:`FileAsset.all_objects`, which bypasses the soft-delete manager).
* :class:`EntityBulkAssetEndpoint` -- authenticated bulk reassignment of
  ``comment_id`` for ``COMMENT_DESCRIPTION``-type assets associated with
  a given entity (used when comments are reordered or merged).

Mounted under ``api/public/assets/v2/anchor/<str:anchor>/`` (see
``apps/api/plane/space/urls/asset.py``). The upload flow follows the
presigned POST contract documented in tech spec §5.2.9: the client
requests a presigned POST URL from the server, uploads directly to
S3/MinIO, then PATCHes back to set ``is_uploaded=True`` (which also
enqueues :func:`plane.bgtasks.storage_metadata_task.get_asset_object_metadata`
via Celery/RabbitMQ to record object size and content type). Asset
filenames are sanitized via
:func:`plane.utils.path_validator.sanitize_filename` to prevent path
traversal. Background metadata extraction uses Celery via RabbitMQ --
NOT Redis (Redis serves caching/session only).
"""

# Python imports
import uuid

# Django imports
from django.conf import settings
from django.http import HttpResponseRedirect
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from plane.bgtasks.storage_metadata_task import get_asset_object_metadata
from plane.db.models import DeployBoard, FileAsset
from plane.settings.storage import S3Storage
from plane.utils.path_validator import sanitize_filename

# Module imports
from .base import BaseAPIView


class EntityAssetEndpoint(BaseAPIView):
    """CRUD for anchor-scoped issue/comment description :class:`FileAsset` rows.

    HTTP methods and URL patterns:
        GET    ``api/public/assets/v2/anchor/<str:anchor>/<uuid:pk>/``
            (URL name: ``entity-asset``)
            Anonymous-readable: redirects to a time-limited presigned URL
            for the underlying S3/MinIO object.
        POST   ``api/public/assets/v2/anchor/<str:anchor>/``
            (URL name: ``entity-asset``)
            Authenticated: creates a :class:`FileAsset` row and returns a
            presigned POST payload for direct browser -> S3/MinIO upload.
        PATCH  ``api/public/assets/v2/anchor/<str:anchor>/<uuid:pk>/``
            (URL name: ``entity-asset``)
            Authenticated: marks an existing asset ``is_uploaded=True``
            and enqueues the metadata-extraction Celery task.
        DELETE ``api/public/assets/v2/anchor/<str:anchor>/<uuid:pk>/``
            (URL name: ``entity-asset``)
            Authenticated: soft-deletes the asset
            (``is_deleted=True``, ``deleted_at=timezone.now()``).

    Request body (POST):
        name (str, optional, default ``"unnamed"``): client-provided
            file name; passed through
            :func:`plane.utils.path_validator.sanitize_filename` to strip
            path-traversal sequences before being embedded in the S3 key.
        type (str, optional, default ``"image/jpeg"``): MIME type. MUST
            be one of ``image/jpeg``, ``image/png``, ``image/webp``,
            ``image/jpg``, ``image/gif`` -- any other value returns 400.
        size (int, optional, default ``settings.FILE_SIZE_LIMIT``):
            advertised file size in bytes; embedded in presigned POST
            conditions to bound the upload at the storage layer.
        entity_type (str, required): must match a value of
            :class:`FileAsset.EntityTypeContext`; otherwise 400.
        entity_identifier (UUID, optional): denormalized into
            ``comment_id`` on the new :class:`FileAsset` row when the
            asset is a comment description attachment.

    Request body (PATCH):
        attributes (dict, optional): merged into ``FileAsset.attributes``.

    Request body (DELETE):
        None.

    Response shape:
        GET 302 redirect to the S3/MinIO presigned download URL.
        POST 200 OK: ``{"upload_data": {<presigned POST fields>},
        "asset_id": str, "asset_url": str}`` -- the client posts the file
        directly to S3/MinIO using ``upload_data``, then PATCHes this
        endpoint to finalize.
        POST 400 Bad Request: ``{"error": "Invalid entity type.",
        "status": False}`` or ``{"error": "Invalid file type. Only JPEG,
        PNG, WebP, JPG and GIF files are allowed.", "status": False}``.
        POST/PATCH/DELETE 404 Not Found: ``{"error": "Project is not
        published"}`` when the anchor does not resolve to any
        :class:`DeployBoard` row.
        GET 404 Not Found: ``{"error": "Requested resource could not be
        found."}`` when the anchor does not resolve, OR
        ``{"error": "The requested asset could not be found."}`` when
        ``is_uploaded`` is still ``False`` (upload was never finalized).
        PATCH/DELETE 204 No Content on success.

    Permissions:
        :meth:`get_permissions` returns ``[AllowAny]`` for GET (anonymous
        download via presigned URL) and ``[IsAuthenticated]`` for POST,
        PATCH, DELETE (upload orchestration is gated to logged-in users).

    Queryset filter:
        GET fetches :class:`FileAsset` by ``workspace_id`` + ``pk``,
        restricted to ``entity_type IN (ISSUE_DESCRIPTION,
        COMMENT_DESCRIPTION)`` -- this is a SECURITY BOUNDARY: anonymous
        downloads are restricted to description attachments, NOT
        attachments on other entity types (project covers, user avatars,
        etc.).
        DELETE additionally filters by ``project_id`` to scope deletes
        to the project that owns the deploy board.

    Storage integration:
        Uses :class:`plane.settings.storage.S3Storage` for both
        ``generate_presigned_url`` (GET) and ``generate_presigned_post``
        (POST). Object keys are namespaced by ``workspace_id`` to
        prevent cross-workspace key collisions.

    Background tasks:
        PATCH enqueues
        :func:`plane.bgtasks.storage_metadata_task.get_asset_object_metadata`
        via Celery (RabbitMQ broker) whenever the patched asset does not
        already carry ``storage_metadata`` -- this populates the row's
        recorded content-length / content-type from a HEAD against the
        bucket so subsequent reads do not need to re-query S3.
    """

    def get_permissions(self):
        """Return ``[AllowAny]`` for GET (anonymous download), ``[IsAuthenticated]`` otherwise."""
        if self.request.method == "GET":
            permission_classes = [AllowAny]
        else:
            permission_classes = [IsAuthenticated]
        return [permission() for permission in permission_classes]

    def get(self, request, anchor, pk):
        """Redirect to a presigned S3/MinIO URL for the requested description asset.

        Resolves the anchor, then loads the :class:`FileAsset` restricted
        to ``ISSUE_DESCRIPTION`` / ``COMMENT_DESCRIPTION`` entity types
        (anonymous downloads are not permitted for other asset
        categories). Returns 302 to the presigned URL only if
        ``is_uploaded`` is True.
        """
        # Get the deploy board
        deploy_board = DeployBoard.objects.filter(anchor=anchor).first()
        # Check if the project is published
        if not deploy_board:
            return Response(
                {"error": "Requested resource could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # get the asset id
        asset = FileAsset.objects.get(
            workspace_id=deploy_board.workspace_id,
            pk=pk,
            entity_type__in=[
                FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
                FileAsset.EntityTypeContext.COMMENT_DESCRIPTION,
            ],
        )

        # Check if the asset is uploaded
        if not asset.is_uploaded:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        signed_url = storage.generate_presigned_url(object_name=asset.asset.name)
        # Redirect to the signed URL
        return HttpResponseRedirect(signed_url)

    def post(self, request, anchor):
        """Create a :class:`FileAsset` row and return a presigned upload payload.

        Sanitizes the client-provided filename, validates the entity type
        and MIME type allowlist, computes a workspace-scoped S3 key, then
        returns the presigned POST fields the client uses to upload
        directly to S3/MinIO. The client must subsequently PATCH this
        endpoint with the new asset's ``pk`` to finalize the upload.
        """
        # Get the deploy board
        deploy_board = DeployBoard.objects.filter(anchor=anchor).first()
        # Check if the project is published
        if not deploy_board:
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)

        # Get the asset
        name = sanitize_filename(request.data.get("name")) or "unnamed"
        type = request.data.get("type", "image/jpeg")
        size = int(request.data.get("size", settings.FILE_SIZE_LIMIT))
        entity_type = request.data.get("entity_type", "")
        entity_identifier = request.data.get("entity_identifier")

        # Check if the entity type is allowed
        if entity_type not in FileAsset.EntityTypeContext.values:
            return Response(
                {"error": "Invalid entity type.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if the file type is allowed
        allowed_types = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/jpg",
            "image/gif",
        ]
        if type not in allowed_types:
            return Response(
                {
                    "error": "Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.",
                    "status": False,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # asset key
        asset_key = f"{deploy_board.workspace_id}/{uuid.uuid4().hex}-{name}"

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size},
            asset=asset_key,
            size=size,
            workspace=deploy_board.workspace,
            created_by=request.user,
            entity_type=entity_type,
            project_id=deploy_board.project_id,
            comment_id=entity_identifier,
        )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        presigned_url = storage.generate_presigned_post(object_name=asset_key, file_type=type, file_size=size)
        # Return the presigned URL
        return Response(
            {
                "upload_data": presigned_url,
                "asset_id": str(asset.id),
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    def patch(self, request, anchor, pk):
        """Finalize an upload by setting ``is_uploaded=True`` and enqueueing metadata extraction.

        When the row does not already carry ``storage_metadata``, enqueues
        :func:`plane.bgtasks.storage_metadata_task.get_asset_object_metadata`
        via Celery (RabbitMQ broker) to backfill the recorded
        content-length / content-type via a HEAD against the bucket.
        """
        # Get the deploy board
        deploy_board = DeployBoard.objects.filter(anchor=anchor).first()
        # Check if the project is published
        if not deploy_board:
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)

        # get the asset id
        asset = FileAsset.objects.get(id=pk, workspace=deploy_board.workspace)
        # get the storage metadata
        asset.is_uploaded = True
        # get the storage metadata
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(str(asset.id))

        # update the attributes
        asset.attributes = request.data.get("attributes", asset.attributes)
        # save the asset
        asset.save(update_fields=["attributes", "is_uploaded"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def delete(self, request, anchor, pk):
        """Soft-delete a :class:`FileAsset` (sets ``is_deleted=True``, ``deleted_at=now``)."""
        # Get the deploy board
        deploy_board = DeployBoard.objects.filter(anchor=anchor, entity_name="project").first()
        # Check if the project is published
        if not deploy_board:
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)
        # Get the asset
        asset = FileAsset.objects.get(id=pk, workspace=deploy_board.workspace, project_id=deploy_board.project_id)
        # Check deleted assets
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        # Save the asset
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class AssetRestoreEndpoint(BaseAPIView):
    """Restore a soft-deleted :class:`FileAsset` for a published deploy-board.

    HTTP methods and URL patterns:
        POST ``api/public/assets/v2/anchor/<str:anchor>/restore/<uuid:pk>/``
            (URL name: ``asset-restore``)

    Request body:
        None -- restoration is an idempotent ``is_deleted=False`` /
        ``deleted_at=None`` write on the targeted row.

    Response shape:
        204 No Content on success.
        404 Not Found: ``{"error": "Project is not published"}`` when the
        anchor does not resolve to a project-entity deploy board.
        :class:`FileAsset.DoesNotExist` from the
        :class:`FileAsset.all_objects` ``.get(...)`` call propagates to
        :meth:`BaseAPIView.handle_exception` and returns 404
        ``{"error": "The required object does not exist."}``.

    Permissions:
        Inherits ``BaseAPIView.permission_classes = [IsAuthenticated]``
        -- only authenticated users may restore deleted assets.

    Queryset filter:
        Uses :class:`FileAsset.all_objects` -- the soft-delete-bypassing
        manager declared on the soft-delete mixin in
        ``apps/api/plane/db/mixins.py`` -- to fetch the row by ``id`` +
        ``workspace`` and reset ``is_deleted=False`` / ``deleted_at=None``.
        The default :class:`FileAsset.objects` manager would exclude
        soft-deleted rows and so cannot be used here.
    """

    def post(self, request, anchor, pk):
        """Restore a soft-deleted :class:`FileAsset` (resets ``is_deleted`` / ``deleted_at``).

        Uses :class:`FileAsset.all_objects` (the soft-delete-bypassing
        manager) so that previously soft-deleted rows remain reachable
        for restoration.
        """
        # Get the deploy board
        deploy_board = DeployBoard.objects.filter(anchor=anchor, entity_name="project").first()
        # Check if the project is published
        if not deploy_board:
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)

        # Get the asset
        asset = FileAsset.all_objects.get(id=pk, workspace=deploy_board.workspace)
        asset.is_deleted = False
        asset.deleted_at = None
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class EntityBulkAssetEndpoint(BaseAPIView):
    """Bulk reassign ``comment_id`` for an entity's ``COMMENT_DESCRIPTION`` assets.

    HTTP methods and URL patterns:
        POST ``api/public/assets/v2/anchor/<str:anchor>/<uuid:entity_id>/bulk/``
            (URL name: ``entity-bulk-asset``)

    Request body:
        asset_ids (list[UUID], required): list of :class:`FileAsset` IDs
            to reassign. An empty list returns 400.

    Response shape:
        204 No Content on success.
        400 Bad Request: ``{"error": "No asset ids provided."}`` when
        ``asset_ids`` is empty/missing.
        404 Not Found: ``{"error": "Project is not published"}`` when the
        anchor does not resolve, OR ``{"error": "The requested asset
        could not be found."}`` when none of the listed asset IDs match
        the workspace / project scope of the deploy board.

    Permissions:
        Inherits ``BaseAPIView.permission_classes = [IsAuthenticated]``.

    Queryset filter:
        Resolves the deploy board (anchor + ``entity_name="project"``),
        then loads :class:`FileAsset` rows by ``id__in=asset_ids`` scoped
        to the board's workspace and project. The update step
        (``assets.update(comment_id=entity_id)``) is GATED on
        ``asset.entity_type == COMMENT_DESCRIPTION`` (checked against the
        first row of the queryset) -- assets of other entity types are
        silently ignored.

    Side effects:
        Single SQL UPDATE statement that rewrites ``comment_id`` for all
        matched ``COMMENT_DESCRIPTION``-type rows. Used by the client
        when a comment is reordered or merged and its attached file
        assets need to move with it.
    """

    def post(self, request, anchor, entity_id):
        """Reassign ``comment_id=entity_id`` across all ``COMMENT_DESCRIPTION`` assets in ``asset_ids``."""
        # Get the deploy board
        deploy_board = DeployBoard.objects.filter(anchor=anchor, entity_name="project").first()
        # Check if the project is published
        if not deploy_board:
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)

        asset_ids = request.data.get("asset_ids", [])

        # Check if the asset ids are provided
        if not asset_ids:
            return Response({"error": "No asset ids provided."}, status=status.HTTP_400_BAD_REQUEST)

        # get the asset id
        assets = FileAsset.objects.filter(
            id__in=asset_ids,
            workspace=deploy_board.workspace,
            project_id=deploy_board.project_id,
        )

        asset = assets.first()

        # Check if the asset is uploaded
        if not asset:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Check if the entity type is allowed
        if asset.entity_type == FileAsset.EntityTypeContext.COMMENT_DESCRIPTION:
            # update the attributes
            assets.update(comment_id=entity_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
