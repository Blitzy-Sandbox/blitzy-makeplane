# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery Beat task that expires export download links older than 8 days.

Defines :func:`delete_old_s3_link`, the daily sweeper that removes stale
objects from the S3 / MinIO export bucket and clears the corresponding
``ExporterHistory.url`` column. The 8-day retention is hard-coded in the
task body.

Beat schedule (dual, defensive — declared in ``apps/api/plane/celery.py``):
    - ``"check-every-day-to-delete_exporter_history"`` at ``01:30 UTC``
      (``apps/api/plane/celery.py:L113-L116``).
    - ``"check-every-day-to-delete-exporter-history"`` at ``03:45 UTC``
      (``apps/api/plane/celery.py:L141-L144``).

Async infrastructure: tasks are queued onto **RabbitMQ** and consumed by
Celery workers. Redis is **not** the task broker — it is used only for
caching and session storage.

See tech spec §4.10 EXPORT PIPELINE WORKFLOW.
"""

# Python imports
import boto3
from datetime import timedelta

# Django imports
from django.conf import settings
from django.utils import timezone
from django.db.models import Q

# Third party imports
from celery import shared_task
from botocore.client import Config

# Module imports
from plane.db.models import ExporterHistory


@shared_task
def delete_old_s3_link():
    """Delete S3 export files older than 8 days and null the corresponding ``ExporterHistory.url``.

    Trigger:
        Celery Beat — two daily entries in ``apps/api/plane/celery.py``
        both target this task:
        ``"check-every-day-to-delete_exporter_history"`` at ``01:30 UTC``
        and ``"check-every-day-to-delete-exporter-history"`` at
        ``03:45 UTC``. The dual schedule is defensive — the second sweep
        catches rows the first run may have skipped (e.g. due to S3
        transient errors). Celery routes the messages via **RabbitMQ**;
        Redis is cache / session only.

    Side effects:
        - **S3 DELETE**: for each ``ExporterHistory`` row with ``url``
          set and ``created_at <= now - 8 days``, a fresh
          ``boto3.client("s3", ...)`` is built (the MinIO branch when
          ``settings.USE_MINIO`` is truthy, the AWS branch otherwise) and
          ``delete_object`` is invoked against
          ``settings.AWS_STORAGE_BUCKET_NAME`` using the row's stored
          ``key`` column as the object identifier.
        - **DB write**: ``ExporterHistory.objects.filter(id=exporter_id)
          .update(url=None)`` is issued once per swept row. The
          ``ExporterHistory`` row itself is retained so the export
          attempt remains visible in user history — only the download
          URL is invalidated.
        - **No** emails, **no** webhook fan-out, **no** cache
          invalidation.

    Idempotency:
        IDEMPOTENT. Once a row's ``url`` is set to ``None`` the filter
        ``url__isnull=False`` excludes it on subsequent runs. S3
        ``DeleteObject`` is itself idempotent — deleting a missing key
        is a no-op.
    """
    # Get a list of keys and IDs to process
    expired_exporter_history = ExporterHistory.objects.filter(
        Q(url__isnull=False) & Q(created_at__lte=timezone.now() - timedelta(days=8))
    ).values_list("key", "id")
    if settings.USE_MINIO:
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

    for file_name, exporter_id in expired_exporter_history:
        # Delete object from S3
        if file_name:
            if settings.USE_MINIO:
                s3.delete_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=file_name)
            else:
                s3.delete_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=file_name)

        ExporterHistory.objects.filter(id=exporter_id).update(url=None)
