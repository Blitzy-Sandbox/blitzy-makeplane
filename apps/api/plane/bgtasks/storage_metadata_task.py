# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that backfills S3 object metadata onto ``FileAsset`` records.

Defines :func:`get_asset_object_metadata`, the post-upload hook that fetches
storage-side metadata (size, content-type, etag, last-modified, etc.) from
the configured S3-compatible object store and persists it onto the
``FileAsset`` row's ``storage_metadata`` JSON column.

Trigger:
    Explicit ``get_asset_object_metadata.delay(asset_id=...)`` from asset
    upload completion endpoints in ``apps/api/plane/app/views/asset/v2.py``,
    ``apps/api/plane/api/views/asset.py``, and
    ``apps/api/plane/api/views/issue.py``. The task is **not** registered on
    the Celery Beat schedule -- invocation is purely explicit.

Async infrastructure:
    Messages are queued onto **RabbitMQ** and consumed by Celery workers
    (per the project-wide "Celery via RabbitMQ" architectural rule).
    Redis is **not** the task broker -- it is reserved for caching and
    session storage.

See also: ``apps/api/plane/bgtasks/file_asset_task.py`` for the daily Beat
sweep that deletes ``FileAsset`` rows whose presigned upload never
finalized (``is_uploaded=False``).
"""

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import FileAsset
from plane.settings.storage import S3Storage
from plane.utils.exception_logger import log_exception


@shared_task
def get_asset_object_metadata(asset_id):
    """Fetch S3 object metadata for ``asset_id`` and persist it onto ``FileAsset.storage_metadata``.

    Trigger:
        Explicit ``get_asset_object_metadata.delay(asset_id=...)`` from
        the asset upload completion endpoints in
        ``apps/api/plane/app/views/asset/v2.py``,
        ``apps/api/plane/api/views/asset.py``, and
        ``apps/api/plane/api/views/issue.py`` after the client signals
        a successful S3 PUT. The Celery message is routed via
        **RabbitMQ** and consumed by the worker; this task is not on
        the Beat schedule.

    Side effects:
        - **External read**:
          ``S3Storage().get_object_metadata(object_name=asset.asset.name)``
          issues a ``HeadObject`` (or its S3-compatible equivalent)
          against the configured object store and returns a metadata
          dict (``ContentType``, ``ContentLength``, ``LastModified``,
          ``ETag``, ``Metadata``). Returns ``None`` on the underlying
          ``ClientError`` path, in which case ``storage_metadata`` is
          overwritten with ``None``.
        - **DB write**: ``asset.storage_metadata = metadata`` followed
          by ``asset.save(update_fields=["storage_metadata"])``
          persists the metadata dict onto the ``FileAsset`` row via a
          narrow column update so unrelated columns are untouched.
        - **No** emails, **no** webhook fan-out, **no** cache
          invalidation.

    Idempotency:
        IDEMPOTENT. Repeated invocations re-fetch the same metadata
        from S3 and overwrite ``storage_metadata`` with the same dict
        (modulo S3 ``ETag`` / ``LastModified`` changes if the
        underlying object was replaced). Safe to retry.

    Error handling:
        - ``FileAsset.DoesNotExist`` is silently swallowed -- the row
          was deleted between the ``.delay()`` enqueue and the worker
          pick-up; there is nothing to backfill.
        - Any other ``Exception`` is forwarded to
          ``plane.utils.exception_logger.log_exception`` and swallowed
          so a transient S3 / DB error does not crash the Celery
          worker.

    Args:
        asset_id: Primary key of the ``FileAsset`` whose S3 object
            metadata should be synced.
    """
    try:
        # Get the asset
        asset = FileAsset.objects.get(pk=asset_id)
        # Create an instance of the S3 storage
        storage = S3Storage()
        # Get the storage
        asset.storage_metadata = storage.get_object_metadata(object_name=asset.asset.name)
        # Save the asset
        asset.save(update_fields=["storage_metadata"])
        return
    except FileAsset.DoesNotExist:
        return
    except Exception as e:
        log_exception(e)
        return
