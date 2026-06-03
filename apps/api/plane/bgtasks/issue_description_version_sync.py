# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery tasks that backfill ``IssueDescriptionVersion`` rows for pre-existing issues.

Two ``@shared_task`` callables live in this module:

1. ``schedule_issue_description_version`` — kick-off entrypoint, invoked
   manually (Django shell, data migration, or ops runbook).
2. ``sync_issue_description_version`` — self-rescheduling worker that
   pages through ``Issue`` rows in ``batch_size``-sized chunks and
   re-queues itself with ``offset = end_offset`` until the table is
   exhausted, sleeping ``countdown`` seconds between batches.

Companion module to ``issue_description_version_task.py`` (which handles
the live, per-edit snapshot). The sync module performs the one-time
BACKFILL of version rows for issues created before the description
versioning feature shipped.

Owner attribution: ``get_owner_id()`` resolves the version owner via the
fallback chain ``updated_by_id`` → ``created_by_id`` → any
``ProjectMember`` with admin ``role=20`` → ``None``.

Async infrastructure: queued onto RabbitMQ and consumed by Celery workers
(per the project architectural rule that Celery uses RabbitMQ as broker;
Redis is reserved for caching / sessions and is not the task broker).
"""

# Python imports
from typing import Optional
import logging

# Django imports
from django.utils import timezone
from django.db import transaction

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import Issue, IssueDescriptionVersion, ProjectMember
from plane.utils.exception_logger import log_exception


def get_owner_id(issue: Issue) -> Optional[int]:
    """Resolve an owner user id for a historical issue via a fallback chain.

    The resolution order is ``updated_by_id`` → ``created_by_id`` → the
    first ``ProjectMember`` with admin role (``role=20``) → ``None``.

    Historical issues may have a null ``created_by_id`` / ``updated_by_id``
    if they were imported from another tracker or pre-date the audit-trail
    feature. Falling back to a project admin guarantees that the backfilled
    ``IssueDescriptionVersion`` row carries a non-null ``owned_by_id``.
    """
    if issue.updated_by_id:
        return issue.updated_by_id

    if issue.created_by_id:
        return issue.created_by_id

    # Find project admin as fallback
    project_member = ProjectMember.objects.filter(
        project_id=issue.project_id,
        role=20,  # Admin role
    ).first()

    return project_member.member_id if project_member else None


@shared_task
def sync_issue_description_version(batch_size=5000, offset=0, countdown=300):
    """Backfill one batch of ``IssueDescriptionVersion`` rows starting at ``offset`` and re-schedule.

    Trigger:
        Explicit ``.apply_async(...)`` / ``.delay(...)`` chain originated
        from ``schedule_issue_description_version()`` (or a one-off shell
        invocation). The worker self-reschedules until every ``Issue``
        row has been backfilled. Celery messages are routed via RabbitMQ
        and consumed by the worker pool.

    Side effects:
        - DB read: pages ``Issue`` rows in the half-open window
          ``[offset, offset + batch_size)`` ordered by ``created_at``,
          fetching only the columns needed to construct a version row.
        - DB write: ``IssueDescriptionVersion.objects.bulk_create`` of one
          snapshot row per issue (binary / html / stripped / json
          description payloads). Owner resolved via ``get_owner_id``;
          issues missing ``workspace_id`` / ``project_id`` / a resolvable
          owner are logged and skipped.
        - Self-reschedule: when ``end_offset < total_issues_count``,
          enqueues ``sync_issue_description_version.apply_async`` with
          ``offset = end_offset`` and the supplied ``countdown`` so the
          next batch fires after ``countdown`` seconds (default ``300``
          s = 5 min).
        - No emails. No webhook fan-out. No cache invalidation.

    Idempotency:
        PARTIALLY idempotent. ``bulk_create`` is unconditional, so
        re-running over the same ``offset`` window CREATES DUPLICATE
        ``IssueDescriptionVersion`` rows. The operator should not re-run
        the backfill without first clearing existing version rows or
        accepting duplicates.

    Args:
        batch_size: Rows per batch (default ``5000``).
        offset: Starting offset into the ``Issue`` table (default ``0``).
        countdown: Seconds to wait between consecutive batches (default
            ``300`` = 5 min).
    """
    try:
        with transaction.atomic():
            base_query = Issue.objects
            total_issues_count = base_query.count()

            if total_issues_count == 0:
                return

            # Calculate batch range
            end_offset = min(offset + batch_size, total_issues_count)

            # Fetch issues with related data
            issues_batch = (
                base_query.order_by("created_at")
                .select_related("workspace", "project")
                .only(
                    "id",
                    "workspace_id",
                    "project_id",
                    "created_by_id",
                    "updated_by_id",
                    "description_binary",
                    "description_html",
                    "description_stripped",
                    "description_json",
                )[offset:end_offset]
            )

            if not issues_batch:
                return

            version_objects = []
            for issue in issues_batch:
                # Validate required fields
                if not issue.workspace_id or not issue.project_id:
                    logging.warning(f"Skipping {issue.id} - missing workspace_id or project_id")
                    continue

                # Determine owned_by_id
                owned_by_id = get_owner_id(issue)
                if owned_by_id is None:
                    logging.warning(f"Skipping issue {issue.id} - missing owned_by")
                    continue

                # Create version object
                version_objects.append(
                    IssueDescriptionVersion(
                        workspace_id=issue.workspace_id,
                        project_id=issue.project_id,
                        created_by_id=issue.created_by_id,
                        updated_by_id=issue.updated_by_id,
                        owned_by_id=owned_by_id,
                        last_saved_at=timezone.now(),
                        issue_id=issue.id,
                        description_binary=issue.description_binary,
                        description_html=issue.description_html,
                        description_stripped=issue.description_stripped,
                        description_json=issue.description_json,
                    )
                )

            # Bulk create version objects
            if version_objects:
                IssueDescriptionVersion.objects.bulk_create(version_objects)

            # Schedule next batch if needed
            if end_offset < total_issues_count:
                sync_issue_description_version.apply_async(
                    kwargs={
                        "batch_size": batch_size,
                        "offset": end_offset,
                        "countdown": countdown,
                    },
                    countdown=countdown,
                )
        return
    except Exception as e:
        log_exception(e)
        return


@shared_task
def schedule_issue_description_version(batch_size=5000, countdown=300):
    """Kick off the batched backfill of ``IssueDescriptionVersion`` rows.

    Trigger:
        Manual — typically invoked from a Django shell, a data-migration
        helper, or an operational runbook to bootstrap historical
        ``IssueDescriptionVersion`` rows after the description-versioning
        feature rolls out. There is no automated caller (no Beat
        schedule, no signal handler). The Celery message is routed via
        RabbitMQ.

    Side effects:
        - Enqueues exactly one ``sync_issue_description_version.delay(...)``
          message on RabbitMQ (``offset`` defaults to ``0`` in the
          worker). ``sync_issue_description_version`` then self-reschedules
          the remaining batches.
        - No direct DB writes here; all writes happen inside
          ``sync_issue_description_version``.

    Idempotency:
        See ``sync_issue_description_version`` — because the underlying
        worker is only PARTIALLY idempotent, repeated invocations of this
        scheduler cascade into duplicate ``IssueDescriptionVersion``
        rows.

    Args:
        batch_size: Rows per batch (default ``5000``). Cast to ``int``
            before dispatch to tolerate string-typed shell input.
        countdown: Seconds to wait between consecutive batches (default
            ``300`` = 5 min), forwarded to
            ``sync_issue_description_version``.
    """
    sync_issue_description_version.delay(batch_size=int(batch_size), countdown=countdown)
