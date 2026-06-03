# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that maintains ``IssueDescriptionVersion`` snapshots with same-user coalescing.

Triggered by explicit ``.delay(updated_issue, issue_id, user_id, is_creating)``
from ``apps/api/plane/app/views/intake/base.py`` and
``apps/api/plane/app/views/issue/base.py`` whenever an issue's description
content changes. Part of the apps/live -> apps/api callback chain that
persists rich-text history alongside the editable ``Issue`` row.

Coalescing window:
    ``max_time_difference = 600`` seconds (10 minutes). Within this window
    for the same user, the most recent version row is updated in place
    rather than creating a new one -- avoiding one row per keystroke during
    a single editing session.

Async infrastructure: Celery messages are routed via **RabbitMQ** and
consumed by Celery workers (Redis is **not** the task broker; it is used
only for caching/session state elsewhere in the system).
"""

from celery import shared_task
from django.db import transaction
from django.utils import timezone
from typing import Optional, Dict
import json

from plane.db.models import Issue, IssueDescriptionVersion
from plane.utils.exception_logger import log_exception


def should_update_existing_version(
    version: IssueDescriptionVersion, user_id: str, max_time_difference: int = 600
) -> bool:
    """Return ``True`` when the most recent version row should be coalesced into.

    Coalescing predicate: the supplied ``version`` (assumed to be the most
    recent ``IssueDescriptionVersion`` for the issue) was created by
    ``user_id`` within ``max_time_difference = 600`` seconds. Used to avoid
    creating one version row per keystroke during a single editing session.

    Args:
        version: The most recent ``IssueDescriptionVersion`` for the issue,
            or a falsy value if none exists.
        user_id: Primary key of the user whose edit triggered the task.
        max_time_difference: Coalescing window in seconds. Defaults to 600
            (10 minutes).
    """
    if not version:
        return

    time_difference = (timezone.now() - version.last_saved_at).total_seconds()
    return str(version.owned_by_id) == str(user_id) and time_difference <= max_time_difference


def update_existing_version(version: IssueDescriptionVersion, issue) -> None:
    """Persist the live issue's description fields onto an existing version row.

    Coalescing UPDATE path: copies ``description_json``, ``description_html``,
    ``description_binary``, and ``description_stripped`` from the live
    ``Issue`` onto the supplied ``IssueDescriptionVersion`` and refreshes
    ``last_saved_at``. Only those five fields are written via
    ``save(update_fields=...)`` so unrelated columns are not disturbed.
    """
    version.description_json = issue.description_json
    version.description_html = issue.description_html
    version.description_binary = issue.description_binary
    version.description_stripped = issue.description_stripped
    version.last_saved_at = timezone.now()

    version.save(
        update_fields=[
            "description_json",
            "description_html",
            "description_binary",
            "description_stripped",
            "last_saved_at",
        ]
    )


@shared_task
def issue_description_version_task(updated_issue, issue_id, user_id, is_creating=False) -> Optional[bool]:
    """Create or update an ``IssueDescriptionVersion`` snapshot, coalescing same-user edits within 10 minutes.

    Trigger:
        Explicit ``issue_description_version_task.delay(updated_issue,
        issue_id, user_id, is_creating=False)`` from
        ``apps/api/plane/app/views/intake/base.py`` and
        ``apps/api/plane/app/views/issue/base.py`` whenever an issue's
        description is changed (and once with ``is_creating=True`` on the
        intake CREATE path). The Celery message is routed via **RabbitMQ**
        and consumed by the worker.

    Side effects:
        - **DB write (one of two paths)**:
            * **UPDATE path**: when
              :func:`should_update_existing_version` returns ``True``
              (most recent version row was created by ``user_id`` within
              600 seconds), updates that version's description fields in
              place via :func:`update_existing_version`.
            * **CREATE path**: otherwise, creates a fresh
              ``IssueDescriptionVersion`` row via
              ``IssueDescriptionVersion.log_issue_description_version``.
        - Wrapped in ``transaction.atomic()`` so the version write commits
          or rolls back as a unit.
        - Short-circuits with **no DB write** when the live
          ``Issue.description_html`` already matches the snapshot in
          ``updated_issue`` and ``is_creating`` is ``False``.
        - **No** emails, **no** webhook fan-out, **no** cache invalidation.
        - Recoverable errors (``Issue.DoesNotExist``, ``json.JSONDecodeError``,
          generic ``Exception``) are swallowed; the latter two are reported
          via ``plane.utils.exception_logger.log_exception``.

    Idempotency:
        NON-idempotent in detail. Calls within the coalesce window converge
        on the same final content but bump ``last_saved_at`` on the existing
        version row on each call. Calls outside the window create distinct
        version rows.

    Args:
        updated_issue: JSON-encoded snapshot of the issue from the request
            payload. Only ``description_html`` is read from it to detect
            whether the description actually changed; the new/updated
            version row is populated from the live ``Issue`` row fetched by
            ``issue_id``, not from this argument.
        issue_id: Primary key of the ``Issue`` to snapshot.
        user_id: Primary key of the user whose edit triggered the task;
            stored on the new/updated version's ``owned_by_id``.
        is_creating: When ``True``, bypass the "no change" early-return so
            the version is processed even when ``description_html`` matches
            (used on the intake CREATE path). The CREATE-vs-UPDATE choice
            still defers to :func:`should_update_existing_version`.
    """
    try:
        # Parse updated issue data
        current_issue: Dict = json.loads(updated_issue) if updated_issue else {}

        # Get current issue
        issue = Issue.objects.get(id=issue_id)

        # Check if description has changed
        if current_issue.get("description_html") == issue.description_html and not is_creating:
            return

        with transaction.atomic():
            # Get latest version
            latest_version = (
                IssueDescriptionVersion.objects.filter(issue_id=issue_id).order_by("-last_saved_at").first()
            )

            # Determine whether to update existing or create new version
            if should_update_existing_version(version=latest_version, user_id=user_id):
                update_existing_version(latest_version, issue)
            else:
                IssueDescriptionVersion.log_issue_description_version(issue, user_id)

            return

    except Issue.DoesNotExist:
        # Issue no longer exists, skip processing
        return
    except json.JSONDecodeError as e:
        log_exception(f"Invalid JSON for updated_issue: {e}")
        return
    except Exception as e:
        log_exception(f"Error processing issue description version: {e}")
        return
