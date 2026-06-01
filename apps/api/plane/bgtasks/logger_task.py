# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that ships API request logs to MongoDB (preferred) or PostgreSQL (fallback).

Trigger: explicit ``process_logs.delay(log_data=..., mongo_log=...)``
from ``apps/api/plane/middleware/logger.py`` — the
``APITokenLogMiddleware`` captures full request/response metadata for
``X-Api-Key`` traffic and flushes the records through this task
asynchronously so persistence does not block the request/response
cycle.

Sink routing:
    - If ``MongoConnection.is_configured()`` is true, ``mongo_log`` is
      inserted into the ``api_activity_logs`` MongoDB collection
      (high-volume log storage).
    - Otherwise the fallback path inserts an ``APIActivityLog`` row in
      PostgreSQL via the Django ORM.

Binary safety:
    ``safe_decode_body()`` detects PNG, JPEG, and PDF magic bytes and
    substitutes ``"[Binary Content]"`` so file-upload payloads from
    ``multipart/form-data`` requests do not corrupt the log row's
    text field.

Async infrastructure: Celery via RabbitMQ — task messages are queued
onto RabbitMQ and consumed by Celery workers. Redis is used for
caching and session storage only, never as the task broker (per the
project architectural rule).
"""

# Python imports
import logging
from typing import Optional, Dict, Any

# Third party imports
from pymongo.collection import Collection
from celery import shared_task

# Django imports
from plane.settings.mongo import MongoConnection
from plane.utils.exception_logger import log_exception
from plane.db.models import APIActivityLog


logger = logging.getLogger("plane.worker")


def get_mongo_collection() -> Optional[Collection]:
    """Return the ``api_activity_logs`` MongoDB collection, or ``None`` if unavailable.

    Yields ``None`` (and emits an informational log) when MongoDB is
    not configured, and ``None`` (recording the exception via
    ``log_exception``) when the connection layer raises while
    resolving the collection handle.
    """
    if not MongoConnection.is_configured():
        logger.info("MongoDB not configured")
        return None

    try:
        return MongoConnection.get_collection("api_activity_logs")
    except Exception as e:
        logger.error(f"Error getting MongoDB collection: {str(e)}")
        log_exception(e)
        return None


def safe_decode_body(content: bytes) -> Optional[str]:
    r"""Return ``content`` UTF-8-decoded, or a placeholder when its leading bytes look binary.

    Detects PNG (``\x89PNG``), JPEG (``\xff\xd8\xff``), and PDF
    (``%PDF``) signatures so file-upload payloads from
    ``multipart/form-data`` requests do not corrupt the log row's
    text field. This preserves the log row's structure for the audit
    trail without polluting the database with binary garbage.

    Args:
        content: Raw request or response body bytes.

    Returns:
        ``None`` for ``None`` or empty input; ``"[Binary Content]"``
        when the leading bytes match a known binary signature;
        ``"[Could not decode content]"`` on UTF-8 decode failure;
        otherwise the UTF-8-decoded string.
    """
    # If the content is None, return None
    if content is None:
        return None

    # If the content is an empty bytes object, return None
    if content == b"":
        return None

    # Check if content is binary by looking for common binary file signatures
    if content.startswith(b"\x89PNG") or content.startswith(b"\xff\xd8\xff") or content.startswith(b"%PDF"):
        return "[Binary Content]"

    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        return "[Could not decode content]"


def log_to_mongo(log_document: Dict[str, Any]) -> bool:
    """Insert ``log_document`` into the MongoDB ``api_activity_logs`` collection.

    Returns ``False`` (and records the underlying error via
    ``log_exception``) when MongoDB is not configured or when the
    insert raises; otherwise returns ``True``.
    """
    mongo_collection = get_mongo_collection()
    if mongo_collection is None:
        logger.error("MongoDB not configured")
        return False

    try:
        mongo_collection.insert_one(log_document)
        return True
    except Exception as e:
        log_exception(e)
        return False


def log_to_postgres(log_data: Dict[str, Any]) -> bool:
    """Insert ``log_data`` as an ``APIActivityLog`` row via the Django ORM.

    Acts as the fallback persistence path when MongoDB is not
    configured. Returns ``False`` (recording the exception via
    ``log_exception``) when the ORM ``create`` raises; otherwise
    returns ``True``.
    """
    try:
        APIActivityLog.objects.create(**log_data)
        return True
    except Exception as e:
        log_exception(e)
        return False


@shared_task
def process_logs(log_data: Dict[str, Any], mongo_log: Dict[str, Any]) -> None:
    """Persist a batch of API request log records to MongoDB (preferred) or PostgreSQL (fallback).

    Trigger:
        Explicit ``process_logs.delay(log_data=..., mongo_log=...)``
        from ``apps/api/plane/middleware/logger.py``
        (``APITokenLogMiddleware``). The middleware buffers
        per-request log records and flushes them via this task so
        persistence does not block the request/response cycle. The
        Celery message is routed through RabbitMQ and consumed by
        the worker (Celery via RabbitMQ; Redis is caching/session
        only, never the task broker).

    Side effects:
        - DB write (one of two mutually exclusive paths):

          * MongoDB: when ``MongoConnection.is_configured()`` is
            true, ``mongo_log`` is inserted into the
            ``api_activity_logs`` collection via ``log_to_mongo``.
          * PostgreSQL fallback: otherwise a row is inserted into
            ``APIActivityLog`` via ``log_to_postgres`` (Django ORM).

        - Binary-safety pre-processing happens upstream in the
          middleware via ``safe_decode_body`` so request/response
          bodies whose first bytes match PNG / JPEG / PDF signatures
          are stored as ``"[Binary Content]"`` placeholders rather
          than corrupting the log row's text field.
        - No emails. No webhook fan-out. No cache invalidation.

    Idempotency:
        NON-idempotent. Duplicate invocations create duplicate log
        rows; there is no deduplication key.

    Args:
        log_data: PostgreSQL log payload dict consumed by
            ``APIActivityLog.objects.create(**log_data)`` on the
            fallback path.
        mongo_log: MongoDB log document dict inserted into the
            ``api_activity_logs`` collection on the primary path.
    """
    if MongoConnection.is_configured():
        log_to_mongo(mongo_log)
    else:
        log_to_postgres(log_data)
