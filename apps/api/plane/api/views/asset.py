# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""File-asset upload endpoints for the external ``/api/v1/`` API.

These endpoints implement an S3 presigned-PUT upload flow:

    1. ``POST`` returns ``{asset_id, asset_url, upload_data}`` so the
       client can PUT the bytes directly to object storage.
    2. ``PATCH`` marks the upload as complete and enqueues
       ``get_asset_object_metadata`` (Celery+RabbitMQ) to backfill mime
       type and size from S3.
    3. ``DELETE`` soft-deletes by setting ``is_deleted=True``; the actual
       S3 object is reaped by the ``file_asset`` Celery beat job at
       02:00 UTC.

Authentication is via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``).
"""

# Python Imports
import uuid

# Django Imports
from django.utils import timezone
from django.conf import settings

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiExample, OpenApiRequest

# Module Imports
from plane.bgtasks.storage_metadata_task import get_asset_object_metadata
from plane.settings.storage import S3Storage
from plane.utils.path_validator import sanitize_filename
from plane.db.models import FileAsset, User, Workspace
from plane.api.views.base import BaseAPIView
from plane.api.serializers import (
    UserAssetUploadSerializer,
    AssetUpdateSerializer,
    GenericAssetUploadSerializer,
    GenericAssetUpdateSerializer,
)
from plane.utils.openapi import (
    ASSET_ID_PARAMETER,
    WORKSPACE_SLUG_PARAMETER,
    PRESIGNED_URL_SUCCESS_RESPONSE,
    GENERIC_ASSET_UPLOAD_SUCCESS_RESPONSE,
    GENERIC_ASSET_VALIDATION_ERROR_RESPONSE,
    ASSET_CONFLICT_RESPONSE,
    ASSET_DOWNLOAD_SUCCESS_RESPONSE,
    ASSET_DOWNLOAD_ERROR_RESPONSE,
    ASSET_UPDATED_RESPONSE,
    ASSET_DELETED_RESPONSE,
    VALIDATION_ERROR_RESPONSE,
    ASSET_NOT_FOUND_RESPONSE,
    NOT_FOUND_RESPONSE,
    UNAUTHORIZED_RESPONSE,
    asset_docs,
)
from plane.utils.exception_logger import log_exception


class UserAssetEndpoint(BaseAPIView):
    """Upload, finalize, and remove the requesting user's profile assets.

    Used for user avatar and cover images.

    HTTP methods + URL patterns (registered in
    ``apps/api/plane/api/urls/asset.py``):
        POST    /api/v1/assets/user-assets/
                    (name ``user-assets``)
        PATCH   /api/v1/assets/user-assets/<uuid:asset_id>/
                    (name ``user-assets-detail``)
        DELETE  /api/v1/assets/user-assets/<uuid:asset_id>/
                    (name ``user-assets-detail``)

    Request body (POST):
        name        (str, required) -- Original filename.
        type        (str, required) -- MIME type; must appear in
            ``settings.ATTACHMENT_MIME_TYPES``.
        size        (int, required) -- File size in bytes; must be
            ``<= settings.FILE_SIZE_LIMIT``.
        entity_type (str, required) -- One of ``USER_AVATAR`` or
            ``USER_COVER`` from ``FileAsset.EntityTypeContext``.

    Request body (PATCH):
        is_uploaded (bool, required) -- Confirms the client has finished
            the S3 PUT.

    Response shape:
        - POST: ``{asset_id, asset_url, upload_data: {url, fields}}``
          where ``upload_data`` is the presigned POST payload produced
          by ``S3Storage.generate_presigned_post``.
        - PATCH: HTTP 204 with empty body.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``IsAuthenticated`` -- the user is implicit from the API key's
        owning user, so no workspace check is needed.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects:
        - POST: writes ``FileAsset`` row with ``is_uploaded=False``;
          generates an S3 presigned PUT URL.
        - PATCH: sets ``is_uploaded=True``; enqueues
          ``get_asset_object_metadata`` via Celery+RabbitMQ to backfill
          metadata from S3; updates the matching ``User.avatar_asset``
          or ``User.cover_asset`` pointer.
        - DELETE: soft-deletes via ``is_deleted=True`` +
          ``deleted_at=timezone.now()``. The S3 object is reaped by the
          ``file_asset`` Celery beat schedule (see
          ``apps/api/plane/bgtasks/file_asset_task.py``).
    """

    def asset_delete(self, asset_id):
        """Soft-delete a ``FileAsset`` row by primary key (no-op if missing)."""
        asset = FileAsset.objects.filter(id=asset_id).first()
        if asset is None:
            return
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return

    def entity_asset_delete(self, entity_type, asset, request):
        """Clear the ``User`` pointer that references the deleted avatar or cover asset."""
        # User Avatar
        if entity_type == FileAsset.EntityTypeContext.USER_AVATAR:
            user = User.objects.get(id=asset.user_id)
            user.avatar_asset_id = None
            user.save()
            return
        # User Cover
        if entity_type == FileAsset.EntityTypeContext.USER_COVER:
            user = User.objects.get(id=asset.user_id)
            user.cover_image_asset_id = None
            user.save()
            return
        return

    @asset_docs(
        operation_id="create_user_asset_upload",
        summary="Generate presigned URL for user asset upload",
        description="Generate presigned URL for user asset upload",
        request=OpenApiRequest(
            request=UserAssetUploadSerializer,
            examples=[
                OpenApiExample(
                    "User Avatar Upload",
                    value={
                        "name": "profile.jpg",
                        "type": "image/jpeg",
                        "size": 1024000,
                        "entity_type": "USER_AVATAR",
                    },
                    description="Example request for uploading a user avatar",
                ),
                OpenApiExample(
                    "User Cover Upload",
                    value={
                        "name": "cover.jpg",
                        "type": "image/jpeg",
                        "size": 1024000,
                        "entity_type": "USER_COVER",
                    },
                    description="Example request for uploading a user cover",
                ),
            ],
        ),
        responses={
            200: PRESIGNED_URL_SUCCESS_RESPONSE,
            400: VALIDATION_ERROR_RESPONSE,
            401: UNAUTHORIZED_RESPONSE,
        },
    )
    def post(self, request):
        """Generate a presigned PUT URL and return a fresh ``FileAsset`` id."""
        # get the asset key
        name = sanitize_filename(request.data.get("name")) or "unnamed"
        type = request.data.get("type", "image/jpeg")
        size = int(request.data.get("size", settings.FILE_SIZE_LIMIT))
        entity_type = request.data.get("entity_type", False)

        # Check if the file size is within the limit
        size_limit = min(size, settings.FILE_SIZE_LIMIT)

        #  Check if the entity type is allowed
        if not entity_type or entity_type not in ["USER_AVATAR", "USER_COVER"]:
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
                    "error": "Invalid file type. Only JPEG and PNG files are allowed.",
                    "status": False,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # asset key
        asset_key = f"{uuid.uuid4().hex}-{name}"

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            user=request.user,
            created_by=request.user,
            entity_type=entity_type,
        )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        presigned_url = storage.generate_presigned_post(object_name=asset_key, file_type=type, file_size=size_limit)
        # Return the presigned URL
        return Response(
            {
                "upload_data": presigned_url,
                "asset_id": str(asset.id),
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    @asset_docs(
        operation_id="update_user_asset",
        summary="Mark user asset as uploaded",
        description="Mark user asset as uploaded",
        parameters=[ASSET_ID_PARAMETER],
        request=OpenApiRequest(
            request=AssetUpdateSerializer,
            examples=[
                OpenApiExample(
                    "Update Asset Attributes",
                    value={
                        "attributes": {
                            "name": "updated_profile.jpg",
                            "type": "image/jpeg",
                            "size": 1024000,
                        },
                        "entity_type": "USER_AVATAR",
                    },
                    description="Example request for updating asset attributes",
                ),
            ],
        ),
        responses={
            204: ASSET_UPDATED_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    )
    def patch(self, request, asset_id):
        """Mark the upload as complete and enqueue metadata backfill via Celery."""
        # get the asset id
        asset = FileAsset.objects.get(id=asset_id, user_id=request.user.id)
        # get the storage metadata
        asset.is_uploaded = True
        # get the storage metadata
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(asset_id=str(asset_id))
        # update the attributes
        asset.attributes = request.data.get("attributes", asset.attributes)
        # save the asset
        asset.save(update_fields=["is_uploaded", "attributes"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @asset_docs(
        operation_id="delete_user_asset",
        summary="Delete user asset",
        parameters=[ASSET_ID_PARAMETER],
        responses={
            204: ASSET_DELETED_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    )
    def delete(self, request, asset_id):
        """Soft-delete the asset row; the S3 object is reaped by Celery beat."""
        asset = FileAsset.objects.get(id=asset_id, user_id=request.user.id)
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        # get the entity and save the asset id for the request field
        self.entity_asset_delete(entity_type=asset.entity_type, asset=asset, request=request)
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserServerAssetEndpoint(BaseAPIView):
    """Server-side variant of the user profile asset endpoint.

    Identical contract to ``UserAssetEndpoint`` (POST/PATCH/DELETE on
    ``FileAsset`` rows for user avatars and covers) but mounted at the
    ``user-assets/server`` path. Intended for trusted server-to-server
    integrations where the calling system performs the S3 upload on
    behalf of a user.

    HTTP methods + URL patterns (registered in
    ``apps/api/plane/api/urls/asset.py``):
        POST    /api/v1/assets/user-assets/server/
                    (name ``user-server-assets``)
        PATCH   /api/v1/assets/user-assets/<uuid:asset_id>/server/
                    (name ``user-server-assets-detail``)
        DELETE  /api/v1/assets/user-assets/<uuid:asset_id>/server/
                    (name ``user-server-assets-detail``)

    Request and response shape:
        Same as ``UserAssetEndpoint``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``). The API token is typically a service token
        (``is_service=True``) so the higher ``ServiceTokenRateThrottle``
        (300/minute) applies.
    Permissions:
        ``IsAuthenticated``.

    Side effects:
        Identical to ``UserAssetEndpoint``.
    """

    def asset_delete(self, asset_id):
        """Soft-delete a ``FileAsset`` row by primary key (no-op if missing)."""
        asset = FileAsset.objects.filter(id=asset_id).first()
        if asset is None:
            return
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return

    def entity_asset_delete(self, entity_type, asset, request):
        """Clear the ``User`` pointer that references the deleted avatar or cover asset."""
        # User Avatar
        if entity_type == FileAsset.EntityTypeContext.USER_AVATAR:
            user = User.objects.get(id=asset.user_id)
            user.avatar_asset_id = None
            user.save()
            return
        # User Cover
        if entity_type == FileAsset.EntityTypeContext.USER_COVER:
            user = User.objects.get(id=asset.user_id)
            user.cover_image_asset_id = None
            user.save()
            return
        return

    @asset_docs(
        operation_id="create_user_server_asset_upload",
        summary="Generate presigned URL for user server asset upload",
        request=UserAssetUploadSerializer,
        responses={
            200: PRESIGNED_URL_SUCCESS_RESPONSE,
            400: VALIDATION_ERROR_RESPONSE,
        },
    )
    def post(self, request):
        """Generate a presigned PUT URL for server-driven user asset upload."""
        # get the asset key
        name = sanitize_filename(request.data.get("name")) or "unnamed"
        type = request.data.get("type", "image/jpeg")
        size = int(request.data.get("size", settings.FILE_SIZE_LIMIT))
        entity_type = request.data.get("entity_type", False)

        # Check if the file size is within the limit
        size_limit = min(size, settings.FILE_SIZE_LIMIT)

        #  Check if the entity type is allowed
        if not entity_type or entity_type not in ["USER_AVATAR", "USER_COVER"]:
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
                    "error": "Invalid file type. Only JPEG and PNG files are allowed.",
                    "status": False,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # asset key
        asset_key = f"{uuid.uuid4().hex}-{name}"

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            user=request.user,
            created_by=request.user,
            entity_type=entity_type,
        )

        # Get the presigned URL
        storage = S3Storage(request=request, is_server=True)
        # Generate a presigned URL to share an S3 object
        presigned_url = storage.generate_presigned_post(object_name=asset_key, file_type=type, file_size=size_limit)
        # Return the presigned URL
        return Response(
            {
                "upload_data": presigned_url,
                "asset_id": str(asset.id),
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    @asset_docs(
        operation_id="update_user_server_asset",
        summary="Mark user server asset as uploaded",
        parameters=[ASSET_ID_PARAMETER],
        request=AssetUpdateSerializer,
        responses={
            204: ASSET_UPDATED_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    )
    def patch(self, request, asset_id):
        """Mark a server-driven user asset upload as complete and backfill metadata."""
        # get the asset id
        asset = FileAsset.objects.get(id=asset_id, user_id=request.user.id)
        # get the storage metadata
        asset.is_uploaded = True
        # get the storage metadata
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(asset_id=str(asset_id))
        # update the attributes
        asset.attributes = request.data.get("attributes", asset.attributes)
        # save the asset
        asset.save(update_fields=["is_uploaded", "attributes"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @asset_docs(
        operation_id="delete_user_server_asset",
        summary="Delete user server asset",
        parameters=[ASSET_ID_PARAMETER],
        responses={
            204: ASSET_DELETED_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    )
    def delete(self, request, asset_id):
        """Soft-delete a server-driven user asset row."""
        asset = FileAsset.objects.get(id=asset_id, user_id=request.user.id)
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        # get the entity and save the asset id for the request field
        self.entity_asset_delete(entity_type=asset.entity_type, asset=asset, request=request)
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class GenericAssetEndpoint(BaseAPIView):
    """Upload-presign, fetch-presign, and finalize workspace-scoped generic assets.

    These assets can later be bound to project entities such as issue
    attachments, page descriptions, comment descriptions, project covers,
    or workspace logos. The binding itself is performed by the
    target-entity's endpoint; this endpoint only manages the underlying
    ``FileAsset`` row and its S3 lifecycle.

    HTTP methods + URL patterns (registered in
    ``apps/api/plane/api/urls/asset.py``):
        POST    /api/v1/workspaces/<slug>/assets/
                    (name ``generic-asset``)
        GET     /api/v1/workspaces/<slug>/assets/<uuid:asset_id>/
                    (name ``generic-asset-detail``)
        PATCH   /api/v1/workspaces/<slug>/assets/<uuid:asset_id>/
                    (name ``generic-asset-detail``)

    Note:
        The URL configuration registers only POST on the collection and
        GET / PATCH on the detail route. DELETE is NOT registered for
        this endpoint; soft-deletion of workspace-scoped assets is
        handled by the binding entity's own endpoint.

    Request body (POST):
        name        (str, required) -- Original filename.
        type        (str, required) -- MIME type; must appear in
            ``settings.ATTACHMENT_MIME_TYPES``.
        size        (int, required) -- File size in bytes; must be
            ``<= settings.FILE_SIZE_LIMIT`` (or an entity-type-specific
            limit).
        entity_type (str, required) -- One of the values in
            ``FileAsset.EntityTypeContext`` (e.g. ``ISSUE_ATTACHMENT``,
            ``PAGE_DESCRIPTION``, ``COMMENT_DESCRIPTION``,
            ``PROJECT_COVER``, ``WORKSPACE_LOGO``).
        entity_identifier (uuid, optional) -- Target entity pk; only
            required for entity types that pre-bind on upload (most are
            bound on PATCH).

    Request body (PATCH):
        is_uploaded (bool, required) -- Confirms the client has finished
            the S3 PUT.

    Response shape:
        - POST: ``{asset_id, asset_url, upload_data: {url, fields}}``
          where ``upload_data`` is the presigned POST payload.
        - GET: HTTP 302 redirect to the S3 presigned GET URL so the
          client downloads the object directly from S3.
        - PATCH: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``IsAuthenticated`` plus a workspace-membership check (the
        ``slug`` workspace must be accessible to the requesting user).
        Per-entity write permission is enforced by the entity's binding
        endpoint, not here.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects:
        - POST: writes ``FileAsset`` row with ``is_uploaded=False``;
          generates an S3 presigned PUT URL.
        - GET: read-only -- issues a fresh S3 presigned GET URL for the
          underlying object and 302-redirects the client to it.
        - PATCH: sets ``is_uploaded=True``; enqueues
          ``get_asset_object_metadata`` via Celery+RabbitMQ to backfill
          metadata from S3.
    """

    use_read_replica = True

    @asset_docs(
        operation_id="get_generic_asset",
        summary="Get presigned URL for asset download",
        description="Get presigned URL for asset download",
        parameters=[WORKSPACE_SLUG_PARAMETER],
        responses={
            200: ASSET_DOWNLOAD_SUCCESS_RESPONSE,
            400: ASSET_DOWNLOAD_ERROR_RESPONSE,
            404: ASSET_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, asset_id):
        """Get presigned URL for asset download.

        Generate a presigned URL for downloading a generic asset.
        The asset must be uploaded and associated with the specified workspace.
        """
        try:
            # Get the workspace
            workspace = Workspace.objects.get(slug=slug)

            # Get the asset
            asset = FileAsset.objects.get(id=asset_id, workspace_id=workspace.id, is_deleted=False)

            # Check if the asset exists and is uploaded
            if not asset.is_uploaded:
                return Response(
                    {"error": "Asset not yet uploaded"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Generate presigned URL for GET
            storage = S3Storage(request=request, is_server=True)
            presigned_url = storage.generate_presigned_url(
                object_name=asset.asset.name, filename=asset.attributes.get("name")
            )

            return Response(
                {
                    "asset_id": str(asset.id),
                    "asset_url": presigned_url,
                    "asset_name": asset.attributes.get("name", ""),
                    "asset_type": asset.attributes.get("type", ""),
                },
                status=status.HTTP_200_OK,
            )

        except Workspace.DoesNotExist:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        except FileAsset.DoesNotExist:
            return Response({"error": "Asset not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            log_exception(e)
            return Response(
                {"error": "Internal server error"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @asset_docs(
        operation_id="create_generic_asset_upload",
        summary="Generate presigned URL for generic asset upload",
        description="Generate presigned URL for generic asset upload",
        parameters=[WORKSPACE_SLUG_PARAMETER],
        request=OpenApiRequest(
            request=GenericAssetUploadSerializer,
            examples=[
                OpenApiExample(
                    "GenericAssetUploadSerializer",
                    value={
                        "name": "image.jpg",
                        "type": "image/jpeg",
                        "size": 1024000,
                        "project_id": "123e4567-e89b-12d3-a456-426614174000",
                        "external_id": "1234567890",
                        "external_source": "github",
                    },
                    description="Example request for uploading a generic asset",
                ),
            ],
        ),
        responses={
            200: GENERIC_ASSET_UPLOAD_SUCCESS_RESPONSE,
            400: GENERIC_ASSET_VALIDATION_ERROR_RESPONSE,
            404: NOT_FOUND_RESPONSE,
            409: ASSET_CONFLICT_RESPONSE,
        },
    )
    def post(self, request, slug):
        """Validate MIME type/size and return a presigned PUT URL for a new ``FileAsset``.

        Validates ``type`` against ``settings.ATTACHMENT_MIME_TYPES`` and
        ``size`` against ``settings.FILE_SIZE_LIMIT`` (or the
        ``entity_type``-specific limit). Rejects with ``400 Bad Request``
        on validation failure.
        """
        name = sanitize_filename(request.data.get("name"))
        type = request.data.get("type")
        size = int(request.data.get("size", settings.FILE_SIZE_LIMIT))
        project_id = request.data.get("project_id")
        external_id = request.data.get("external_id")
        external_source = request.data.get("external_source")

        # Check if the request is valid
        if not name or not size:
            return Response(
                {"error": "Name and size are required fields.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if the file size is within the limit
        size_limit = min(size, settings.FILE_SIZE_LIMIT)

        # Check if the file type is allowed
        if not type or type not in settings.ATTACHMENT_MIME_TYPES:
            return Response(
                {"error": "Invalid file type.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the workspace
        workspace = Workspace.objects.get(slug=slug)

        # asset key
        asset_key = f"{workspace.id}/{uuid.uuid4().hex}-{name}"

        # Check for existing asset with same external details if provided
        if external_id and external_source:
            existing_asset = FileAsset.objects.filter(
                workspace__slug=slug,
                external_source=external_source,
                external_id=external_id,
                is_deleted=False,
            ).first()

            if existing_asset:
                return Response(
                    {
                        "message": "Asset with same external id and source already exists",
                        "asset_id": str(existing_asset.id),
                        "asset_url": existing_asset.asset_url,
                    },
                    status=status.HTTP_409_CONFLICT,
                )

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            workspace_id=workspace.id,
            project_id=project_id,
            created_by=request.user,
            external_id=external_id,
            external_source=external_source,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,  # Using ISSUE_ATTACHMENT since we'll bind it to issues # noqa: E501
        )

        # Get the presigned URL
        storage = S3Storage(request=request, is_server=True)
        presigned_url = storage.generate_presigned_post(object_name=asset_key, file_type=type, file_size=size_limit)

        return Response(
            {
                "upload_data": presigned_url,
                "asset_id": str(asset.id),
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    @asset_docs(
        operation_id="update_generic_asset",
        summary="Update generic asset after upload completion",
        description="Update generic asset after upload completion",
        parameters=[WORKSPACE_SLUG_PARAMETER, ASSET_ID_PARAMETER],
        request=OpenApiRequest(
            request=GenericAssetUpdateSerializer,
            examples=[
                OpenApiExample(
                    "GenericAssetUpdateSerializer",
                    value={"is_uploaded": True},
                    description="Example request for updating a generic asset",
                )
            ],
        ),
        responses={
            204: ASSET_UPDATED_RESPONSE,
            404: ASSET_NOT_FOUND_RESPONSE,
        },
    )
    def patch(self, request, slug, asset_id):
        """Mark the upload as complete and enqueue metadata backfill.

        Sets ``is_uploaded=True`` and dispatches
        ``get_asset_object_metadata`` via Celery+RabbitMQ to read the
        canonical size and MIME type from S3 head metadata.
        """
        try:
            asset = FileAsset.objects.get(id=asset_id, workspace__slug=slug, is_deleted=False)

            # Update is_uploaded status
            asset.is_uploaded = request.data.get("is_uploaded", asset.is_uploaded)

            # Update storage metadata if not present
            if not asset.storage_metadata:
                get_asset_object_metadata.delay(asset_id=str(asset_id))

            asset.save(update_fields=["is_uploaded"])

            return Response(status=status.HTTP_204_NO_CONTENT)
        except FileAsset.DoesNotExist:
            return Response({"error": "Asset not found"}, status=status.HTTP_404_NOT_FOUND)
