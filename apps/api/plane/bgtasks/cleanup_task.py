# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery Beat tasks for the daily PostgreSQL to MongoDB archive and hard-delete cleanup sweeps.

Five distinct retention sweeps run sequentially each night from
``02:30 UTC`` to ``03:30 UTC`` (schedule defined in
``apps/api/plane/celery.py:L56-L75``):

    +--------+---------------------------------------+------------------------------+
    |  Time  | Beat task                             | Target model                 |
    +========+=======================================+==============================+
    | 02:30  | ``delete_api_logs``                   | ``APIActivityLog``           |
    | 02:45  | ``delete_email_notification_logs``    | ``EmailNotificationLog``     |
    | 03:00  | ``delete_page_versions``              | ``PageVersion``              |
    | 03:15  | ``delete_issue_description_versions`` | ``IssueDescriptionVersion``  |
    | 03:30  | ``delete_webhook_logs``               | ``WebhookLog``               |
    +--------+---------------------------------------+------------------------------+

Retention rules:
    - ``HARD_DELETE_AFTER_DAYS`` (environment variable, default ``30``):
      log rows older than this many days are eligible for deletion.
      Resolved inline in each ``get_*_logs_queryset`` helper rather than
      exported as a module constant.
    - ``BATCH_SIZE = 500``: rows processed per batch when flushing
      buffered records to MongoDB and deleting from PostgreSQL.
    - Page and Issue description versions: KEEP the latest ``20`` per
      parent (via the ``RowNumber()`` window function partitioned by
      ``page_id`` / ``issue_id`` and ordered by ``created_at DESC`` --
      any row with ``row_num > 20`` is swept). The cap is fixed and
      independent of ``HARD_DELETE_AFTER_DAYS``.
    - Webhook logs: queryset iterator uses ``chunk_size=100`` because
      webhook log rows carry larger payloads (request/response headers
      and bodies) than the other log models.

Generic archive pattern:
    ``process_cleanup_task()`` is the shared helper used by all five
    Beat tasks. When ``MongoConnection.is_configured()`` returns
    ``True``, eligible rows are bulk-inserted into a MongoDB archive
    collection BEFORE being hard-deleted from PostgreSQL. When MongoDB
    is not configured, rows are simply hard-deleted with no archive
    side effect. If a MongoDB bulk-insert fails, the corresponding
    PostgreSQL delete is skipped for that batch so the rows can be
    retried on the next run (see ``flush_to_mongo_and_delete``).

Async infrastructure:
    Tasks are enqueued onto **RabbitMQ** by Celery Beat and consumed by
    Celery workers. Redis is used for caching and sessions only and is
    never the task broker (per the project architectural contract).

See tech spec section 4.12 -- DATA CLEANUP AND RETENTION WORKFLOWS.
"""

# Python imports
from datetime import timedelta
import logging
from typing import List, Dict, Any, Callable, Optional
import os

# Django imports
from django.utils import timezone
from django.db.models import F, Window, Subquery
from django.db.models.functions import RowNumber

# Third party imports
from celery import shared_task
from pymongo.errors import BulkWriteError
from pymongo.collection import Collection
from pymongo.operations import InsertOne

# Module imports
from plane.db.models import (
    EmailNotificationLog,
    PageVersion,
    APIActivityLog,
    IssueDescriptionVersion,
    WebhookLog,
)
from plane.settings.mongo import MongoConnection
from plane.utils.exception_logger import log_exception


logger = logging.getLogger("plane.worker")
BATCH_SIZE = 500


def get_mongo_collection(collection_name: str) -> Optional[Collection]:
    """Get MongoDB collection if available, otherwise return None."""
    if not MongoConnection.is_configured():
        logger.info("MongoDB not configured")
        return None

    try:
        mongo_collection = MongoConnection.get_collection(collection_name)
        logger.info(f"MongoDB collection '{collection_name}' connected successfully")
        return mongo_collection
    except Exception as e:
        logger.error(f"Failed to get MongoDB collection: {str(e)}")
        log_exception(e)
        return None


def flush_to_mongo_and_delete(
    mongo_collection: Optional[Collection],
    buffer: List[Dict[str, Any]],
    ids_to_delete: List[int],
    model,
    mongo_available: bool,
) -> None:
    """Insert a batch of records into MongoDB and delete the corresponding rows from PostgreSQL."""
    if not buffer:
        logger.debug("No records to flush - buffer is empty")
        return

    logger.info(f"Starting batch flush: {len(buffer)} records, {len(ids_to_delete)} IDs to delete")

    mongo_archival_failed = False

    # Try to insert into MongoDB if available
    if mongo_collection is not None and mongo_available:
        try:
            mongo_collection.bulk_write([InsertOne(doc) for doc in buffer])
        except BulkWriteError as bwe:
            logger.error(f"MongoDB bulk write error: {str(bwe)}")
            log_exception(bwe)
            mongo_archival_failed = True

    # If MongoDB is available and archival failed, log the error and return
    if mongo_available and mongo_archival_failed:
        logger.error(f"MongoDB archival failed for {len(buffer)} records")
        return

    # Delete from PostgreSQL - delete() returns (count, {model: count})
    delete_result = model.all_objects.filter(id__in=ids_to_delete).delete()
    deleted_count = delete_result[0] if delete_result and isinstance(delete_result, tuple) else 0
    logger.info(f"Batch flush completed: {deleted_count} records deleted")


def process_cleanup_task(
    queryset_func: Callable,
    transform_func: Callable[[Dict], Dict],
    model,
    task_name: str,
    collection_name: str,
):
    """Run the generic archive-then-delete pattern shared by all five cleanup tasks.

    For each batch of size ``BATCH_SIZE`` produced by ``queryset_func``:
        1. If ``MongoConnection.is_configured()`` returns ``True``,
           apply ``transform_func`` to convert each PostgreSQL row dict
           into a MongoDB document and bulk-insert into the configured
           archive collection (``collection_name``).
        2. Hard-delete the same row set from PostgreSQL via
           ``model.all_objects.filter(id__in=...).delete()``.

    When MongoDB is not configured, step 1 is skipped and rows are
    hard-deleted without an archive side effect. When MongoDB IS
    configured but the bulk-insert fails, the PostgreSQL delete for
    that batch is skipped so the rows can be retried on the next run.

    Args:
        queryset_func: Callable returning the queryset (already chunked
            via ``.iterator(chunk_size=...)``) of eligible rows. The
            queryset yields ``dict`` rows produced by ``.values(...)``.
        transform_func: Callable converting one PostgreSQL row dict
            into the MongoDB document dict to archive.
        model: Django model class whose rows are being cleaned (e.g.
            ``APIActivityLog``, ``PageVersion``). Must expose
            ``all_objects`` so soft-deleted rows are also reachable.
        task_name: Human-readable name used for log output only.
        collection_name: Name of the MongoDB collection used as the
            archive destination when MongoDB is configured.
    """
    logger.info(f"Starting {task_name} cleanup task")

    # Get MongoDB collection
    mongo_collection = get_mongo_collection(collection_name)
    mongo_available = mongo_collection is not None

    # Get queryset
    queryset = queryset_func()

    # Process records in batches
    buffer: List[Dict[str, Any]] = []
    ids_to_delete: List[int] = []
    total_processed = 0
    total_batches = 0

    for record in queryset:
        # Transform record for MongoDB
        buffer.append(transform_func(record))
        ids_to_delete.append(record["id"])

        # Flush batch when it reaches BATCH_SIZE
        if len(buffer) >= BATCH_SIZE:
            total_batches += 1
            flush_to_mongo_and_delete(
                mongo_collection=mongo_collection,
                buffer=buffer,
                ids_to_delete=ids_to_delete,
                model=model,
                mongo_available=mongo_available,
            )
            total_processed += len(buffer)
            buffer.clear()
            ids_to_delete.clear()

    # Process final batch if any records remain
    if buffer:
        total_batches += 1
        flush_to_mongo_and_delete(
            mongo_collection=mongo_collection,
            buffer=buffer,
            ids_to_delete=ids_to_delete,
            model=model,
            mongo_available=mongo_available,
        )
        total_processed += len(buffer)

    logger.info(
        f"{task_name} cleanup task completed",
        extra={
            "total_records_processed": total_processed,
            "total_batches": total_batches,
            "mongo_available": mongo_available,
            "collection_name": collection_name,
        },
    )


# Transform functions for each model
def transform_api_log(record: Dict) -> Dict:
    """Transform API activity log record."""
    return {
        "id": str(record["id"]),
        "created_at": str(record["created_at"]) if record.get("created_at") else None,
        "token_identifier": str(record["token_identifier"]),
        "path": record["path"],
        "method": record["method"],
        "query_params": record.get("query_params"),
        "headers": record.get("headers"),
        "body": record.get("body"),
        "response_code": record["response_code"],
        "response_body": record["response_body"],
        "ip_address": record["ip_address"],
        "user_agent": record["user_agent"],
        "created_by_id": str(record["created_by_id"]),
    }


def transform_email_log(record: Dict) -> Dict:
    """Transform email notification log record."""
    return {
        "id": str(record["id"]),
        "created_at": str(record["created_at"]) if record.get("created_at") else None,
        "receiver_id": str(record["receiver_id"]),
        "triggered_by_id": str(record["triggered_by_id"]),
        "entity_identifier": str(record["entity_identifier"]),
        "entity_name": record["entity_name"],
        "data": record["data"],
        "processed_at": (str(record["processed_at"]) if record.get("processed_at") else None),
        "sent_at": str(record["sent_at"]) if record.get("sent_at") else None,
        "entity": record["entity"],
        "old_value": str(record["old_value"]),
        "new_value": str(record["new_value"]),
        "created_by_id": str(record["created_by_id"]),
    }


def transform_page_version(record: Dict) -> Dict:
    """Transform page version record."""
    return {
        "id": str(record["id"]),
        "created_at": str(record["created_at"]) if record.get("created_at") else None,
        "page_id": str(record["page_id"]),
        "workspace_id": str(record["workspace_id"]),
        "owned_by_id": str(record["owned_by_id"]),
        "description_html": record["description_html"],
        "description_binary": record["description_binary"],
        "description_stripped": record["description_stripped"],
        "description_json": record["description_json"],
        "sub_pages_data": record["sub_pages_data"],
        "created_by_id": str(record["created_by_id"]),
        "updated_by_id": str(record["updated_by_id"]),
        "deleted_at": str(record["deleted_at"]) if record.get("deleted_at") else None,
        "last_saved_at": (str(record["last_saved_at"]) if record.get("last_saved_at") else None),
    }


def transform_issue_description_version(record: Dict) -> Dict:
    """Transform issue description version record."""
    return {
        "id": str(record["id"]),
        "created_at": str(record["created_at"]) if record.get("created_at") else None,
        "issue_id": str(record["issue_id"]),
        "workspace_id": str(record["workspace_id"]),
        "project_id": str(record["project_id"]),
        "created_by_id": str(record["created_by_id"]),
        "updated_by_id": str(record["updated_by_id"]),
        "owned_by_id": str(record["owned_by_id"]),
        "last_saved_at": (str(record["last_saved_at"]) if record.get("last_saved_at") else None),
        "description_binary": record["description_binary"],
        "description_html": record["description_html"],
        "description_stripped": record["description_stripped"],
        "description_json": record["description_json"],
        "deleted_at": str(record["deleted_at"]) if record.get("deleted_at") else None,
    }


def transform_webhook_log(record: Dict):
    """Transfer webhook logs to a new destination."""
    return {
        "id": str(record["id"]),
        "created_at": str(record["created_at"]) if record.get("created_at") else None,
        "workspace_id": str(record["workspace_id"]),
        "webhook": str(record["webhook"]),
        # Request
        "event_type": str(record["event_type"]),
        "request_method": str(record["request_method"]),
        "request_headers": str(record["request_headers"]),
        "request_body": str(record["request_body"]),
        # Response
        "response_status": str(record["response_status"]),
        "response_body": str(record["response_body"]),
        "response_headers": str(record["response_headers"]),
        # retry count
        "retry_count": str(record["retry_count"]),
    }


# Queryset functions for each cleanup task
def get_api_logs_queryset():
    """Get API logs older than cutoff days."""
    cutoff_days = int(os.environ.get("HARD_DELETE_AFTER_DAYS", 30))
    cutoff_time = timezone.now() - timedelta(days=cutoff_days)
    logger.info(f"API logs cutoff time: {cutoff_time}")

    return (
        APIActivityLog.all_objects.filter(created_at__lte=cutoff_time)
        .values(
            "id",
            "created_at",
            "token_identifier",
            "path",
            "method",
            "query_params",
            "headers",
            "body",
            "response_code",
            "response_body",
            "ip_address",
            "user_agent",
            "created_by_id",
        )
        .iterator(chunk_size=BATCH_SIZE)
    )


def get_email_logs_queryset():
    """Get email logs older than cutoff days."""
    cutoff_days = int(os.environ.get("HARD_DELETE_AFTER_DAYS", 30))
    cutoff_time = timezone.now() - timedelta(days=cutoff_days)
    logger.info(f"Email logs cutoff time: {cutoff_time}")

    return (
        EmailNotificationLog.all_objects.filter(sent_at__lte=cutoff_time)
        .values(
            "id",
            "created_at",
            "receiver_id",
            "triggered_by_id",
            "entity_identifier",
            "entity_name",
            "data",
            "processed_at",
            "sent_at",
            "entity",
            "old_value",
            "new_value",
            "created_by_id",
        )
        .iterator(chunk_size=BATCH_SIZE)
    )


def get_page_versions_queryset():
    """Get page versions beyond the maximum allowed (20 per page)."""
    subq = (
        PageVersion.all_objects.annotate(
            row_num=Window(
                expression=RowNumber(),
                partition_by=[F("page_id")],
                order_by=F("created_at").desc(),
            )
        )
        .filter(row_num__gt=20)
        .values("id")
    )

    return (
        PageVersion.all_objects.filter(id__in=Subquery(subq))
        .values(
            "id",
            "created_at",
            "page_id",
            "workspace_id",
            "owned_by_id",
            "description_html",
            "description_binary",
            "description_stripped",
            "description_json",
            "sub_pages_data",
            "created_by_id",
            "updated_by_id",
            "deleted_at",
            "last_saved_at",
        )
        .iterator(chunk_size=BATCH_SIZE)
    )


def get_issue_description_versions_queryset():
    """Get issue description versions beyond the maximum allowed (20 per issue)."""
    subq = (
        IssueDescriptionVersion.all_objects.annotate(
            row_num=Window(
                expression=RowNumber(),
                partition_by=[F("issue_id")],
                order_by=F("created_at").desc(),
            )
        )
        .filter(row_num__gt=20)
        .values("id")
    )

    return (
        IssueDescriptionVersion.all_objects.filter(id__in=Subquery(subq))
        .values(
            "id",
            "created_at",
            "issue_id",
            "workspace_id",
            "project_id",
            "created_by_id",
            "updated_by_id",
            "owned_by_id",
            "last_saved_at",
            "description_binary",
            "description_html",
            "description_stripped",
            "description_json",
            "deleted_at",
        )
        .iterator(chunk_size=BATCH_SIZE)
    )


def get_webhook_logs_queryset():
    """Get email logs older than cutoff days."""
    cutoff_days = int(os.environ.get("HARD_DELETE_AFTER_DAYS", 30))
    cutoff_time = timezone.now() - timedelta(days=cutoff_days)
    logger.info(f"Webhook logs cutoff time: {cutoff_time}")

    return (
        WebhookLog.all_objects.filter(created_at__lte=cutoff_time)
        .values(
            "id",
            "created_at",
            "workspace_id",
            "webhook",
            "event_type",
            # Request
            "request_method",
            "request_headers",
            "request_body",
            # Response
            "response_status",
            "response_body",
            "response_headers",
            "retry_count",
        )
        .order_by("created_at")
        .iterator(chunk_size=100)
    )


@shared_task
def delete_api_logs():
    """Sweep ``APIActivityLog`` rows older than ``HARD_DELETE_AFTER_DAYS`` (default ``30``).

    Trigger:
        Celery Beat schedule entry
        ``check-every-day-to-delete-api-logs`` scheduled at
        ``02:30 UTC`` daily, defined in
        ``apps/api/plane/celery.py:L56-L59``. The Celery message is
        routed via **RabbitMQ** and consumed by a worker.

    Side effects:
        * **MongoDB archive** (when ``MongoConnection.is_configured()``
          returns ``True``): bulk-inserts the eligible rows into the
          ``api_activity_logs`` archive collection via
          ``process_cleanup_task()``.
        * **PostgreSQL hard-delete**: batched delete with
          ``BATCH_SIZE = 500`` rows per iteration.
        * **No** emails, **no** webhook fan-out, **no** cache
          invalidation.

    Idempotency:
        Idempotent. The monotonic ``created_at <= now - N days`` filter
        ensures that subsequent runs find zero remaining matches once a
        row has been archived and deleted.
    """
    process_cleanup_task(
        queryset_func=get_api_logs_queryset,
        transform_func=transform_api_log,
        model=APIActivityLog,
        task_name="API Activity Log",
        collection_name="api_activity_logs",
    )


@shared_task
def delete_email_notification_logs():
    """Sweep ``EmailNotificationLog`` rows older than ``HARD_DELETE_AFTER_DAYS`` (default ``30``).

    Trigger:
        Celery Beat schedule entry
        ``check-every-day-to-delete-email-notification-logs`` scheduled
        at ``02:45 UTC`` daily, defined in
        ``apps/api/plane/celery.py:L60-L63``. The Celery message is
        routed via **RabbitMQ** and consumed by a worker.

    Side effects:
        * **MongoDB archive** (when ``MongoConnection.is_configured()``
          returns ``True``): bulk-inserts the eligible rows into the
          ``email_notification_logs`` archive collection via
          ``process_cleanup_task()``.
        * **PostgreSQL hard-delete**: batched delete with
          ``BATCH_SIZE = 500`` rows per iteration.
        * **No** outbound emails are sent by this sweep itself (it
          deletes the post-delivery LOG rows). **No** webhook fan-out.
          **No** cache invalidation.

    Idempotency:
        Idempotent. The monotonic ``sent_at <= now - N days`` filter
        ensures that subsequent runs find zero remaining matches once a
        row has been archived and deleted.
    """
    process_cleanup_task(
        queryset_func=get_email_logs_queryset,
        transform_func=transform_email_log,
        model=EmailNotificationLog,
        task_name="Email Notification Log",
        collection_name="email_notification_logs",
    )


@shared_task
def delete_page_versions():
    """Cap each page at the latest 20 ``PageVersion`` rows; archive and delete older versions.

    Trigger:
        Celery Beat schedule entry
        ``check-every-day-to-delete-page-versions`` scheduled at
        ``03:00 UTC`` daily, defined in
        ``apps/api/plane/celery.py:L64-L67``. The Celery message is
        routed via **RabbitMQ** and consumed by a worker.

    Side effects:
        * **DB read**: uses
          ``RowNumber() OVER (PARTITION BY page_id ORDER BY created_at DESC)``
          to assign a per-page rank, then selects rows where
          ``row_num > 20``.
        * **MongoDB archive** (when ``MongoConnection.is_configured()``
          returns ``True``): bulk-inserts the swept rows into the
          ``page_versions`` archive collection via
          ``process_cleanup_task()``.
        * **PostgreSQL hard-delete**: batched delete with
          ``BATCH_SIZE = 500`` rows per iteration.
        * **No** emails, **no** webhook fan-out, **no** cache
          invalidation.

    Idempotency:
        Idempotent. The cap is stable; subsequent runs find no rows
        beyond the latest 20 per page unless new versions are written
        between runs.
    """
    process_cleanup_task(
        queryset_func=get_page_versions_queryset,
        transform_func=transform_page_version,
        model=PageVersion,
        task_name="Page Version",
        collection_name="page_versions",
    )


@shared_task
def delete_issue_description_versions():
    """Cap each issue at the latest 20 ``IssueDescriptionVersion`` rows; archive and delete older versions.

    Trigger:
        Celery Beat schedule entry
        ``check-every-day-to-delete-issue-description-versions``
        scheduled at ``03:15 UTC`` daily, defined in
        ``apps/api/plane/celery.py:L68-L71``. The Celery message is
        routed via **RabbitMQ** and consumed by a worker.

    Side effects:
        * **DB read**: uses
          ``RowNumber() OVER (PARTITION BY issue_id ORDER BY created_at DESC)``
          to assign a per-issue rank, then selects rows where
          ``row_num > 20``.
        * **MongoDB archive** (when ``MongoConnection.is_configured()``
          returns ``True``): bulk-inserts the swept rows into the
          ``issue_description_versions`` archive collection via
          ``process_cleanup_task()``.
        * **PostgreSQL hard-delete**: batched delete with
          ``BATCH_SIZE = 500`` rows per iteration.
        * **No** emails, **no** webhook fan-out, **no** cache
          invalidation.

    Idempotency:
        Idempotent. The cap is stable; subsequent runs find no rows
        beyond the latest 20 per issue unless new versions are written
        between runs.
    """
    process_cleanup_task(
        queryset_func=get_issue_description_versions_queryset,
        transform_func=transform_issue_description_version,
        model=IssueDescriptionVersion,
        task_name="Issue Description Version",
        collection_name="issue_description_versions",
    )


@shared_task
def delete_webhook_logs():
    """Sweep ``WebhookLog`` rows older than ``HARD_DELETE_AFTER_DAYS`` (default ``30``).

    Trigger:
        Celery Beat schedule entry
        ``check-every-day-to-delete-webhook-logs`` scheduled at
        ``03:30 UTC`` daily, defined in
        ``apps/api/plane/celery.py:L72-L75``. The Celery message is
        routed via **RabbitMQ** and consumed by a worker.

    Side effects:
        * **MongoDB archive** (when ``MongoConnection.is_configured()``
          returns ``True``): bulk-inserts the eligible rows into the
          ``webhook_logs`` archive collection via
          ``process_cleanup_task()``.
        * **PostgreSQL hard-delete**: batched delete with
          ``BATCH_SIZE = 500`` rows per iteration. The queryset
          iterator uses ``chunk_size=100`` (see
          ``get_webhook_logs_queryset``) because webhook log rows carry
          larger payloads (request/response headers and bodies) than
          the other log models.
        * **No** emails. **No** webhook fan-out -- this sweep deletes
          past-delivery LOG records and does NOT re-deliver any
          webhooks. **No** cache invalidation.

    Idempotency:
        Idempotent. The monotonic ``created_at <= now - N days`` filter
        ensures that subsequent runs find zero remaining matches once a
        row has been archived and deleted.
    """
    process_cleanup_task(
        queryset_func=get_webhook_logs_queryset,
        transform_func=transform_webhook_log,
        model=WebhookLog,
        task_name="Webhook Log",
        collection_name="webhook_logs",
    )
