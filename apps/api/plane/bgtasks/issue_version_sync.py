# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery tasks that snapshot full issue state (fields + related data) into ``IssueVersion``.

This module is the *full issue* counterpart to
``issue_description_version_task.py`` (which snapshots only the
description). An ``IssueVersion`` row captures the issue fields **plus**:

    - current cycle (``CycleIssue``)
    - assignees (``IssueAssignee``)
    - labels (``IssueLabel``)
    - modules (``ModuleIssue``)
    - latest activity id (``IssueActivity``)

Three ``@shared_task`` callables live here:

1. ``issue_task`` — live snapshot on each issue change.
2. ``schedule_issue_version`` — kick-off entrypoint for the batch backfill
   (manual invocation only).
3. ``sync_issue_version`` — self-rescheduling worker that pages through
   ``Issue`` rows in ``batch_size`` chunks with a ``countdown`` delay.

Async infrastructure: queued onto RabbitMQ and consumed by Celery workers
(per the project architectural rule that Celery uses RabbitMQ as broker;
Redis is reserved for caching / sessions and is not the task broker).
"""

# Python imports
import json
from typing import Optional, List, Dict
from uuid import UUID
from itertools import groupby
import logging

# Django imports
from django.utils import timezone
from django.db import transaction

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import (
    Issue,
    IssueVersion,
    ProjectMember,
    CycleIssue,
    ModuleIssue,
    IssueActivity,
    IssueAssignee,
    IssueLabel,
)
from plane.utils.exception_logger import log_exception


@shared_task
def issue_task(updated_issue, issue_id, user_id):
    """Snapshot an issue's current full state (fields + related data) into ``IssueVersion``.

    Trigger:
        Explicit ``issue_task.delay(updated_issue, issue_id, user_id)``
        from ``issue_activities_task.py`` and signal-driven paths after
        an issue is created or updated. The Celery message is routed via
        RabbitMQ and consumed by the worker.

    Side effects:
        - DB read: loads the ``Issue`` row plus (when the changeset
          requires a fresh snapshot via ``IssueVersion.log_issue_version``)
          aggregates the issue's ``CycleIssue`` (current cycle),
          ``IssueAssignee``, ``IssueLabel``, ``ModuleIssue`` rows and the
          latest ``IssueActivity`` id.
        - DB write: either updates the most recent ``IssueVersion`` row
          in-place when it belongs to the same user and is younger than
          600 s (squash window), otherwise creates a brand new
          ``IssueVersion`` row capturing the snapshot.
        - No emails. No webhook fan-out. No cache invalidation.

    Idempotency:
        NON-idempotent. Outside the 600 s same-user squash window, each
        invocation creates a new ``IssueVersion`` row. Inside the squash
        window the existing version row is mutated (so repeated calls do
        not accumulate rows, but they DO mutate ``last_saved_at`` and the
        changed fields).

    Args:
        updated_issue: JSON-encoded prev-state snapshot dict (the field
            values *before* the change that triggered this task). When
            empty/None the task short-circuits.
        issue_id: Primary key of the ``Issue`` being snapshotted.
        user_id: Primary key of the user whose action triggered the
            snapshot; used as the ``owned_by`` on the resulting
            ``IssueVersion`` row.
    """
    try:
        current_issue = json.loads(updated_issue) if updated_issue else {}
        issue = Issue.objects.get(id=issue_id)

        updated_current_issue = {}
        for key, value in current_issue.items():
            if getattr(issue, key) != value:
                updated_current_issue[key] = value

        if updated_current_issue:
            issue_version = IssueVersion.objects.filter(issue_id=issue_id).order_by("-last_saved_at").first()

            if (
                issue_version
                and str(issue_version.owned_by) == str(user_id)
                and (timezone.now() - issue_version.last_saved_at).total_seconds() <= 600
            ):
                for key, value in updated_current_issue.items():
                    setattr(issue_version, key, value)
                issue_version.last_saved_at = timezone.now()
                issue_version.save(update_fields=list(updated_current_issue.keys()) + ["last_saved_at"])
            else:
                IssueVersion.log_issue_version(issue, user_id)

        return
    except Issue.DoesNotExist:
        return
    except Exception as e:
        log_exception(e)
        return


def get_owner_id(issue: Issue) -> Optional[int]:
    """Get the owner ID of the issue."""
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


def get_related_data(issue_ids: List[UUID]) -> Dict:
    """Get related data for the given issue IDs."""
    cycle_issues = {ci.issue_id: ci.cycle_id for ci in CycleIssue.objects.filter(issue_id__in=issue_ids)}

    # Get assignees with proper grouping
    assignee_records = list(
        IssueAssignee.objects.filter(issue_id__in=issue_ids).values_list("issue_id", "assignee_id").order_by("issue_id")
    )
    assignees = {}
    for issue_id, group in groupby(assignee_records, key=lambda x: x[0]):
        assignees[issue_id] = [str(g[1]) for g in group]

    # Get labels with proper grouping
    label_records = list(
        IssueLabel.objects.filter(issue_id__in=issue_ids).values_list("issue_id", "label_id").order_by("issue_id")
    )
    labels = {}
    for issue_id, group in groupby(label_records, key=lambda x: x[0]):
        labels[issue_id] = [str(g[1]) for g in group]

    # Get modules with proper grouping
    module_records = list(
        ModuleIssue.objects.filter(issue_id__in=issue_ids).values_list("issue_id", "module_id").order_by("issue_id")
    )
    modules = {}
    for issue_id, group in groupby(module_records, key=lambda x: x[0]):
        modules[issue_id] = [str(g[1]) for g in group]

    # Get latest activities
    latest_activities = {}
    activities = IssueActivity.objects.filter(issue_id__in=issue_ids).order_by("issue_id", "-created_at")
    for issue_id, activities_group in groupby(activities, key=lambda x: x.issue_id):
        first_activity = next(activities_group, None)
        if first_activity:
            latest_activities[issue_id] = first_activity.id

    return {
        "cycle_issues": cycle_issues,
        "assignees": assignees,
        "labels": labels,
        "modules": modules,
        "activities": latest_activities,
    }


def create_issue_version(issue: Issue, related_data: Dict) -> Optional[IssueVersion]:
    """Create IssueVersion object from the given issue and related data."""
    try:
        if not issue.workspace_id or not issue.project_id:
            logging.warning(f"Skipping issue {issue.id} - missing workspace_id or project_id")
            return None

        owned_by_id = get_owner_id(issue)
        if owned_by_id is None:
            logging.warning(f"Skipping issue {issue.id} - missing owned_by")
            return None

        return IssueVersion(
            workspace_id=issue.workspace_id,
            project_id=issue.project_id,
            created_by_id=issue.created_by_id,
            updated_by_id=issue.updated_by_id,
            owned_by_id=owned_by_id,
            last_saved_at=timezone.now(),
            activity_id=related_data["activities"].get(issue.id),
            properties=getattr(issue, "properties", {}),
            meta=getattr(issue, "meta", {}),
            issue_id=issue.id,
            parent=issue.parent_id,
            state=issue.state_id,
            estimate_point=issue.estimate_point_id,
            name=issue.name,
            priority=issue.priority,
            start_date=issue.start_date,
            target_date=issue.target_date,
            assignees=related_data["assignees"].get(issue.id, []),
            sequence_id=issue.sequence_id,
            labels=related_data["labels"].get(issue.id, []),
            sort_order=issue.sort_order,
            completed_at=issue.completed_at,
            archived_at=issue.archived_at,
            is_draft=issue.is_draft,
            external_source=issue.external_source,
            external_id=issue.external_id,
            type=issue.type_id,
            cycle=related_data["cycle_issues"].get(issue.id),
            modules=related_data["modules"].get(issue.id, []),
        )
    except Exception as e:
        log_exception(e)
        return None


@shared_task
def sync_issue_version(batch_size=5000, offset=0, countdown=300):
    """Backfill one batch of ``IssueVersion`` rows starting at ``offset`` and re-schedule the next batch.

    Trigger:
        Explicit ``.apply_async(...)`` chain originated from
        ``schedule_issue_version()`` (or a one-off shell invocation).
        The worker self-reschedules until every ``Issue`` row has been
        backfilled. Celery messages are routed via RabbitMQ and consumed
        by the worker pool.

    Side effects:
        - DB read: pages ``Issue`` rows in the half-open window
          ``[offset, offset + batch_size)`` (ordered by ``created_at``)
          and groups the related data (cycle, assignees, labels, modules,
          latest activity id) via ``itertools.groupby`` inside
          ``get_related_data``.
        - DB write: ``IssueVersion.objects.bulk_create`` of the assembled
          snapshot rows in chunks of 1000.
        - Self-reschedule: when ``end_offset < total_issues_count``,
          enqueues ``sync_issue_version.apply_async(kwargs={...},
          countdown=countdown)`` so the next batch fires after
          ``countdown`` seconds (default 300 s = 5 min).
        - No emails. No webhook fan-out. No cache invalidation.

    Idempotency:
        PARTIALLY idempotent. Re-running over the same ``offset`` window
        CREATES DUPLICATE ``IssueVersion`` rows because ``bulk_create``
        is unconditional. The operator should not re-run the backfill
        without first clearing existing versions or accepting duplicates.

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

            end_offset = min(offset + batch_size, total_issues_count)

            # Get issues batch with optimized queries
            issues_batch = list(
                base_query.order_by("created_at").select_related("workspace", "project").all()[offset:end_offset]
            )

            if not issues_batch:
                return

            # Get all related data in bulk
            issue_ids = [issue.id for issue in issues_batch]
            related_data = get_related_data(issue_ids)

            issue_versions = []
            for issue in issues_batch:
                version = create_issue_version(issue, related_data)
                if version:
                    issue_versions.append(version)

            # Bulk create versions
            if issue_versions:
                IssueVersion.objects.bulk_create(issue_versions, batch_size=1000)

            # Schedule the next batch if there are more workspaces to process
            if end_offset < total_issues_count:
                sync_issue_version.apply_async(
                    kwargs={
                        "batch_size": batch_size,
                        "offset": end_offset,
                        "countdown": countdown,
                    },
                    countdown=countdown,
                )

            logging.info(f"Processed Issues: {end_offset}")
            return
    except Exception as e:
        log_exception(e)
        return


@shared_task
def schedule_issue_version(batch_size=5000, countdown=300):
    """Kick off the batched backfill of ``IssueVersion`` rows.

    Trigger:
        Manual — typically invoked from a Django shell, a data-migration
        helper, or an operational runbook to bootstrap historical
        ``IssueVersion`` rows after the feature is rolled out. The Celery
        message is routed via RabbitMQ.

    Side effects:
        - Enqueues exactly one ``sync_issue_version.delay(...)`` message
          on RabbitMQ. ``sync_issue_version`` then self-reschedules the
          remaining batches.
        - No direct DB writes here; all writes happen inside
          ``sync_issue_version``.

    Idempotency:
        See ``sync_issue_version`` — because the underlying worker is
        only PARTIALLY idempotent, repeated invocations of this
        scheduler cascade into duplicate ``IssueVersion`` rows.

    Args:
        batch_size: Rows per batch (default ``5000``). Cast to ``int``
            before dispatch to tolerate string-typed shell input.
        countdown: Seconds to wait between consecutive batches (default
            ``300`` = 5 min), forwarded to ``sync_issue_version``.
    """
    sync_issue_version.delay(batch_size=int(batch_size), countdown=countdown)
