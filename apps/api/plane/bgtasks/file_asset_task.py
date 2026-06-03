# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery Beat task that sweeps ``FileAsset`` rows for incomplete uploads.

Defines :func:`delete_unuploaded_file_asset`, the daily cleanup task that
removes ``FileAsset`` database rows whose presigned upload was never
finalized (``is_uploaded=False``) past the configured retention window.

Beat schedule:
    Declared in ``apps/api/plane/celery.py:L117-L120`` under the key
    ``"check-every-day-to-delete-file-asset"`` and runs at ``02:00 UTC``
    daily.

Retention window:
    Controlled by the ``UNUPLOADED_ASSET_DELETE_DAYS`` environment
    variable (default ``7``), read inline at task execution time so a
    worker restart picks up changes without a code edit.

Async infrastructure:
    Messages are queued onto **RabbitMQ** and consumed by Celery workers
    (per the project-wide "Celery via RabbitMQ" architectural rule).
    Redis is **not** the task broker -- it is reserved for caching and
    session storage.

See tech spec section 4.4 FILE UPLOAD WORKFLOW for the full upload
lifecycle (presigned POST -> client upload -> finalize PATCH -> orphan
cleanup).
"""

# Python imports
import os
from datetime import timedelta

# Django imports
from django.utils import timezone
from django.db.models import Q

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import FileAsset


@shared_task
def delete_unuploaded_file_asset():
    """Soft-delete ``FileAsset`` rows older than ``UNUPLOADED_ASSET_DELETE_DAYS`` whose upload never completed.

    Trigger:
        Celery Beat schedule entry ``"check-every-day-to-delete-file-asset"``
        declared in ``apps/api/plane/celery.py:L117-L120``, scheduled via
        ``crontab(hour=2, minute=0)`` to fire daily at ``02:00 UTC``. No
        signal handler and no explicit ``.delay()`` / ``.apply_async()``
        call site references this task -- Beat is the sole producer.
        Messages are routed via **RabbitMQ** and consumed by the Celery
        worker (Redis is cache / session only, not the broker).

    Side effects:
        - **DB write (soft delete)**: issues
          ``FileAsset.objects.filter(created_at__lt=now -
          timedelta(days=N), is_uploaded=False).delete()`` where ``N``
          resolves from the ``UNUPLOADED_ASSET_DELETE_DAYS`` env var
          (default ``7``). Because ``FileAsset`` inherits the
          ``SoftDeletionManager`` from
          ``plane.db.mixins.SoftDeleteModel``, the bulk ``.delete()``
          call short-circuits to ``UPDATE file_assets SET deleted_at =
          NOW() WHERE ...`` and the rows remain physically present in
          the table -- they simply become invisible to the default
          manager.
        - **No S3 / MinIO delete**: ``is_uploaded=False`` means the
          client never confirmed the presigned upload, so no object is
          expected to exist in the bucket; this task therefore never
          calls ``S3.delete_object``. Genuinely orphaned objects from a
          client that uploaded bytes but never issued the finalize
          PATCH are out of scope for this sweeper.
        - **No** emails, **no** webhook fan-out, **no** cache
          invalidation.

    Idempotency:
        IDEMPOTENT. The ``created_at__lt`` predicate is monotonic in
        time and the default manager filters out any row whose
        ``deleted_at`` was stamped by a previous run; subsequent
        invocations on the same wall-clock day therefore find no
        matching rows and short-circuit to a no-op.
    """
    FileAsset.objects.filter(
        Q(created_at__lt=timezone.now() - timedelta(days=int(os.environ.get("UNUPLOADED_ASSET_DELETE_DAYS", "7"))))
        & Q(is_uploaded=False)
    ).delete()
