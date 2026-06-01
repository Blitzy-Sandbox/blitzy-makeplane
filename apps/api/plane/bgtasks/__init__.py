# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery background task modules for the Plane Django backend.

This package contains the worker-side implementations of asynchronous,
side-effect-heavy jobs that the API tier offloads from request/response
threads. Modules are grouped by domain:

* Email and notification delivery -- ``magic_link_code_task``,
  ``forgot_password_task``, ``notification_task``,
  ``email_notification_task``, ``workspace_invitation_task``,
  ``project_invitation_task``, ``project_add_user_email_task``,
  ``user_activation_email_task``, ``user_deactivation_email_task``,
  ``user_email_update_task``.
* Webhook fan-out -- ``webhook_task``.
* Versioning and audit history -- ``page_version_task``,
  ``page_transaction_task``, ``issue_version_sync``,
  ``issue_description_version_task``, ``issue_description_version_sync``,
  ``issue_activities_task``.
* Data cleanup and retention -- ``cleanup_task``, ``deletion_task``,
  ``file_asset_task``, ``exporter_expired_task``.
* Analytics and exports -- ``analytic_plot_export``, ``export_task``,
  ``event_tracking_task``.
* File and storage operations -- ``copy_s3_object``,
  ``storage_metadata_task``, ``work_item_link_task``.
* Orchestration and seeding -- ``issue_automation_task``,
  ``recent_visited_task``, ``workspace_seed_task``, ``dummy_data_task``,
  ``logger_task``.

The Django ``AppConfig`` for this package lives in :mod:`plane.bgtasks.apps`.

Async infrastructure (architectural rule -- do not violate):
    * Celery workers consume tasks from **RabbitMQ** (the broker).
    * **Redis is used for caching and session only**, NOT for task
      queueing. The two responsibilities must never be conflated when
      adding new task modules to this package.

Task discovery:
    Modules in this package are registered with the Celery app via
    ``app.autodiscover_tasks()`` in :mod:`plane.celery`, which imports
    each installed Django app's ``tasks.py`` and ``@shared_task``
    declarations at worker boot. The canonical Celery Beat schedule
    that drives periodic tasks (cleanup, deletion sweeps, expired
    exporter purges, file-asset GC, etc.) is declared in
    ``app.conf.beat_schedule`` in :mod:`plane.celery` as well.
"""
