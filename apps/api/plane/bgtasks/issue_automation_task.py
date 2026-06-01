# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery Beat task that auto-archives long-completed issues and auto-closes stale open issues.

Beat schedule:
    ``apps/api/plane/celery.py:L44-L47`` -- entry scheduled at
    ``01:00 UTC`` daily under the
    ``check-every-day-to-archive-and-close`` schedule key.

Project-level configuration:
    - ``Project.archive_in`` (months): issues in ``completed`` /
      ``cancelled`` state for longer than ``archive_in * 30`` days are
      auto-archived (``Issue.archived_at`` is set to the current date).
    - ``Project.close_in`` (months): issues in ``backlog`` /
      ``unstarted`` / ``started`` state for longer than
      ``close_in * 30`` days are transitioned to
      ``Project.default_state`` (or to the cancelled state if no
      ``default_state`` is configured).

Activity logging:
    Each archive or close action dispatches ``issue_activity.delay(...)``
    (see ``apps/api/plane/bgtasks/issue_activities_task.py``) so the
    change is recorded in the audit trail with
    ``type="issue.activity.updated"`` and ``"automation": True`` in the
    requested-data payload for archives.

Async infrastructure:
    Queued onto **RabbitMQ** and consumed by Celery workers. Redis is
    **not** the task broker for Plane -- it is reserved for caching and
    session state only.
"""

# Python imports
import json
from datetime import timedelta

# Third party imports
from celery import shared_task
from django.db.models import Q

# Django imports
from django.utils import timezone

# Module imports
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import Issue, Project, State
from plane.utils.exception_logger import log_exception


@shared_task
def archive_and_close_old_issues():
    """Run the daily Beat sweep that archives long-completed issues and closes stale open issues per project policy.

    Trigger:
        Celery Beat schedule entry
        ``check-every-day-to-archive-and-close`` scheduled at
        ``01:00 UTC`` daily, defined in
        ``apps/api/plane/celery.py:L44-L47``. The Celery message is
        routed via **RabbitMQ** and consumed by a worker process.

    Side effects:
        Calls :func:`archive_old_issues` then :func:`close_old_issues`
        sequentially. See each helper's docstring for the per-function
        breakdown of database reads, database writes, and chained
        activity-logging tasks. The task itself returns ``None``; both
        helpers swallow their own exceptions via ``log_exception``.

    Idempotency:
        IDEMPOTENT. The filters used by both helpers are monotonic:
        once an issue has been archived or transitioned to the closing
        state it falls out of the helper's filter, so subsequent sweeps
        are no-ops for that issue.

    Args:
        None. The task is invoked by Celery Beat with no positional or
        keyword arguments.
    """
    archive_old_issues()
    close_old_issues()


def archive_old_issues():
    """Archive issues in ``completed`` / ``cancelled`` state for longer than ``Project.archive_in * 30`` days.

    Side effects:
        - **DB read**: for each ``Project`` with ``archive_in > 0``,
          queries ``Issue.issue_objects`` where ``archived_at`` is
          ``NULL``, ``state.group`` is in ``{"completed", "cancelled"}``,
          and ``updated_at <= now - archive_in * 30 days``. Cycle- and
          module-bound issues are only considered when their cycle has
          ended (``end_date < now``) or their module's ``target_date``
          has passed; intake issues are restricted to accepted /
          declined / duplicate / non-intake records.
        - **DB write**: sets ``Issue.archived_at`` to the current date
          on each matching row via
          ``Issue.objects.bulk_update(..., ["archived_at"],
          batch_size=100)``.
        - **Task chain**: dispatches one ``issue_activity.delay(...)``
          per archived issue with
          ``type="issue.activity.updated"`` and a payload describing
          the ``archived_at`` transition plus ``"automation": True``,
          so the audit trail records the automation as the actor.
        - **No** outbound emails. **No** webhook fan-out from this
          task. **No** cache invalidation. Webhook delivery, if any,
          is performed downstream by the ``issue_activity`` consumer.

    Idempotency:
        IDEMPOTENT. The ``archived_at__isnull=True`` filter excludes
        rows that have already been archived, so re-running the helper
        is a no-op for already-processed issues. Unhandled exceptions
        are caught and routed through ``log_exception`` so the calling
        task always returns ``None``.
    """
    try:
        # Get all the projects whose archive_in is greater than 0
        projects = Project.objects.filter(archive_in__gt=0)

        for project in projects:
            project_id = project.id
            archive_in = project.archive_in

            # Get all the issues whose updated_at in less that the archive_in month
            issues = Issue.issue_objects.filter(
                Q(
                    project=project_id,
                    archived_at__isnull=True,
                    updated_at__lte=(timezone.now() - timedelta(days=archive_in * 30)),
                    state__group__in=["completed", "cancelled"],
                ),
                Q(issue_cycle__isnull=True)
                | (Q(issue_cycle__cycle__end_date__lt=timezone.now()) & Q(issue_cycle__isnull=False)),
                Q(issue_module__isnull=True)
                | (Q(issue_module__module__target_date__lt=timezone.now()) & Q(issue_module__isnull=False)),
            ).filter(
                Q(issue_intake__status=1)
                | Q(issue_intake__status=-1)
                | Q(issue_intake__status=2)
                | Q(issue_intake__isnull=True)
            )

            # Check if Issues
            if issues:
                # Set the archive time to current time
                archive_at = timezone.now().date()

                issues_to_update = []
                for issue in issues:
                    issue.archived_at = archive_at
                    issues_to_update.append(issue)

                # Bulk Update the issues and log the activity
                if issues_to_update:
                    Issue.objects.bulk_update(issues_to_update, ["archived_at"], batch_size=100)
                    _ = [
                        issue_activity.delay(
                            type="issue.activity.updated",
                            requested_data=json.dumps({"archived_at": str(archive_at), "automation": True}),
                            actor_id=str(project.created_by_id),
                            issue_id=issue.id,
                            project_id=project_id,
                            current_instance=json.dumps({"archived_at": None}),
                            subscriber=False,
                            epoch=int(timezone.now().timestamp()),
                            notification=True,
                        )
                        for issue in issues_to_update
                    ]
        return
    except Exception as e:
        log_exception(e)
        return


def close_old_issues():
    """Close issues in ``backlog`` / ``unstarted`` / ``started`` state for longer than ``Project.close_in * 30`` days.

    Side effects:
        - **DB read**: for each ``Project`` with ``close_in > 0``,
          queries ``Issue.issue_objects`` where ``archived_at`` is
          ``NULL``, ``state.group`` is in ``{"backlog", "unstarted",
          "started"}``, and ``updated_at <= now - close_in * 30 days``.
          The same cycle / module / intake guards as
          :func:`archive_old_issues` apply.
        - **DB write**: transitions ``Issue.state`` to the project's
          ``default_state``, or to the first ``State`` with
          ``group="cancelled"`` when no ``default_state`` is
          configured. The update is issued via
          ``Issue.objects.bulk_update(..., ["state"], batch_size=100)``.
        - **Task chain**: dispatches one ``issue_activity.delay(...)``
          per closed issue with
          ``type="issue.activity.updated"`` and a payload describing
          the new state id (``"closed_to"``), so the audit trail
          records the automation-driven state change.
        - **No** outbound emails. **No** webhook fan-out from this
          task. **No** cache invalidation. Webhook delivery, if any,
          is performed downstream by the ``issue_activity`` consumer.

    Idempotency:
        IDEMPOTENT. Once an issue has been transitioned to the
        closing state (default or cancelled) it falls out of the
        ``backlog`` / ``unstarted`` / ``started`` state-group filter,
        so subsequent sweeps are no-ops for that issue. Unhandled
        exceptions are caught and routed through ``log_exception`` so
        the calling task always returns ``None``.
    """
    try:
        # Get all the projects whose close_in is greater than 0
        projects = Project.objects.filter(close_in__gt=0).select_related("default_state")

        for project in projects:
            project_id = project.id
            close_in = project.close_in

            # Get all the issues whose updated_at in less that the close_in month
            issues = Issue.issue_objects.filter(
                Q(
                    project=project_id,
                    archived_at__isnull=True,
                    updated_at__lte=(timezone.now() - timedelta(days=close_in * 30)),
                    state__group__in=["backlog", "unstarted", "started"],
                ),
                Q(issue_cycle__isnull=True)
                | (Q(issue_cycle__cycle__end_date__lt=timezone.now()) & Q(issue_cycle__isnull=False)),
                Q(issue_module__isnull=True)
                | (Q(issue_module__module__target_date__lt=timezone.now()) & Q(issue_module__isnull=False)),
            ).filter(
                Q(issue_intake__status=1)
                | Q(issue_intake__status=-1)
                | Q(issue_intake__status=2)
                | Q(issue_intake__isnull=True)
            )

            # Check if Issues
            if issues:
                if project.default_state is None:
                    close_state = State.objects.filter(group="cancelled").first()
                else:
                    close_state = project.default_state

                issues_to_update = []
                for issue in issues:
                    issue.state = close_state
                    issues_to_update.append(issue)

                # Bulk Update the issues and log the activity
                if issues_to_update:
                    Issue.objects.bulk_update(issues_to_update, ["state"], batch_size=100)
                    [
                        issue_activity.delay(
                            type="issue.activity.updated",
                            requested_data=json.dumps({"closed_to": str(issue.state_id)}),
                            actor_id=str(project.created_by_id),
                            issue_id=issue.id,
                            project_id=project_id,
                            current_instance=None,
                            subscriber=False,
                            epoch=int(timezone.now().timestamp()),
                            notification=True,
                        )
                        for issue in issues_to_update
                    ]
        return
    except Exception as e:
        log_exception(e)
        return
