# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""V2 presigned-POST asset endpoints for direct S3/MinIO uploads.

Implements the three-step browser-direct upload protocol so file bytes never
flow through the Plane API server:

    1. Initiate (``POST``): client submits ``{name, size, type, entity_type,
       entity_identifier}``. The server validates ``entity_type`` against
       :class:`FileAsset.EntityTypeContext`, validates the MIME against the
       image allowlist (``image/jpeg``, ``image/png``, ``image/webp``,
       ``image/jpg``, ``image/gif``), clamps ``size`` to
       ``settings.FILE_SIZE_LIMIT``, creates a :class:`FileAsset` row with
       ``is_uploaded=False``, and returns ``{"upload_data": <presigned POST
       fields and conditions>, "asset_id": UUID, "asset_url": str}``.
    2. Direct S3 upload: the client posts the bytes directly to S3/MinIO
       using the returned presigned POST form. The API server never proxies
       file bytes.
    3. Confirm (``PATCH``): the client flips ``is_uploaded=True``, which
       triggers ``entity_asset_save`` to bind the asset to its parent
       entity (``User.avatar_asset_id``, ``Workspace.logo_asset_id``,
       ``Project.cover_image_asset_id``, ``Issue.assets``, etc.) and
       enqueues ``get_asset_object_metadata.delay(asset_id=...)`` (Celery
       via RabbitMQ — *not* Redis; Redis is caching/session only) to
       populate ``storage_metadata`` from S3.

Soft-delete model: ``DELETE`` sets ``is_deleted=True`` and
``deleted_at=timezone.now()`` so historic references remain resolvable;
physical S3 object cleanup is driven by the daily Celery Beat task at
``02:00 UTC`` in ``plane/bgtasks/file_asset_task.py``.

See tech spec §5.2.9 (PRESIGNED POST UPLOAD CONTRACT) and AAP §4.4 (FILE
UPLOAD WORKFLOW) for the end-to-end sequence diagram and the conflict
resolution semantics (last-writer-wins on entity-binding ``PATCH``).
"""

# Python imports
import uuid

# Django imports
from django.conf import settings
from django.http import HttpResponseRedirect
from django.utils import timezone
from django.db import IntegrityError

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from rest_framework.permissions import AllowAny

# Module imports
from ..base import BaseAPIView
from plane.db.models import FileAsset, Workspace, Project, User, WorkspaceMember
from plane.settings.storage import S3Storage
from plane.app.permissions import allow_permission, ROLE
from plane.utils.cache import invalidate_cache_directly
from plane.utils.path_validator import sanitize_filename
from plane.bgtasks.storage_metadata_task import get_asset_object_metadata
from plane.throttles.asset import AssetRateThrottle


class UserAssetsV2Endpoint(BaseAPIView):
    """Manage authenticated user's own avatar and cover image presigned uploads.

    Resource:
        :class:`plane.db.models.FileAsset` rows scoped to the request user
        (``user_id=request.user.id``) and restricted to entity types
        ``USER_AVATAR`` and ``USER_COVER`` (stricter than the workspace
        variant which accepts every :class:`FileAsset.EntityTypeContext`).

    HTTP methods and URL patterns (from ``plane/app/urls/asset.py``):
        ``POST   assets/v2/user-assets/``                  (name ``user-file-assets``)
        ``PATCH  assets/v2/user-assets/<uuid:asset_id>/``  (name ``user-file-assets``)
        ``DELETE assets/v2/user-assets/<uuid:asset_id>/``  (name ``user-file-assets``)

    Request body (``POST``):
        ``name`` (str, optional): client filename, sanitized via
            :func:`sanitize_filename`; defaults to ``"unnamed"``.
        ``type`` (str, optional): MIME type; defaults to ``"image/jpeg"``;
            must be one of ``image/jpeg``, ``image/png``, ``image/webp``,
            ``image/jpg``, ``image/gif``.
        ``size`` (int bytes, optional): clamped to
            ``settings.FILE_SIZE_LIMIT`` (5 MiB default); defaults to that
            limit when omitted.
        ``entity_type`` (str, required): must be exactly ``"USER_AVATAR"``
            or ``"USER_COVER"``; any other value returns HTTP 400.

    Response shape:
        ``POST``: HTTP 200 with
        ``{"upload_data": <S3 presigned POST fields/conditions>,
        "asset_id": <UUID>, "asset_url": <str>}``.
        ``PATCH``/``DELETE``: HTTP 204 No Content.

    Permission:
        Inherits ``permission_classes = [IsAuthenticated]`` from
        :class:`BaseAPIView`; per-asset ownership is enforced by the
        queryset filter ``FileAsset.objects.get(id=asset_id,
        user_id=request.user.id)``, so users can only mutate their own
        rows.

    Side effects:
        ``POST``: creates a :class:`FileAsset` row with ``user=request.user``
        and ``is_uploaded=False``; returns presigned POST fields enforcing
        the content-length-range and Content-Type conditions.
        ``PATCH``: flips ``is_uploaded=True``, invokes
        :meth:`entity_asset_save` (which sets
        ``User.avatar_asset_id``/``User.cover_image_asset_id``, soft-deletes
        the previous avatar/cover, and invalidates ``/api/users/me/`` and
        ``/api/users/me/settings/`` cache via
        :func:`invalidate_cache_directly`), and enqueues
        ``get_asset_object_metadata.delay`` (Celery via RabbitMQ) when
        ``storage_metadata`` is empty.
        ``DELETE``: soft-deletes (``is_deleted=True``, ``deleted_at=now()``)
        and invokes :meth:`entity_asset_delete` to clear the parent
        ``User.avatar_asset_id``/``cover_image_asset_id`` reference.
    """

    def asset_delete(self, asset_id):
        """Soft-delete the FileAsset row identified by ``asset_id``."""
        asset = FileAsset.objects.filter(id=asset_id).first()
        if asset is None:
            return
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return

    def entity_asset_save(self, asset_id, entity_type, asset, request):
        """Bind the asset to ``User.avatar_asset_id`` or ``cover_image_asset_id`` and invalidate user cache.

        Soft-deletes the previously-bound asset via :meth:`asset_delete`
        before assigning the new one and invalidates ``/api/users/me/``
        plus ``/api/users/me/settings/`` cache entries so the next
        ``GET /users/me`` returns the new asset URL.
        """
        # User Avatar
        if entity_type == FileAsset.EntityTypeContext.USER_AVATAR:
            user = User.objects.get(id=asset.user_id)
            user.avatar = ""
            # Delete the previous avatar
            if user.avatar_asset_id:
                self.asset_delete(user.avatar_asset_id)
            # Save the new avatar
            user.avatar_asset_id = asset_id
            user.save()
            invalidate_cache_directly(path="/api/users/me/", url_params=False, user=True, request=request)
            invalidate_cache_directly(
                path="/api/users/me/settings/",
                url_params=False,
                user=True,
                request=request,
            )
            return
        # User Cover
        if entity_type == FileAsset.EntityTypeContext.USER_COVER:
            user = User.objects.get(id=asset.user_id)
            user.cover_image = None
            # Delete the previous cover image
            if user.cover_image_asset_id:
                self.asset_delete(user.cover_image_asset_id)
            # Save the new cover image
            user.cover_image_asset_id = asset_id
            user.save()
            invalidate_cache_directly(path="/api/users/me/", url_params=False, user=True, request=request)
            invalidate_cache_directly(
                path="/api/users/me/settings/",
                url_params=False,
                user=True,
                request=request,
            )
            return
        return

    def entity_asset_delete(self, entity_type, asset, request):
        """Clear ``User.avatar_asset_id``/``cover_image_asset_id`` and invalidate the user cache."""
        # User Avatar
        if entity_type == FileAsset.EntityTypeContext.USER_AVATAR:
            user = User.objects.get(id=asset.user_id)
            user.avatar_asset_id = None
            user.save()
            invalidate_cache_directly(path="/api/users/me/", url_params=False, user=True, request=request)
            invalidate_cache_directly(
                path="/api/users/me/settings/",
                url_params=False,
                user=True,
                request=request,
            )
            return
        # User Cover
        if entity_type == FileAsset.EntityTypeContext.USER_COVER:
            user = User.objects.get(id=asset.user_id)
            user.cover_image_asset_id = None
            user.save()
            invalidate_cache_directly(path="/api/users/me/", url_params=False, user=True, request=request)
            invalidate_cache_directly(
                path="/api/users/me/settings/",
                url_params=False,
                user=True,
                request=request,
            )
            return
        return

    def post(self, request):
        """Initiate a user avatar/cover upload and return presigned POST data.

        Validates that ``entity_type`` is exactly ``USER_AVATAR`` or
        ``USER_COVER`` (a stricter allowlist than the workspace endpoint,
        which accepts every :attr:`FileAsset.EntityTypeContext.values`
        entry) and that ``type`` is in the image MIME allowlist.
        """
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
                    "error": "Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.",
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

    def patch(self, request, asset_id):
        """Confirm the upload, bind the asset to the user, and enqueue storage metadata enrichment."""
        # get the asset id
        asset = FileAsset.objects.get(id=asset_id, user_id=request.user.id)
        # get the storage metadata
        asset.is_uploaded = True
        # get the storage metadata
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(asset_id=str(asset_id))
        # get the entity and save the asset id for the request field
        self.entity_asset_save(
            asset_id=asset_id,
            entity_type=asset.entity_type,
            asset=asset,
            request=request,
        )
        # update the attributes
        asset.attributes = request.data.get("attributes", asset.attributes)
        # save the asset
        asset.save(update_fields=["is_uploaded", "attributes"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def delete(self, request, asset_id):
        """Soft-delete the user asset and clear the parent ``User`` reference."""
        asset = FileAsset.objects.get(id=asset_id, user_id=request.user.id)
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        # get the entity and save the asset id for the request field
        self.entity_asset_delete(entity_type=asset.entity_type, asset=asset, request=request)
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceFileAssetEndpoint(BaseAPIView):
    """Manage workspace-scoped presigned uploads, downloads, and soft-deletes across every entity type.

    Resource:
        :class:`FileAsset` rows scoped to the workspace identified by
        ``slug``. Accepts every :attr:`FileAsset.EntityTypeContext.values`
        entry: workspace logos, project covers, user avatars/covers, issue
        attachments, issue/page/comment descriptions, etc.

    HTTP methods and URL patterns (from ``plane/app/urls/asset.py``):
        ``POST   assets/v2/workspaces/<str:slug>/``                    (name ``workspace-file-assets``)
        ``PATCH  assets/v2/workspaces/<str:slug>/<uuid:asset_id>/``    (name ``workspace-file-assets``)
        ``DELETE assets/v2/workspaces/<str:slug>/<uuid:asset_id>/``    (name ``workspace-file-assets``)
        ``GET    assets/v2/workspaces/<str:slug>/<uuid:asset_id>/``    (name ``workspace-file-assets``)

    Request body (``POST``):
        ``name`` (str, optional): sanitized via :func:`sanitize_filename`;
            defaults to ``"unnamed"``.
        ``type`` (str, optional): MIME type; defaults to ``"image/jpeg"``;
            must be in the image allowlist.
        ``size`` (int bytes, optional): clamped to
            ``settings.FILE_SIZE_LIMIT``.
        ``entity_type`` (str, required): must be a member of
            :attr:`FileAsset.EntityTypeContext.values`.
        ``entity_identifier`` (UUID, optional): used by
            :meth:`get_entity_id_field` to populate the FK column
            (``workspace_id``/``project_id``/``user_id``/``issue_id``/
            ``page_id``/``comment_id``) that matches ``entity_type``.

    Response shape:
        ``POST``: HTTP 200 with
        ``{"upload_data": <presigned POST fields>, "asset_id": <UUID>,
        "asset_url": <str>}``.
        ``GET``: HTTP 302 ``HttpResponseRedirect`` to a presigned download
        URL with ``disposition="attachment"`` and the original filename
        from ``asset.attributes["name"]``; HTTP 404 if not uploaded.
        ``PATCH``/``DELETE``: HTTP 204 No Content.

    Permission:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
        level="WORKSPACE")`` on every method — any active member of the
        named workspace (any role) may upload, confirm, soft-delete, or
        download.

    Side effects:
        ``POST``: creates a :class:`FileAsset` with ``workspace=workspace``
        and the entity-derived FK populated by :meth:`get_entity_id_field`.
        ``PATCH``: flips ``is_uploaded=True``, invokes
        :meth:`entity_asset_save` (which binds
        ``Workspace.logo_asset_id``/``Project.cover_image_asset_id`` and
        invalidates ``/api/workspaces/``, ``/api/users/me/workspaces/``,
        ``/api/instances/`` cache), and enqueues
        ``get_asset_object_metadata.delay`` (Celery via RabbitMQ).
        ``DELETE``: soft-deletes the row and invokes
        :meth:`entity_asset_delete` to clear the parent FK + cache.
        ``GET``: read-only; emits a 302 redirect to S3/MinIO.
    """

    def get_entity_id_field(self, entity_type, entity_id):
        """Map ``entity_type`` to the FileAsset foreign-key kwargs dict.

        Returns ``{"workspace_id": ...}``, ``{"project_id": ...}``,
        ``{"user_id": ...}``, ``{"issue_id": ...}``, ``{"page_id": ...}``,
        or ``{"comment_id": ...}`` depending on the entity type, or ``{}``
        when no FK mapping applies.
        """
        # Workspace Logo
        if entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
            return {"workspace_id": entity_id}

        # Project Cover
        if entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            return {"project_id": entity_id}

        # User Avatar and Cover
        if entity_type in [
            FileAsset.EntityTypeContext.USER_AVATAR,
            FileAsset.EntityTypeContext.USER_COVER,
        ]:
            return {"user_id": entity_id}

        # Issue Attachment and Description
        if entity_type in [
            FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
        ]:
            return {"issue_id": entity_id}

        # Page Description
        if entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            return {"page_id": entity_id}

        # Comment Description
        if entity_type == FileAsset.EntityTypeContext.COMMENT_DESCRIPTION:
            return {"comment_id": entity_id}
        return {}

    def asset_delete(self, asset_id):
        """Soft-delete the FileAsset row identified by ``asset_id``."""
        asset = FileAsset.objects.filter(id=asset_id).first()
        # Check if the asset exists
        if asset is None:
            return
        # Mark the asset as deleted
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return

    def entity_asset_save(self, asset_id, entity_type, asset, request):
        """Bind the asset to its workspace-scoped parent entity and invalidate the matching caches.

        For ``WORKSPACE_LOGO`` sets ``Workspace.logo_asset_id`` (clearing
        the legacy ``Workspace.logo`` string field) and invalidates the
        ``/api/workspaces/``, ``/api/users/me/workspaces/``, and
        ``/api/instances/`` cache entries. For ``PROJECT_COVER`` sets
        ``Project.cover_image_asset_id`` (clearing ``Project.cover_image``)
        without cache invalidation. Other entity types are no-ops here
        because the binding is handled inline at create time via
        :meth:`get_entity_id_field`.
        """
        # Workspace Logo
        if entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
            workspace = Workspace.objects.filter(id=asset.workspace_id).first()
            if workspace is None:
                return
            # Delete the previous logo
            if workspace.logo_asset_id:
                self.asset_delete(workspace.logo_asset_id)
            # Save the new logo
            workspace.logo = ""
            workspace.logo_asset_id = asset_id
            workspace.save()
            invalidate_cache_directly(path="/api/workspaces/", url_params=False, user=False, request=request)
            invalidate_cache_directly(
                path="/api/users/me/workspaces/",
                url_params=False,
                user=True,
                request=request,
            )
            invalidate_cache_directly(path="/api/instances/", url_params=False, user=False, request=request)
            return

        # Project Cover
        elif entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            project = Project.objects.filter(id=asset.project_id).first()
            if project is None:
                return
            # Delete the previous cover image
            if project.cover_image_asset_id:
                self.asset_delete(project.cover_image_asset_id)
            # Save the new cover image
            project.cover_image = ""
            project.cover_image_asset_id = asset_id
            project.save()
            return
        else:
            return

    def entity_asset_delete(self, entity_type, asset, request):
        """Clear the parent ``Workspace``/``Project`` FK and invalidate the matching caches.

        Mirror of :meth:`entity_asset_save`: clears
        ``Workspace.logo_asset_id`` (with workspace-cache invalidation) or
        ``Project.cover_image_asset_id`` (no cache invalidation) so the
        parent row no longer references the soft-deleted asset.
        """
        # Workspace Logo
        if entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
            workspace = Workspace.objects.get(id=asset.workspace_id)
            if workspace is None:
                return
            workspace.logo_asset_id = None
            workspace.save()
            invalidate_cache_directly(path="/api/workspaces/", url_params=False, user=False, request=request)
            invalidate_cache_directly(
                path="/api/users/me/workspaces/",
                url_params=False,
                user=True,
                request=request,
            )
            invalidate_cache_directly(path="/api/instances/", url_params=False, user=False, request=request)
            return
        # Project Cover
        elif entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            project = Project.objects.filter(id=asset.project_id).first()
            if project is None:
                return
            project.cover_image_asset_id = None
            project.save()
            return
        else:
            return

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug):
        """Initiate a workspace asset upload and return presigned POST data.

        Validates ``entity_type`` against
        :attr:`FileAsset.EntityTypeContext.values` and ``type`` against
        the image MIME allowlist, clamps ``size`` to
        ``settings.FILE_SIZE_LIMIT``, and writes a :class:`FileAsset` row
        keyed at ``<workspace.id>/<uuid>-<name>``.
        """
        name = sanitize_filename(request.data.get("name")) or "unnamed"
        type = request.data.get("type", "image/jpeg")
        size = int(request.data.get("size", settings.FILE_SIZE_LIMIT))
        entity_type = request.data.get("entity_type")
        entity_identifier = request.data.get("entity_identifier", False)

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

        # Get the size limit
        size_limit = min(settings.FILE_SIZE_LIMIT, size)

        # Get the workspace
        workspace = Workspace.objects.get(slug=slug)

        # asset key
        asset_key = f"{workspace.id}/{uuid.uuid4().hex}-{name}"

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            workspace=workspace,
            created_by=request.user,
            entity_type=entity_type,
            **self.get_entity_id_field(entity_type=entity_type, entity_id=entity_identifier),
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

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def patch(self, request, slug, asset_id):
        """Confirm the upload, bind the asset to its parent entity, and enqueue storage metadata enrichment."""
        # get the asset id
        asset = FileAsset.objects.get(id=asset_id, workspace__slug=slug)
        # get the storage metadata
        asset.is_uploaded = True
        # get the storage metadata
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(asset_id=str(asset_id))
        # get the entity and save the asset id for the request field
        self.entity_asset_save(
            asset_id=asset_id,
            entity_type=asset.entity_type,
            asset=asset,
            request=request,
        )
        # update the attributes
        asset.attributes = request.data.get("attributes", asset.attributes)
        # save the asset
        asset.save(update_fields=["is_uploaded", "attributes"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def delete(self, request, slug, asset_id):
        """Soft-delete the workspace asset and clear the parent entity reference."""
        asset = FileAsset.objects.get(id=asset_id, workspace__slug=slug)
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        # get the entity and save the asset id for the request field
        self.entity_asset_delete(entity_type=asset.entity_type, asset=asset, request=request)
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, asset_id):
        """Return an HTTP 302 redirect to a presigned download URL with ``content-disposition=attachment``."""
        # get the asset id
        asset = FileAsset.objects.get(id=asset_id, workspace__slug=slug)

        # Check if the asset is uploaded
        if not asset.is_uploaded:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        signed_url = storage.generate_presigned_url(
            object_name=asset.asset.name,
            disposition="attachment",
            filename=asset.attributes.get("name"),
        )
        # Redirect to the signed URL
        return HttpResponseRedirect(signed_url)


class StaticFileAssetEndpoint(BaseAPIView):
    """Serve presigned download redirects for publicly-readable static assets only.

    Resource:
        Read-only access to a narrow allowlist of :class:`FileAsset` rows
        whose ``entity_type`` is ``USER_AVATAR``, ``USER_COVER``,
        ``WORKSPACE_LOGO``, or ``PROJECT_COVER`` — every other entity type
        returns HTTP 400.

    HTTP methods and URL pattern (from ``plane/app/urls/asset.py``):
        ``GET assets/v2/static/<uuid:asset_id>/``  (name ``static-file-asset``)

    Permission:
        ``permission_classes = [AllowAny]`` — explicitly overrides the
        :class:`BaseAPIView` default of ``[IsAuthenticated]``. This is the
        **security boundary for public asset reads**: unauthenticated
        callers can only retrieve avatars, covers, workspace logos, and
        project covers. The entity-type allowlist check inside :meth:`get`
        is the second guardrail enforcing that boundary.

    Response shape:
        ``GET``: HTTP 302 ``HttpResponseRedirect`` to a presigned S3 GET
        URL; HTTP 404 when the asset is not yet ``is_uploaded``; HTTP 400
        when ``entity_type`` is not in the public allowlist.

    Side effects:
        None — read-only.
    """

    permission_classes = [AllowAny]

    def get(self, request, asset_id):
        """Return an HTTP 302 redirect to a presigned URL for an allowlisted public static asset.

        The allowlist gates this endpoint to ``USER_AVATAR``,
        ``USER_COVER``, ``WORKSPACE_LOGO``, and ``PROJECT_COVER`` only —
        unauthenticated callers cannot read any other entity type.
        """
        # get the asset id
        asset = FileAsset.objects.get(id=asset_id)

        # Check if the asset is uploaded
        if not asset.is_uploaded:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Check if the entity type is allowed
        if asset.entity_type not in [
            FileAsset.EntityTypeContext.USER_AVATAR,
            FileAsset.EntityTypeContext.USER_COVER,
            FileAsset.EntityTypeContext.WORKSPACE_LOGO,
            FileAsset.EntityTypeContext.PROJECT_COVER,
        ]:
            return Response(
                {"error": "Invalid entity type.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        signed_url = storage.generate_presigned_url(object_name=asset.asset.name)
        # Redirect to the signed URL
        return HttpResponseRedirect(signed_url)


class AssetRestoreEndpoint(BaseAPIView):
    """Undo the soft-delete on a workspace asset before physical S3 cleanup runs.

    Resource:
        Soft-deleted :class:`FileAsset` rows in a given workspace
        (``is_deleted=True``). Uses :attr:`FileAsset.all_objects` (not
        ``.objects``) to bypass the default soft-delete-filter manager
        and resurrect the row.

    HTTP methods and URL pattern (from ``plane/app/urls/asset.py``):
        ``POST assets/v2/workspaces/<str:slug>/restore/<uuid:asset_id>/``  (name ``asset-restore``)

    Request body:
        None — pure restore action.

    Response shape:
        HTTP 204 No Content.

    Permission:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
        level="WORKSPACE")`` — any active workspace member.

    Idempotency:
        Yes. Re-posting against an already-restored row
        (``is_deleted=False``) leaves both ``is_deleted`` and
        ``deleted_at`` unchanged from the perspective of the caller; safe
        to retry.

    Side effects:
        Clears ``is_deleted`` and ``deleted_at`` on the row. Does **not**
        reverse any cache invalidations that were emitted at delete time.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug, asset_id):
        """Undo soft-delete by clearing ``is_deleted`` and ``deleted_at``; idempotent."""
        asset = FileAsset.all_objects.get(id=asset_id, workspace__slug=slug)
        asset.is_deleted = False
        asset.deleted_at = None
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectAssetEndpoint(BaseAPIView):
    """Manage project-scoped presigned uploads, downloads, and soft-deletes for issue/page/comment artifacts.

    Resource:
        :class:`FileAsset` rows scoped to a specific project under a
        workspace. Accepts every :attr:`FileAsset.EntityTypeContext.values`
        entry plus an extended mapping for ``DRAFT_ISSUE_DESCRIPTION`` in
        :meth:`get_entity_id_field` (not present on the workspace variant).

    HTTP methods and URL patterns (from ``plane/app/urls/asset.py``):
        ``POST   assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/``
        ``PATCH  assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/<uuid:pk>/``
        ``DELETE assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/<uuid:pk>/``
        ``GET    assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/<uuid:pk>/``
        (all four routes share the URL name ``bulk-asset-update``)

    Request body (``POST``):
        Same shape as :class:`WorkspaceFileAssetEndpoint.post` —
        ``name``, ``type``, ``size``, ``entity_type``,
        ``entity_identifier``. Server-side, ``entity_type`` must be in
        :attr:`FileAsset.EntityTypeContext.values` and ``type`` must be in
        the image MIME allowlist.

    Response shape:
        ``POST``: HTTP 200 with
        ``{"upload_data": <presigned POST fields>, "asset_id": <UUID>,
        "asset_url": <str>}``.
        ``GET``: HTTP 302 redirect to a presigned download URL with
        ``content-disposition=attachment``; HTTP 404 if not uploaded.
        ``PATCH``/``DELETE``: HTTP 204 No Content.

    Permission:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])`` on
        every method — the decorator defaults to ``level="PROJECT"``, so
        only active project members of the named role may invoke these
        endpoints (stricter than :class:`WorkspaceFileAssetEndpoint`,
        which is gated at ``level="WORKSPACE"``).

    Side effects:
        ``POST``: creates a :class:`FileAsset` populated with **both**
        ``project_id`` from the URL path *and* any entity-derived FK from
        :meth:`get_entity_id_field` — the dual-source population is
        non-obvious but required because asset descriptions also belong to
        an ``issue``/``page``/``comment``/``draft_issue``.
        ``PATCH``: flips ``is_uploaded=True`` and enqueues
        ``get_asset_object_metadata.delay`` (Celery via RabbitMQ) when
        ``storage_metadata`` is empty. Unlike the workspace endpoint, no
        entity-binding callback runs here because the FK was set at
        ``POST`` time.
        ``DELETE``: soft-deletes the row (no parent-FK clearing because
        project-scoped descriptions do not maintain a back-pointer on the
        parent entity).
        ``GET``: emits a 302 redirect to S3/MinIO.
    """

    def get_entity_id_field(self, entity_type, entity_id):
        """Map ``entity_type`` to the FileAsset foreign-key kwargs dict (project variant).

        Identical to the workspace variant, but additionally maps
        ``DRAFT_ISSUE_DESCRIPTION`` to ``{"draft_issue_id": entity_id}`` so
        draft-issue editors can attach assets prior to the draft being
        promoted to a published issue.
        """
        if entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
            return {"workspace_id": entity_id}

        if entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            return {"project_id": entity_id}

        if entity_type in [
            FileAsset.EntityTypeContext.USER_AVATAR,
            FileAsset.EntityTypeContext.USER_COVER,
        ]:
            return {"user_id": entity_id}

        if entity_type in [
            FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
        ]:
            return {"issue_id": entity_id}

        if entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            return {"page_id": entity_id}

        if entity_type == FileAsset.EntityTypeContext.COMMENT_DESCRIPTION:
            return {"comment_id": entity_id}

        if entity_type == FileAsset.EntityTypeContext.DRAFT_ISSUE_DESCRIPTION:
            return {"draft_issue_id": entity_id}
        return {}

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id):
        """Initiate a project-scoped asset upload and return presigned POST data.

        Populates the created :class:`FileAsset` with **both**
        ``project_id`` from the URL path and any entity-derived FK from
        :meth:`get_entity_id_field`; this dual-source population lets the
        same row participate in project-level listings *and*
        issue/page/comment/draft-issue lookups.
        """
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

        # Get the size limit
        size_limit = min(settings.FILE_SIZE_LIMIT, size)

        # Get the workspace
        workspace = Workspace.objects.get(slug=slug)

        # asset key
        asset_key = f"{workspace.id}/{uuid.uuid4().hex}-{name}"

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            workspace=workspace,
            created_by=request.user,
            entity_type=entity_type,
            project_id=project_id,
            **self.get_entity_id_field(entity_type, entity_identifier),
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

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def patch(self, request, slug, project_id, pk):
        """Confirm the upload and enqueue storage metadata enrichment."""
        # get the asset id
        asset = FileAsset.objects.get(id=pk, workspace__slug=slug, project_id=project_id)
        # get the storage metadata
        asset.is_uploaded = True
        # get the storage metadata
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(asset_id=str(pk))

        # update the attributes
        asset.attributes = request.data.get("attributes", asset.attributes)
        # save the asset
        asset.save(update_fields=["is_uploaded", "attributes"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def delete(self, request, slug, project_id, pk):
        """Soft-delete the project asset."""
        # Get the asset
        asset = FileAsset.objects.get(id=pk, workspace__slug=slug, project_id=project_id)
        # Check deleted assets
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        # Save the asset
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, pk):
        """Return an HTTP 302 redirect to a presigned download URL with ``content-disposition=attachment``."""
        # get the asset id
        asset = FileAsset.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)

        # Check if the asset is uploaded
        if not asset.is_uploaded:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        signed_url = storage.generate_presigned_url(
            object_name=asset.asset.name,
            disposition="attachment",
            filename=asset.attributes.get("name"),
        )
        # Redirect to the signed URL
        return HttpResponseRedirect(signed_url)


class ProjectBulkAssetEndpoint(BaseAPIView):
    """Rebind a batch of already-uploaded assets to a single parent entity in one round trip.

    Resource:
        A list of :class:`FileAsset` rows in the named workspace, supplied
        in the request body as ``asset_ids``. The endpoint reassigns these
        rows to the parent entity identified by ``entity_id`` in the URL.

    HTTP methods and URL pattern (from ``plane/app/urls/asset.py``):
        ``POST assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/<uuid:entity_id>/bulk/``
        (URL name ``bulk-asset-update``)

    Request body:
        ``asset_ids`` (list[UUID], required): the assets to rebind.
        Missing or empty returns HTTP 400.

    Behavior:
        Reads the **first** asset in the batch and dispatches on its
        ``entity_type`` — every other asset in the batch is treated as the
        same type:

        * ``PROJECT_COVER``      -> ``assets.update(project_id=...)`` plus a
          per-asset :meth:`save_project_cover` write to
          ``Project.cover_image_asset_id``.
        * ``ISSUE_DESCRIPTION``  -> ``assets.update(issue_id=entity_id,
          project_id=project_id)``.
        * ``COMMENT_DESCRIPTION`` -> ``assets.update(comment_id=entity_id)``.
        * ``PAGE_DESCRIPTION``   -> ``assets.update(page_id=entity_id)``.
        * ``DRAFT_ISSUE_DESCRIPTION`` ->
          ``assets.update(draft_issue_id=entity_id)``.

        Heterogeneous batches (mixed entity types) are not fully supported:
        only the first asset's type drives the dispatch.

    Response shape:
        HTTP 204 No Content (or HTTP 400 when ``asset_ids`` is missing /
        empty, HTTP 404 when no asset row matches).

    Permission:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])`` —
        defaults to ``level="PROJECT"``.

    Side effects:
        Bulk ``UPDATE`` on the matched rows. ``IntegrityError`` raised by
        the issue/comment/draft-issue branches is **intentionally
        swallowed** — it handles the race where the parent entity was
        deleted between the asset upload and the bulk-bind call.
    """

    def save_project_cover(self, asset, project_id):
        """Set ``Project.cover_image_asset_id`` to the bulk-rebound asset's id."""
        project = Project.objects.get(id=project_id)
        project.cover_image_asset_id = asset.id
        project.save()

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, entity_id):
        """Rebind every asset in ``asset_ids`` to ``entity_id`` based on the first asset's entity type.

        The issue/comment/draft-issue branches wrap their
        ``QuerySet.update`` in ``try/except IntegrityError`` to absorb the
        race where the parent entity is deleted between the original asset
        upload and this bulk-bind call.
        """
        asset_ids = request.data.get("asset_ids", [])

        # Check if the asset ids are provided
        if not asset_ids:
            return Response({"error": "No asset ids provided."}, status=status.HTTP_400_BAD_REQUEST)

        # get the asset id
        assets = FileAsset.objects.filter(id__in=asset_ids, workspace__slug=slug)

        # Get the first asset
        asset = assets.first()

        if not asset:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Check if the asset is uploaded
        if asset.entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            assets.update(project_id=project_id)
            [self.save_project_cover(asset, project_id) for asset in assets]

        if asset.entity_type == FileAsset.EntityTypeContext.ISSUE_DESCRIPTION:
            # For some cases, the bulk api is called after the issue is deleted creating
            # an integrity error
            try:
                assets.update(issue_id=entity_id, project_id=project_id)
            except IntegrityError:
                pass

        if asset.entity_type == FileAsset.EntityTypeContext.COMMENT_DESCRIPTION:
            # For some cases, the bulk api is called after the comment is deleted
            # creating an integrity error
            try:
                assets.update(comment_id=entity_id)
            except IntegrityError:
                pass

        if asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            assets.update(page_id=entity_id)

        if asset.entity_type == FileAsset.EntityTypeContext.DRAFT_ISSUE_DESCRIPTION:
            # For some cases, the bulk api is called after the draft issue is deleted
            # creating an integrity error
            try:
                assets.update(draft_issue_id=entity_id)
            except IntegrityError:
                pass

        return Response(status=status.HTTP_204_NO_CONTENT)


class AssetCheckEndpoint(BaseAPIView):
    """Probe whether a workspace asset exists and is not soft-deleted without exposing its payload.

    Resource:
        Existence check on a single :class:`FileAsset` row in the named
        workspace. Uses :attr:`FileAsset.all_objects` filtered to
        ``deleted_at__isnull=True`` — soft-deleted rows are reported as
        non-existent without leaking the asset payload itself.

    HTTP methods and URL pattern (from ``plane/app/urls/asset.py``):
        ``GET assets/v2/workspaces/<str:slug>/check/<uuid:asset_id>/``  (name ``asset-check``)

    Response shape:
        HTTP 200 with ``{"exists": <bool>}``.

    Permission:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
        level="WORKSPACE")`` — any active workspace member.

    Side effects:
        None — read-only existence probe.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, asset_id):
        """Return whether the asset exists in the workspace and is not soft-deleted."""
        asset = FileAsset.all_objects.filter(id=asset_id, workspace__slug=slug, deleted_at__isnull=True).exists()
        return Response({"exists": asset}, status=status.HTTP_200_OK)


class DuplicateAssetEndpoint(BaseAPIView):
    """Duplicate an existing asset by copying its S3 object and creating a new FileAsset row.

    Resource:
        Cross-asset duplication: copies the S3 object behind the source
        :class:`FileAsset` to a fresh object key under the target workspace
        and writes a new :class:`FileAsset` row pre-bound to a new parent
        entity, with ``storage_metadata`` propagated from the source.

    HTTP methods and URL pattern (from ``plane/app/urls/asset.py``):
        ``POST assets/v2/workspaces/<str:slug>/duplicate-assets/<uuid:asset_id>/``  (name ``duplicate-assets``)

    Throttling:
        ``throttle_classes = [AssetRateThrottle]`` — per-asset-id rate
        limit (scope ``"asset_id"``, default ``5/minute``) keyed on the
        URL ``asset_id`` so copy bursts on the same source asset are
        bucketed independently from other assets.

    Request body:
        ``project_id`` (UUID, optional): when present, must reference a
            project inside the named workspace; otherwise HTTP 404.
        ``entity_id`` (UUID, optional): the parent entity to bind the new
            asset to via :meth:`get_entity_id_field`.
        ``entity_type`` (str, required): must be a member of
            :attr:`FileAsset.EntityTypeContext.values`.

    Cross-tenant isolation guardrail:
        The source asset lookup is restricted to workspaces where the
        request user is an active :class:`WorkspaceMember` —
        ``WorkspaceMember.objects.filter(member=request.user,
        is_active=True).values_list("workspace_id", flat=True)``. This
        prevents callers from duplicating assets out of workspaces they
        do not belong to (cross-tenant exfiltration).

    Response shape:
        HTTP 200 with ``{"asset_id": <UUID of the new row>}``.

    Permission:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
        level="WORKSPACE")`` — any active workspace member.

    Side effects:
        Calls :meth:`S3Storage.copy_object` (S3 ``CopyObject`` API) to
        clone the underlying object, creates the new :class:`FileAsset`
        row, and immediately sets ``is_uploaded=True`` because the copy is
        synchronous (no presigned upload step is needed). Does not enqueue
        ``get_asset_object_metadata.delay`` because ``storage_metadata``
        is propagated from the source.
    """

    throttle_classes = [AssetRateThrottle]

    def get_entity_id_field(self, entity_type, entity_id):
        """Map ``entity_type`` to the FileAsset foreign-key kwargs dict (duplicate variant)."""
        # Workspace Logo
        if entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
            return {"workspace_id": entity_id}

        # Project Cover
        if entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            return {"project_id": entity_id}

        # User Avatar and Cover
        if entity_type in [
            FileAsset.EntityTypeContext.USER_AVATAR,
            FileAsset.EntityTypeContext.USER_COVER,
        ]:
            return {"user_id": entity_id}

        # Issue Attachment and Description
        if entity_type in [
            FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
        ]:
            return {"issue_id": entity_id}

        # Page Description
        if entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            return {"page_id": entity_id}

        # Comment Description
        if entity_type == FileAsset.EntityTypeContext.COMMENT_DESCRIPTION:
            return {"comment_id": entity_id}

        return {}

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug, asset_id):
        """Copy a source asset's S3 object to a new key and create a duplicate FileAsset row.

        The source lookup is scoped to workspaces the caller is an active
        member of (``WorkspaceMember`` filter on ``request.user``) to
        prevent cross-tenant asset exfiltration. The newly created row is
        marked ``is_uploaded=True`` immediately because the S3 copy is
        synchronous.
        """
        project_id = request.data.get("project_id", None)
        entity_id = request.data.get("entity_id", None)
        entity_type = request.data.get("entity_type", None)

        if not entity_type or entity_type not in FileAsset.EntityTypeContext.values:
            return Response(
                {"error": "Invalid entity type or entity id"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workspace = Workspace.objects.get(slug=slug)
        if project_id:
            # check if project exists in the workspace
            if not Project.objects.filter(id=project_id, workspace=workspace).exists():
                return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        storage = S3Storage(request=request)
        # Scope the source asset lookup to workspaces the caller is a member of
        user_workspace_ids = WorkspaceMember.objects.filter(
            member=request.user,
            is_active=True,
        ).values_list("workspace_id", flat=True)
        original_asset = FileAsset.objects.filter(
            id=asset_id,
            is_uploaded=True,
            workspace_id__in=user_workspace_ids,
        ).first()

        if not original_asset:
            return Response({"error": "Asset not found"}, status=status.HTTP_404_NOT_FOUND)

        sanitized_name = sanitize_filename(original_asset.attributes.get("name")) or "unnamed"
        destination_key = f"{workspace.id}/{uuid.uuid4().hex}-{sanitized_name}"
        duplicated_asset = FileAsset.objects.create(
            attributes={
                "name": original_asset.attributes.get("name"),
                "type": original_asset.attributes.get("type"),
                "size": original_asset.attributes.get("size"),
            },
            asset=destination_key,
            size=original_asset.size,
            workspace=workspace,
            created_by_id=request.user.id,
            entity_type=entity_type,
            project_id=project_id if project_id else None,
            storage_metadata=original_asset.storage_metadata,
            **self.get_entity_id_field(entity_type=entity_type, entity_id=entity_id),
        )
        storage.copy_object(original_asset.asset, destination_key)
        # Update the is_uploaded field for all newly created assets
        FileAsset.objects.filter(id=duplicated_asset.id).update(is_uploaded=True)

        return Response({"asset_id": str(duplicated_asset.id)}, status=status.HTTP_200_OK)


class WorkspaceAssetDownloadEndpoint(BaseAPIView):
    """Issue a presigned download URL for a workspace asset with ``content-disposition=attachment``.

    Resource:
        Single :class:`FileAsset` row in the named workspace where
        ``is_uploaded=True``.

    HTTP methods and URL pattern (from ``plane/app/urls/asset.py``):
        ``GET assets/v2/workspaces/<str:slug>/download/<uuid:asset_id>/``  (name ``workspace-asset-download``)

    Response shape:
        HTTP 302 ``HttpResponseRedirect`` to a presigned download URL with
        ``disposition="attachment"`` and the original filename from
        ``asset.attributes["name"]`` (falling back to a random hex when
        missing); HTTP 404 when the row does not exist or is not yet
        uploaded.

    Permission:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
        level="WORKSPACE")`` — any active workspace member.

    Side effects:
        None — read-only.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, asset_id):
        """Return an HTTP 302 redirect to a presigned download URL; HTTP 404 if the asset is not uploaded."""
        try:
            asset = FileAsset.objects.get(
                id=asset_id,
                workspace__slug=slug,
                is_uploaded=True,
            )
        except FileAsset.DoesNotExist:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        storage = S3Storage(request=request)
        signed_url = storage.generate_presigned_url(
            object_name=asset.asset.name,
            disposition="attachment",
            filename=asset.attributes.get("name", uuid.uuid4().hex),
        )

        return HttpResponseRedirect(signed_url)


class ProjectAssetDownloadEndpoint(BaseAPIView):
    """Issue a presigned download URL for a project-scoped asset with ``content-disposition=attachment``.

    Resource:
        Single :class:`FileAsset` row in the named project (filtered by
        ``workspace__slug=slug`` *and* ``project_id``) where
        ``is_uploaded=True``.

    HTTP methods and URL pattern (from ``plane/app/urls/asset.py``):
        ``GET assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/download/<uuid:asset_id>/``
        (URL name ``project-asset-download``)

    Response shape:
        HTTP 302 ``HttpResponseRedirect`` to a presigned download URL with
        ``disposition="attachment"`` and the original filename; HTTP 404
        when the row does not exist or is not yet uploaded.

    Permission:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
        level="PROJECT")`` — any active project member (note the
        ``PROJECT`` scope vs. :class:`WorkspaceAssetDownloadEndpoint`'s
        ``WORKSPACE`` scope; downloads on project-scoped artifacts are
        gated at project membership granularity).

    Side effects:
        None — read-only.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="PROJECT")
    def get(self, request, slug, project_id, asset_id):
        """Return an HTTP 302 redirect to a presigned project-asset download URL; HTTP 404 if not uploaded."""
        try:
            asset = FileAsset.objects.get(
                id=asset_id,
                workspace__slug=slug,
                project_id=project_id,
                is_uploaded=True,
            )
        except FileAsset.DoesNotExist:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        storage = S3Storage(request=request)
        signed_url = storage.generate_presigned_url(
            object_name=asset.asset.name,
            disposition="attachment",
            filename=asset.attributes.get("name", uuid.uuid4().hex),
        )

        return HttpResponseRedirect(signed_url)
