# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Legacy v1 asset endpoints serving direct multipart uploads to the API server.

These endpoints accept the file bytes through ``MultiPartParser`` and
``FormParser`` and persist them via Django's ``FileField``. This contrasts with
the v2 presigned-POST flow in ``v2.py`` where the API server only issues a
short-lived S3 (or MinIO) upload URL and the bytes never traverse the API
process. Endpoints in this module are workspace-scoped
(``FileAssetEndpoint`` / ``FileAssetViewSet``) or user-scoped
(``UserAssetsEndpoint``); workspace asset keys are stored as the composite
string ``"<workspace_id>/<asset_key>"`` in the ``FileAsset.asset`` ``FileField``,
while user-scoped lookups use the raw ``asset_key``. Removal here is a
soft-delete that flips ``FileAsset.is_deleted`` to ``True`` only (the v2 flow
also stamps ``deleted_at``); physical storage cleanup is driven by the daily
Celery Beat task in ``plane/bgtasks/file_asset_task.py``.
"""

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

# Module imports
from ..base import BaseAPIView, BaseViewSet
from plane.db.models import FileAsset, Workspace
from plane.app.serializers import FileAssetSerializer


class FileAssetEndpoint(BaseAPIView):
    """Workspace-scoped legacy v1 file asset CRUD via direct multipart upload.

    HTTP methods and URL patterns (see ``apps/api/plane/app/urls/asset.py``):
        POST    /workspaces/<str:slug>/file-assets/
        GET     /workspaces/file-assets/<uuid:workspace_id>/<str:asset_key>/
        DELETE  /workspaces/file-assets/<uuid:workspace_id>/<str:asset_key>/

    Parser classes:
        ``MultiPartParser`` and ``FormParser`` accept the uploaded byte stream;
        ``JSONParser`` accepts JSON-only payloads (this differs from
        ``UserAssetsEndpoint``, which does not register ``JSONParser``).

    Request body (POST):
        Validated by ``FileAssetSerializer`` (model ``FileAsset``, fields
        ``__all__``). ``workspace_id`` is injected from the URL ``slug`` and
        not accepted from the client.

    Response shapes:
        GET    -> ``{"data": [<FileAsset>, ...], "status": True}`` on hit or
                  ``{"error": "Asset key does not exist", "status": False}``
                  on miss; both with HTTP 200 (callers must read the
                  ``status`` flag, not the HTTP status code).
        POST   -> serialized ``FileAsset`` with HTTP 201, or serializer
                  errors with HTTP 400.
        DELETE -> HTTP 204 (no body); soft-delete only
                  (``FileAsset.is_deleted = True``).

    Permissions:
        Inherits ``permission_classes = [IsAuthenticated]`` from
        ``BaseAPIView``; no per-action override.

    Asset key shape:
        Lookups concatenate ``str(workspace_id) + "/" + asset_key`` to match
        the on-disk layout produced by
        ``FileAsset.asset = FileField(upload_to=get_upload_path)``.

    Cross-references:
        * Serializer: :class:`plane.app.serializers.FileAssetSerializer`
          (``apps/api/plane/app/serializers/asset.py``)
        * Model: :class:`plane.db.models.FileAsset`
          (``apps/api/plane/db/models/asset.py``)
        * URL: ``apps/api/plane/app/urls/asset.py``
    """

    parser_classes = (MultiPartParser, FormParser, JSONParser)

    """
    A viewset for viewing and editing task instances.
    """

    def get(self, request, workspace_id, asset_key):
        """Look up workspace assets by the composite key ``<workspace_id>/<asset_key>``.

        Always returns HTTP 200; the ``status`` boolean in the response body
        signals existence rather than relying on HTTP 404.
        """
        asset_key = str(workspace_id) + "/" + asset_key
        files = FileAsset.objects.filter(asset=asset_key)
        if files.exists():
            serializer = FileAssetSerializer(files, context={"request": request}, many=True)
            return Response({"data": serializer.data, "status": True}, status=status.HTTP_200_OK)
        else:
            return Response(
                {"error": "Asset key does not exist", "status": False},
                status=status.HTTP_200_OK,
            )

    def post(self, request, slug):
        """Create a workspace asset and bind it to the workspace resolved from the URL slug."""
        serializer = FileAssetSerializer(data=request.data)
        if serializer.is_valid():
            # Get the workspace
            workspace = Workspace.objects.get(slug=slug)
            serializer.save(workspace_id=workspace.id)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, workspace_id, asset_key):
        """Soft-delete a workspace asset by composite key (sets ``is_deleted=True``)."""
        asset_key = str(workspace_id) + "/" + asset_key
        file_asset = FileAsset.objects.get(asset=asset_key)
        file_asset.is_deleted = True
        file_asset.save(update_fields=["is_deleted"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class FileAssetViewSet(BaseViewSet):
    """Workspace asset restore action for soft-deleted v1 file assets.

    HTTP method and URL pattern (see ``apps/api/plane/app/urls/asset.py``):
        POST  /workspaces/file-assets/<uuid:workspace_id>/<str:asset_key>/restore/

    The route registers this class as
    ``FileAssetViewSet.as_view({"post": "restore"})``; the DRF router maps the
    HTTP verb to the custom ``restore`` action, which is the only handler
    exposed by this viewset (no default ``list`` / ``retrieve`` / ``create`` /
    ``update`` / ``destroy``). Subclassing ``BaseViewSet`` rather than
    ``BaseAPIView`` is what enables that action-style mapping; ``model`` and
    ``serializer_class`` are intentionally unset because the action operates
    on a composite asset key rather than a primary key lookup.

    Request body (POST /restore/):
        None -- the asset is identified entirely by the URL composite key
        ``<workspace_id>/<asset_key>``; no body is read or required.

    Response:
        HTTP 204 (no body).

    Permissions:
        Inherits ``permission_classes = [IsAuthenticated]`` from
        ``BaseViewSet``.

    Cross-references:
        * Model: :class:`plane.db.models.FileAsset`
          (``apps/api/plane/db/models/asset.py``)
        * URL: ``apps/api/plane/app/urls/asset.py``
    """

    def restore(self, request, workspace_id, asset_key):
        """Reverse a workspace asset soft-delete by setting ``is_deleted=False``; idempotent."""
        asset_key = str(workspace_id) + "/" + asset_key
        file_asset = FileAsset.objects.get(asset=asset_key)
        file_asset.is_deleted = False
        file_asset.save(update_fields=["is_deleted"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserAssetsEndpoint(BaseAPIView):
    """User-scoped legacy v1 file asset CRUD via direct multipart upload.

    HTTP methods and URL patterns (see ``apps/api/plane/app/urls/asset.py``):
        POST    /users/file-assets/
        GET     /users/file-assets/<str:asset_key>/
        DELETE  /users/file-assets/<str:asset_key>/

    Parser classes:
        ``MultiPartParser`` and ``FormParser`` only; ``JSONParser`` is
        deliberately NOT registered here (the workspace endpoint
        ``FileAssetEndpoint`` does register it).

    Request body (POST):
        Validated by ``FileAssetSerializer`` (model ``FileAsset``, fields
        ``__all__``). The caller is recorded automatically as ``created_by``
        through ``BaseSerializer`` so the resulting row is owned by
        ``request.user``.

    Response shapes:
        GET    -> ``{"data": <FileAsset>, "status": True}`` on hit
                  (the serializer is invoked WITHOUT ``many=True`` against a
                  queryset, so ``data`` is a single serialized asset, not a
                  list — distinct from ``FileAssetEndpoint.get``) or
                  ``{"error": "Asset key does not exist", "status": False}``
                  on miss; both with HTTP 200 (callers must read the
                  ``status`` flag, not the HTTP status code).
        POST   -> serialized ``FileAsset`` with HTTP 201, or serializer
                  errors with HTTP 400.
        DELETE -> HTTP 204 (no body); soft-delete only
                  (``FileAsset.is_deleted = True``).

    Permissions:
        Inherits ``permission_classes = [IsAuthenticated]`` from
        ``BaseAPIView``; ownership is enforced by every queryset filtering on
        ``created_by=request.user`` so a user cannot read or delete another
        user's asset by guessing its key.

    Cross-references:
        * Serializer: :class:`plane.app.serializers.FileAssetSerializer`
          (``apps/api/plane/app/serializers/asset.py``)
        * Model: :class:`plane.db.models.FileAsset`
          (``apps/api/plane/db/models/asset.py``)
        * URL: ``apps/api/plane/app/urls/asset.py``
    """

    parser_classes = (MultiPartParser, FormParser)

    def get(self, request, asset_key):
        """Look up the caller's own file asset by ``asset_key`` (filtered by ``created_by=request.user``).

        Always returns HTTP 200; the ``status`` boolean in the response body
        signals existence (same convention as ``FileAssetEndpoint.get``).
        """
        files = FileAsset.objects.filter(asset=asset_key, created_by=request.user)
        if files.exists():
            serializer = FileAssetSerializer(files, context={"request": request})
            return Response({"data": serializer.data, "status": True}, status=status.HTTP_200_OK)
        else:
            return Response(
                {"error": "Asset key does not exist", "status": False},
                status=status.HTTP_200_OK,
            )

    def post(self, request):
        """Create a file asset attributed to the calling user."""
        serializer = FileAssetSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, asset_key):
        """Soft-delete the caller's own asset (sets ``is_deleted=True``)."""
        file_asset = FileAsset.objects.get(asset=asset_key, created_by=request.user)
        file_asset.is_deleted = True
        file_asset.save(update_fields=["is_deleted"])
        return Response(status=status.HTTP_204_NO_CONTENT)
