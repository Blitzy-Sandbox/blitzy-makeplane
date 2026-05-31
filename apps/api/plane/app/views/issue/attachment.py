# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Issue attachment HTTP endpoints (legacy multipart + presigned-S3 v2).

Provides two endpoints for managing file attachments on individual
issues:

* :class:`IssueAttachmentEndpoint` -- legacy direct-upload flow that
  accepts multipart form data and writes the file through Django's
  storage backend in a single request.
* :class:`IssueAttachmentV2Endpoint` -- modern presigned-S3 POST flow
  (see tech spec section 5.2.9): the client requests a presigned URL
  via ``POST``, uploads the binary directly to S3, then finalizes via
  ``PATCH``. This bypasses Django for the bytes themselves and supports
  much larger payloads.

All write paths enqueue
``plane.bgtasks.issue_activities_task.issue_activity`` (Celery via
RabbitMQ) so the attachment add/delete event appears in the issue
timeline.
"""

# Python imports
import json
import uuid

# Django imports
from django.utils import timezone
from django.core.serializers.json import DjangoJSONEncoder
from django.conf import settings
from django.http import HttpResponseRedirect

# Third Party imports
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser

# Module imports
from .. import BaseAPIView
from plane.app.serializers import IssueAttachmentSerializer
from plane.db.models import FileAsset, Workspace
from plane.bgtasks.issue_activities_task import issue_activity
from plane.app.permissions import allow_permission, ROLE
from plane.settings.storage import S3Storage
from plane.utils.path_validator import sanitize_filename
from plane.bgtasks.storage_metadata_task import get_asset_object_metadata
from plane.utils.host import base_host


class IssueAttachmentEndpoint(BaseAPIView):
    """Legacy multipart-upload endpoint for issue attachments (in-process upload through Django).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-attachments/
        POST   /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-attachments/
        DELETE /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-attachments/<pk>/

    Parsers:
        MultiPartParser + FormParser -- the binary file is included in
        the request body.

    Request body (POST):
        Multipart form fields validated by
        :class:`plane.app.serializers.IssueAttachmentSerializer`
        (typically ``asset`` -- the file -- plus ``attributes``).

    Response shape:
        - ``POST``: serialized :class:`FileAsset` (HTTP 201) or
          serializer errors (HTTP 400).
        - ``GET``: list of serialized FileAsset rows scoped to the issue.
        - ``DELETE``: HTTP 204 empty body; HTTP 404 if the attachment is
          missing.

    Permissions:
        permission_classes -- not set on the class; inherits
        ``[IsAuthenticated]`` from :class:`BaseAPIView`.
        Per-method gates:
            * ``post``/``get``: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])``
            * ``delete``: ``@allow_permission([ROLE.ADMIN], creator=True, model=FileAsset)``
              -- so any project member can delete an attachment they
              created, but only project admins can delete others'.

    Side effects:
        * POST creates a :class:`FileAsset` row with
          ``entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT``
          and enqueues a Celery activity task
          (``type="attachment.activity.created"``).
        * DELETE hard-deletes the underlying storage asset
          (``asset.delete(save=False)``) and the FileAsset row, and
          enqueues ``type="attachment.activity.deleted"``.

    Note:
        Newer clients should use :class:`IssueAttachmentV2Endpoint`
        (presigned S3 POST flow per tech spec section 5.2.9).
    """

    serializer_class = IssueAttachmentSerializer
    model = FileAsset
    parser_classes = (MultiPartParser, FormParser)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id):
        """Persist a multipart-uploaded file as an issue attachment.

        Enqueues an ``attachment.activity.created`` Celery task on
        success (Celery via RabbitMQ).
        """
        serializer = IssueAttachmentSerializer(data=request.data)
        workspace = Workspace.objects.get(slug=slug)
        if serializer.is_valid():
            serializer.save(
                project_id=project_id,
                issue_id=issue_id,
                workspace_id=workspace.id,
                entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            )
            issue_activity.delay(
                type="attachment.activity.created",
                requested_data=None,
                actor_id=str(self.request.user.id),
                issue_id=str(self.kwargs.get("issue_id", None)),
                project_id=str(self.kwargs.get("project_id", None)),
                current_instance=json.dumps(serializer.data, cls=DjangoJSONEncoder),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN], creator=True, model=FileAsset)
    def delete(self, request, slug, project_id, issue_id, pk):
        """Hard-delete the FileAsset row and its underlying storage object.

        Enqueues an ``attachment.activity.deleted`` Celery task once the
        row is removed (Celery via RabbitMQ).
        """
        issue_attachment = FileAsset.objects.filter(
            pk=pk, workspace__slug=slug, project_id=project_id, issue_id=issue_id
        ).first()
        if not issue_attachment:
            return Response(
                {"error": "Issue attachment not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        issue_attachment.asset.delete(save=False)
        issue_attachment.delete()
        issue_activity.delay(
            type="attachment.activity.deleted",
            requested_data=None,
            actor_id=str(self.request.user.id),
            issue_id=str(self.kwargs.get("issue_id", None)),
            project_id=str(self.kwargs.get("project_id", None)),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )

        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        """List all issue attachments for the given workspace + project + issue."""
        issue_attachments = FileAsset.objects.filter(issue_id=issue_id, workspace__slug=slug, project_id=project_id)
        serializer = IssueAttachmentSerializer(issue_attachments, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class IssueAttachmentV2Endpoint(BaseAPIView):
    """Presigned-S3 POST flow for issue attachments (tech spec section 5.2.9).

    Three-step upload protocol:
        1. ``POST`` -- client sends ``{"name", "type", "size"}``; the
           server validates the mime/size against
           :attr:`settings.ATTACHMENT_MIME_TYPES` and
           :attr:`settings.FILE_SIZE_LIMIT`, creates a pending
           :class:`FileAsset` row (``is_uploaded=False``), and returns a
           presigned S3 POST payload.
        2. Client uploads the binary directly to S3 using the returned
           ``upload_data`` (not handled by Django).
        3. ``PATCH`` -- client notifies the server that the upload is
           complete; the row is updated with ``is_uploaded=True`` and an
           activity task plus a metadata-backfill task are enqueued.

    HTTP methods + URL patterns:
        POST   /api/assets/v2/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/attachments/
        GET    /api/assets/v2/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/attachments/
        GET    /api/assets/v2/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/attachments/<pk>/
        PATCH  /api/assets/v2/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/attachments/<pk>/
        DELETE /api/assets/v2/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/attachments/<pk>/

    Request body:
        - ``POST``: ``{"name": str, "type": str (mime), "size": int}``.
          ``name`` is sanitized by
          :func:`plane.utils.path_validator.sanitize_filename`; ``type``
          must be a member of ``settings.ATTACHMENT_MIME_TYPES``; ``size``
          is clamped to ``settings.FILE_SIZE_LIMIT``.
        - ``GET``: none.
        - ``PATCH``: none required (idempotent finalize).
        - ``DELETE``: none.

    Response shape:
        - ``POST``: ``{"upload_data": <presigned POST payload>,
          "asset_id": "<uuid>", "attachment": <serialized FileAsset>,
          "asset_url": "<public url>"}`` (HTTP 200).
        - ``GET`` with pk: HTTP 302 ``Location: <presigned GET URL>``
          (``disposition="attachment"`` so the browser downloads
          instead of inlining). HTTP 400 if the asset is not yet
          uploaded.
        - ``GET`` without pk: list of serialized FileAsset rows where
          ``is_uploaded=True``.
        - ``PATCH``: HTTP 204 empty body.
        - ``DELETE``: HTTP 204 empty body.

    Permissions:
        permission_classes -- not set on the class; inherits
        ``[IsAuthenticated]`` from :class:`BaseAPIView`.
        Per-method gates: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER,
        ROLE.GUEST])`` on POST/GET/PATCH; ``@allow_permission([ROLE.ADMIN],
        creator=True, model=FileAsset)`` on DELETE (creator-or-admin).

    Side effects:
        * ``POST`` creates a FileAsset row with
          ``entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT``;
          no S3 write occurs server-side -- the presigned URL allows the
          client to upload directly.
        * ``PATCH`` enqueues ``issue_activity`` Celery task
          (``type="attachment.activity.created"``) only the first time
          the asset is marked uploaded; also enqueues
          :func:`plane.bgtasks.storage_metadata_task.get_asset_object_metadata`
          when ``storage_metadata`` is empty (backfill of S3 ETag/size).
        * ``DELETE`` performs a SOFT delete (``is_deleted=True,
          deleted_at=now()``) and enqueues
          ``type="attachment.activity.deleted"``. The S3 object is
          reaped later by :func:`plane.bgtasks.file_asset_task` (Beat).

    Idempotency:
        ``PATCH`` is safe to retry -- the ``attachment.activity.created``
        event is enqueued only when ``is_uploaded`` was ``False``.
    """

    serializer_class = IssueAttachmentSerializer
    model = FileAsset

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, issue_id):
        """Validate mime/size and create a pending :class:`FileAsset`.

        Returns an S3 presigned POST payload that lets the client upload
        the binary directly to S3 (no Django bytes pass-through).
        Returns HTTP 400 if ``type`` is missing or not in
        ``settings.ATTACHMENT_MIME_TYPES``.
        """
        name = sanitize_filename(request.data.get("name")) or "unnamed"
        type = request.data.get("type", False)
        size = int(request.data.get("size", settings.FILE_SIZE_LIMIT))

        if not type or type not in settings.ATTACHMENT_MIME_TYPES:
            return Response(
                {"error": "Invalid file type.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the workspace
        workspace = Workspace.objects.get(slug=slug)

        # asset key
        asset_key = f"{workspace.id}/{uuid.uuid4().hex}-{name}"

        # Get the size limit
        size_limit = min(size, settings.FILE_SIZE_LIMIT)

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            workspace_id=workspace.id,
            created_by=request.user,
            issue_id=issue_id,
            project_id=project_id,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
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
                "attachment": IssueAttachmentSerializer(asset).data,
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN], creator=True, model=FileAsset)
    def delete(self, request, slug, project_id, issue_id, pk):
        """Soft-delete the FileAsset (``is_deleted=True``) and enqueue an ``attachment.activity.deleted`` Celery task.

        The underlying S3 object is reaped later by the asset cleanup
        Celery Beat job.
        """
        issue_attachment = FileAsset.objects.get(pk=pk, workspace__slug=slug, project_id=project_id)
        issue_attachment.is_deleted = True
        issue_attachment.deleted_at = timezone.now()
        issue_attachment.save()

        issue_activity.delay(
            type="attachment.activity.deleted",
            requested_data=None,
            actor_id=str(self.request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )

        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id, pk=None):
        """Return a 302 redirect or list of uploaded attachments for the issue.

        When ``pk`` is provided, responds with HTTP 302 ``Location:
        <presigned S3 download URL>`` (``disposition="attachment"``).
        When ``pk`` is omitted, responds with the list of FileAsset rows
        where ``is_uploaded=True``. Returns HTTP 400 when ``pk``
        references an asset whose upload has not yet been finalized
        (``is_uploaded=False``).
        """
        if pk:
            # Get the asset
            asset = FileAsset.objects.get(id=pk, workspace__slug=slug, project_id=project_id)

            # Check if the asset is uploaded
            if not asset.is_uploaded:
                return Response(
                    {"error": "The asset is not uploaded.", "status": False},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            storage = S3Storage(request=request)
            presigned_url = storage.generate_presigned_url(
                object_name=asset.asset.name,
                disposition="attachment",
                filename=asset.attributes.get("name"),
            )
            return HttpResponseRedirect(presigned_url)

        # Get all the attachments
        issue_attachments = FileAsset.objects.filter(
            issue_id=issue_id,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            workspace__slug=slug,
            project_id=project_id,
            is_uploaded=True,
        )
        # Serialize the attachments
        serializer = IssueAttachmentSerializer(issue_attachments, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def patch(self, request, slug, project_id, issue_id, pk):
        """Finalize a presigned-upload by marking ``is_uploaded=True``.

        Enqueues ``issue_activity`` for the activity feed and
        ``get_asset_object_metadata`` for S3 metadata backfill (Celery
        via RabbitMQ). Safe to retry: the
        ``attachment.activity.created`` event fires only on the first
        finalize (when ``is_uploaded`` was ``False``).
        """
        issue_attachment = FileAsset.objects.get(pk=pk, workspace__slug=slug, project_id=project_id)
        serializer = IssueAttachmentSerializer(issue_attachment)

        # Send this activity only if the attachment is not uploaded before
        if not issue_attachment.is_uploaded:
            issue_activity.delay(
                type="attachment.activity.created",
                requested_data=None,
                actor_id=str(self.request.user.id),
                issue_id=str(self.kwargs.get("issue_id", None)),
                project_id=str(self.kwargs.get("project_id", None)),
                current_instance=json.dumps(serializer.data, cls=DjangoJSONEncoder),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )

            # Update the attachment
            issue_attachment.is_uploaded = True
            issue_attachment.created_by = request.user

        # Get the storage metadata
        if not issue_attachment.storage_metadata:
            get_asset_object_metadata.delay(str(issue_attachment.id))
        issue_attachment.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
