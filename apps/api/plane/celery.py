# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery bootstrap for the Plane Django backend.

Initializes the ``Celery("plane")`` app, binds Django settings under the
``CELERY_`` namespace, autodiscovers per-app ``tasks.py`` modules, and
configures the database-backed
``django_celery_beat.schedulers.DatabaseScheduler`` so the Beat schedule
remains administrable at runtime via the Django admin (entries declared
here are the seed schedule). See tech spec section 3.2.2 for the Beat
schedule architecture.

Async infrastructure (architectural rule):
    - Celery workers consume tasks from RabbitMQ (broker).
    - Redis is used for caching and session only, NOT for task queueing.
    - The ``redis_instance()`` import here is for early-init side effects
      and health probing of the cache layer; it is NOT the broker.

Bootstrap sequence:
    1. ``os.environ.setdefault("DJANGO_SETTINGS_MODULE", ...)`` ensures the
       worker boots against ``plane.settings.production`` when no override
       is supplied by the environment.
    2. ``ri = redis_instance()`` opens the cache connection early so any
       configuration overlay that depends on Redis is ready before Django
       settings are loaded into Celery.
    3. ``app = Celery("plane")`` instantiates the named app used by the
       worker, beat, and ``shared_task`` registrations.
    4. ``app.config_from_object("django.conf:settings", namespace="CELERY")``
       picks up every Django setting prefixed ``CELERY_`` (broker URL,
       result backend, serializer, timezone, etc.) without manual rebinding.
    5. ``app.autodiscover_tasks()`` imports each installed Django app's
       ``tasks.py`` so ``@shared_task`` definitions are registered.
    6. ``app.conf.beat_scheduler = "django_celery_beat.schedulers.``
       ``DatabaseScheduler"`` swaps Celery's default file-backed scheduler
       for the database-backed one shipped by ``django_celery_beat``.

Beat schedule (UTC, declared in ``app.conf.beat_schedule``):
    - Every 5 min: ``email_notification_task.stack_email_notification``
      drains pending ``EmailNotificationLog`` batches (see tech spec
      section 4.6 NOTIFICATION PIPELINE).
    - Every 6 hrs: ``license.bgtasks.tracer.instance_traces`` collects
      instance telemetry / trace data.
    - 00:00 UTC: ``deletion_task.hard_delete`` sweeps soft-deleted rows
      past their retention window (see tech spec section 4.12 DATA
      CLEANUP AND RETENTION).
    - 01:00 UTC: ``issue_automation_task.archive_and_close_old_issues``
      auto-archives/auto-closes issues per project automation rules.
    - 01:30 UTC: ``exporter_expired_task.delete_old_s3_link`` expires
      exporter download links (first sweep of the day).
    - 02:00 UTC: ``file_asset_task.delete_unuploaded_file_asset`` cleans
      up presigned uploads that were never finalized (see tech spec
      section 4.4 FILE UPLOAD WORKFLOW).
    - 02:30 UTC: ``cleanup_task.delete_api_logs``.
    - 02:45 UTC: ``cleanup_task.delete_email_notification_logs``.
    - 03:00 UTC: ``cleanup_task.delete_page_versions``.
    - 03:15 UTC: ``cleanup_task.delete_issue_description_versions``.
    - 03:30 UTC: ``cleanup_task.delete_webhook_logs``.
    - 03:45 UTC: ``exporter_expired_task.delete_old_s3_link`` (second
      sweep of the day for any links that survived the 01:30 pass).

Structured logging:
    Both the ``after_setup_logger`` and ``after_setup_task_logger`` signal
    handlers attach a ``pythonjsonlogger.JsonFormatter`` so worker- and
    task-level logs are emitted as structured JSON for downstream log
    aggregation (matching the API server's JSON log format).
"""

# Python imports
import os
import logging

# Third party imports
from celery import Celery
from pythonjsonlogger.jsonlogger import JsonFormatter
from celery.signals import after_setup_logger, after_setup_task_logger
from celery.schedules import crontab

# Module imports
from plane.settings.redis import redis_instance

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "plane.settings.production")

ri = redis_instance()

app = Celery("plane")

# Using a string here means the worker will not have to
# pickle the object when using Windows.
app.config_from_object("django.conf:settings", namespace="CELERY")

app.conf.beat_schedule = {
    # Intra day recurring jobs
    "check-every-five-minutes-to-send-email-notifications": {
        "task": "plane.bgtasks.email_notification_task.stack_email_notification",
        "schedule": crontab(minute="*/5"),  # Every 5 minutes
    },
    "run-every-6-hours-for-instance-trace": {
        "task": "plane.license.bgtasks.tracer.instance_traces",
        "schedule": crontab(hour="*/6", minute=0),  # Every 6 hours
    },
    # Occurs once every day
    "check-every-day-to-delete-hard-delete": {
        "task": "plane.bgtasks.deletion_task.hard_delete",
        "schedule": crontab(hour=0, minute=0),  # UTC 00:00
    },
    "check-every-day-to-archive-and-close": {
        "task": "plane.bgtasks.issue_automation_task.archive_and_close_old_issues",
        "schedule": crontab(hour=1, minute=0),  # UTC 01:00
    },
    "check-every-day-to-delete_exporter_history": {
        "task": "plane.bgtasks.exporter_expired_task.delete_old_s3_link",
        "schedule": crontab(hour=1, minute=30),  # UTC 01:30
    },
    "check-every-day-to-delete-file-asset": {
        "task": "plane.bgtasks.file_asset_task.delete_unuploaded_file_asset",
        "schedule": crontab(hour=2, minute=0),  # UTC 02:00
    },
    "check-every-day-to-delete-api-logs": {
        "task": "plane.bgtasks.cleanup_task.delete_api_logs",
        "schedule": crontab(hour=2, minute=30),  # UTC 02:30
    },
    "check-every-day-to-delete-email-notification-logs": {
        "task": "plane.bgtasks.cleanup_task.delete_email_notification_logs",
        "schedule": crontab(hour=2, minute=45),  # UTC 02:45
    },
    "check-every-day-to-delete-page-versions": {
        "task": "plane.bgtasks.cleanup_task.delete_page_versions",
        "schedule": crontab(hour=3, minute=0),  # UTC 03:00
    },
    "check-every-day-to-delete-issue-description-versions": {
        "task": "plane.bgtasks.cleanup_task.delete_issue_description_versions",
        "schedule": crontab(hour=3, minute=15),  # UTC 03:15
    },
    "check-every-day-to-delete-webhook-logs": {
        "task": "plane.bgtasks.cleanup_task.delete_webhook_logs",
        "schedule": crontab(hour=3, minute=30),  # UTC 03:30
    },
    "check-every-day-to-delete-exporter-history": {
        "task": "plane.bgtasks.exporter_expired_task.delete_old_s3_link",
        "schedule": crontab(hour=3, minute=45),  # UTC 03:45
    },
}


# Setup logging
@after_setup_logger.connect
def setup_loggers(logger, *args, **kwargs):
    """Attach a JSON-formatted StreamHandler to the Celery worker root logger."""
    formatter = JsonFormatter('"%(levelname)s %(asctime)s %(module)s %(name)s %(message)s')
    handler = logging.StreamHandler()
    handler.setFormatter(fmt=formatter)
    logger.addHandler(handler)


@after_setup_task_logger.connect
def setup_task_loggers(logger, *args, **kwargs):
    """Attach a JSON-formatted StreamHandler to the per-task Celery logger."""
    formatter = JsonFormatter('"%(levelname)s %(asctime)s %(module)s %(name)s %(message)s')
    handler = logging.StreamHandler()
    handler.setFormatter(fmt=formatter)
    logger.addHandler(handler)


# Load task modules from all registered Django app configs.
app.autodiscover_tasks()

app.conf.beat_scheduler = "django_celery_beat.schedulers.DatabaseScheduler"
