# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that builds issue exports (CSV / JSON / XLSX) and uploads them to S3.

Trigger: explicit ``.delay(provider, workspace_id, project_ids, token_id, multiple, slug)``
from ``apps/api/plane/app/views/exporter/base.py`` when a user requests an export.

Supported formats:
    - ``csv``
    - ``json``
    - ``xlsx`` (via ``openpyxl``)

Download URL: each export is published as an S3 presigned URL with a 7-day TTL, stored
on the corresponding ``ExporterHistory`` row. The paired task
``apps/api/plane/bgtasks/exporter_expired_task.py`` later sweeps expired URLs and
deletes the underlying S3 objects after 8 days.

Async infrastructure: queued onto RabbitMQ and consumed by Celery workers per the
``Celery via RabbitMQ`` architectural rule. Redis is caching/session only and is not
the task broker.

See tech spec section 4.10 ``EXPORT PIPELINE WORKFLOW``.
"""

# Python imports
import io
import zipfile
from typing import List
import boto3
from botocore.client import Config
from uuid import UUID

# Third party imports
from celery import shared_task

# Django imports
from django.conf import settings
from django.utils import timezone
from django.db.models import Prefetch

# Module imports
from plane.db.models import ExporterHistory, Issue, IssueComment, IssueRelation, IssueSubscriber
from plane.utils.exception_logger import log_exception
from plane.utils.porters.exporter import DataExporter
from plane.utils.porters.serializers.issue import IssueExportSerializer


def create_zip_file(files: List[tuple[str, str | bytes]]) -> io.BytesIO:
    """Build an in-memory ZIP archive from the provided ``(filename, content)`` tuples.

    Each tuple is written into the archive as a single entry using
    ``ZIP_DEFLATED`` compression. The returned ``BytesIO`` buffer is rewound
    to position 0 so callers can stream or upload it directly without an
    additional ``seek``.
    """
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zipf:
        for filename, file_content in files:
            zipf.writestr(filename, file_content)

    zip_buffer.seek(0)
    return zip_buffer


# TODO: Change the upload_to_s3 function to use the new storage method with entry in file asset table
def upload_to_s3(zip_file: io.BytesIO, workspace_id: UUID, token_id: str, slug: str) -> None:
    """Upload the ZIP buffer to S3 and persist a 7-day presigned download URL.

    The S3 key takes the form ``<workspace_id>/export-<slug>-<token_prefix>-<YYYY-MM-DD>.zip``
    and ``ExpiresIn`` is fixed at ``7 * 24 * 60 * 60`` seconds (7 days). The resulting
    presigned URL is written onto the ``ExporterHistory`` row matching ``token_id`` along
    with ``status="completed"`` and ``key=<s3_key>``; if URL generation fails the row is
    marked ``status="failed"``. On MinIO deployments two distinct boto3 clients are used:
    the upload targets the internal endpoint while a second client signs the URL against
    the public custom domain so the link remains reachable from browsers.
    """
    file_name = f"{workspace_id}/export-{slug}-{token_id[:6]}-{str(timezone.now().date())}.zip"
    expires_in = 7 * 24 * 60 * 60

    if settings.USE_MINIO:
        upload_s3 = boto3.client(
            "s3",
            endpoint_url=settings.AWS_S3_ENDPOINT_URL,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            config=Config(signature_version="s3v4"),
        )
        upload_s3.upload_fileobj(
            zip_file,
            settings.AWS_STORAGE_BUCKET_NAME,
            file_name,
            ExtraArgs={"ACL": "public-read", "ContentType": "application/zip"},
        )

        # Generate presigned url for the uploaded file with different base
        presign_s3 = boto3.client(
            "s3",
            endpoint_url=(
                f"{settings.AWS_S3_URL_PROTOCOL}//{str(settings.AWS_S3_CUSTOM_DOMAIN).replace('/uploads', '')}/"
            ),
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            config=Config(signature_version="s3v4"),
        )

        presigned_url = presign_s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.AWS_STORAGE_BUCKET_NAME, "Key": file_name},
            ExpiresIn=expires_in,
        )
    else:
        # If endpoint url is present, use it
        if settings.AWS_S3_ENDPOINT_URL:
            s3 = boto3.client(
                "s3",
                endpoint_url=settings.AWS_S3_ENDPOINT_URL,
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                config=Config(signature_version="s3v4"),
            )
        else:
            s3 = boto3.client(
                "s3",
                region_name=settings.AWS_REGION,
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                config=Config(signature_version="s3v4"),
            )

        # Upload the file to S3
        s3.upload_fileobj(
            zip_file,
            settings.AWS_STORAGE_BUCKET_NAME,
            file_name,
            ExtraArgs={"ContentType": "application/zip"},
        )

        # Generate presigned url for the uploaded file
        presigned_url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.AWS_STORAGE_BUCKET_NAME, "Key": file_name},
            ExpiresIn=expires_in,
        )

    exporter_instance = ExporterHistory.objects.get(token=token_id)

    # Update the exporter instance with the presigned url
    if presigned_url:
        exporter_instance.url = presigned_url
        exporter_instance.status = "completed"
        exporter_instance.key = file_name
    else:
        exporter_instance.status = "failed"

    exporter_instance.save(update_fields=["status", "url", "key"])


@shared_task
def issue_export_task(
    provider: str,
    workspace_id: UUID,
    project_ids: List[str],
    token_id: str,
    multiple: bool,
    slug: str,
):
    """Build an issue export file in ``provider`` format and upload it to S3 with a 7-day presigned URL.

    Trigger:
        Explicit ``issue_export_task.delay(provider=..., workspace_id=...,
        project_ids=..., token_id=..., multiple=..., slug=...)`` from
        ``apps/api/plane/app/views/exporter/base.py`` when a user requests an
        export. The Celery message is routed via RabbitMQ and consumed by a
        worker; Redis is caching/session only and is not the broker.

    Side effects:
        - DB read: ``Issue`` rows for the requested ``project_ids`` within
          ``workspace_id``, restricted to projects the initiating user is an
          active member of and that are not archived. Eager-loads ``project``,
          ``workspace``, ``state``, ``created_by``, and ``estimate_point``;
          prefetches ``labels``, ``issue_cycle__cycle``, ``issue_module__module``,
          ``assignees``, ``issue_link``, ``issue_subscribers``, ``issue_comments``,
          ``issue_relation``, ``issue_related``, and ``parent``.
        - Serialization: ``IssueExportSerializer`` (via the shared
          ``DataExporter``) produces dict rows.
        - In-memory file build: ``DataExporter`` emits CSV / JSON / XLSX content
          per ``provider``. When ``multiple=True`` one file per project is built;
          all files are bundled into a single ZIP by :func:`create_zip_file`.
        - S3 upload: the ZIP is uploaded by :func:`upload_to_s3` to the
          configured S3-compatible bucket (AWS S3 or MinIO); the key includes
          ``workspace_id``, ``slug``, the leading 6 chars of ``token_id``, and
          the current UTC date.
        - DB write: the ``ExporterHistory`` row matching ``token_id`` is set to
          ``status="processing"`` on entry; on success its ``url``, ``key``, and
          ``status="completed"`` are written by :func:`upload_to_s3`. If
          ``DataExporter`` raises ``ValueError`` for an unknown ``provider`` —
          or any other exception is raised during export — the row is marked
          ``status="failed"`` with ``reason`` set to the exception message and
          ``log_exception`` is invoked.
        - No emails are sent directly (the UI polls ``ExporterHistory`` and
          surfaces the URL); no webhook fan-out; no cache invalidation.

    Idempotency:
        NON-idempotent. Each invocation generates a new file with a
        date-stamped S3 key; repeated calls produce orphan S3 objects that
        ``apps/api/plane/bgtasks/exporter_expired_task.py`` sweeps after 8
        days.

    Args:
        provider: One of ``"csv"``, ``"json"``, ``"xlsx"`` (validated by
            ``DataExporter``; unknown values mark the export ``"failed"``).
        workspace_id: Workspace primary key.
        project_ids: Project primary keys to include in the export.
        token_id: ``ExporterHistory`` row token used to track this export;
            ``url``, ``key``, ``status``, and ``reason`` are written back on
            completion.
        multiple: When ``True``, exports one file per project bundled together
            into a single ZIP; when ``False``, exports a single combined file
            spanning all requested projects.
        slug: Workspace slug used as part of the S3 key prefix and the export
            filename.

    See tech spec section 4.10 ``EXPORT PIPELINE WORKFLOW``.
    """
    try:
        exporter_instance = ExporterHistory.objects.get(token=token_id)
        exporter_instance.status = "processing"
        exporter_instance.save(update_fields=["status"])

        # Build base queryset for issues
        workspace_issues = (
            Issue.objects.filter(
                workspace__id=workspace_id,
                project_id__in=project_ids,
                project__project_projectmember__member=exporter_instance.initiated_by_id,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related(
                "project",
                "workspace",
                "state",
                "created_by",
                "estimate_point",
            )
            .prefetch_related(
                "labels",
                "issue_cycle__cycle",
                "issue_module__module",
                "assignees",
                "issue_link",
                Prefetch(
                    "issue_subscribers",
                    queryset=IssueSubscriber.objects.select_related("subscriber"),
                ),
                Prefetch(
                    "issue_comments",
                    queryset=IssueComment.objects.select_related("actor").order_by("created_at"),
                ),
                Prefetch(
                    "issue_relation",
                    queryset=IssueRelation.objects.select_related("related_issue", "related_issue__project"),
                ),
                Prefetch(
                    "issue_related",
                    queryset=IssueRelation.objects.select_related("issue", "issue__project"),
                ),
                Prefetch(
                    "parent",
                    queryset=Issue.objects.select_related("type", "project"),
                ),
            )
        )

        # Create exporter for the specified format
        try:
            exporter = DataExporter(IssueExportSerializer, format_type=provider)
        except ValueError as e:
            # Invalid format type
            exporter_instance = ExporterHistory.objects.get(token=token_id)
            exporter_instance.status = "failed"
            exporter_instance.reason = str(e)
            exporter_instance.save(update_fields=["status", "reason"])
            return

        files = []
        if multiple:
            # Export each project separately with its own queryset
            for project_id in project_ids:
                project_issues = workspace_issues.filter(project_id=project_id)
                export_filename = f"{slug}-{project_id}"
                filename, content = exporter.export(export_filename, project_issues)
                files.append((filename, content))
        else:
            # Export all issues in a single file
            export_filename = f"{slug}-{workspace_id}"
            filename, content = exporter.export(export_filename, workspace_issues)
            files.append((filename, content))

        zip_buffer = create_zip_file(files)
        upload_to_s3(zip_buffer, workspace_id, token_id, slug)

    except Exception as e:
        exporter_instance = ExporterHistory.objects.get(token=token_id)
        exporter_instance.status = "failed"
        exporter_instance.reason = str(e)
        exporter_instance.save(update_fields=["status", "reason"])
        log_exception(e)
        return
