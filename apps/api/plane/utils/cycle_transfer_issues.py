# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Cycle rollover helpers for transferring incomplete issues to a new cycle.

When a cycle is closed (or otherwise rolled over), incomplete issues -- those
whose state group is one of ``backlog``/``unstarted``/``started`` -- are
reassigned via ``CycleIssue`` rows to a new (uncompleted) destination cycle.
Completed and cancelled work remains attached to the original cycle so
historical reporting stays intact.

Side effects:
    - Captures a ``burndown_plot`` snapshot for the source cycle into
      ``Cycle.progress_snapshot`` so the original cycle's report is preserved
      after the transfer.
    - Each transfer enqueues an ``issue_activity.delay(...)`` event
      (Celery via RabbitMQ broker; Redis is NOT used for task queueing) that
      records the per-issue old/new cycle mapping for audit and webhook
      fan-out.

Canonical consumer: ``plane.app.views.cycle.base.TransferCycleIssueEndpoint``.

Data invariant: the destination cycle MUST be uncompleted (``end_date`` is
null or in the future); otherwise the helper returns an error response
without mutating state.
"""

# Python imports
import json

# Django imports
from django.db.models import (
    Case,
    Count,
    F,
    Q,
    Sum,
    FloatField,
    Value,
    When,
)
from django.db import models
from django.db.models.functions import Cast, Concat
from django.utils import timezone

# Module imports
from plane.db.models import (
    Cycle,
    CycleIssue,
    Issue,
    Project,
)
from plane.utils.analytics_plot import burndown_plot
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.host import base_host


def transfer_cycle_issues(
    slug,
    project_id,
    cycle_id,
    new_cycle_id,
    request,
    user_id,
):
    """Transfer incomplete issues from one cycle to another and snapshot progress.

    Reassigns ``CycleIssue`` rows for issues whose state group is one of
    ``backlog``/``unstarted``/``started`` from ``cycle_id`` to
    ``new_cycle_id``, captures a ``burndown_plot`` snapshot for the source
    cycle into ``Cycle.progress_snapshot``, and enqueues a single
    ``issue_activity.delay(...)`` Celery task (RabbitMQ broker) that records
    the per-issue old-cycle/new-cycle mapping so audit trails and webhook
    fan-out happen asynchronously.

    Args:
        slug: Workspace slug.
        project_id: Project ID.
        cycle_id: Source cycle ID (issues are moved away from this cycle).
        new_cycle_id: Destination cycle ID (must be uncompleted).
        request: DRF/HTTP request used to derive ``base_host`` for the
            activity payload's ``origin`` field.
        user_id: ID of the user performing the transfer (recorded as the
            ``actor_id`` in the activity event).

    Returns:
        dict: ``{"success": True}`` on success. On error, returns
        ``{"success": False, "error": "..."}`` -- either
        ``"The cycle where the issues are transferred is already completed"``
        when the destination cycle has already ended, or
        ``"Source cycle not found"`` when no cycle matches ``cycle_id``.

    Idempotency:
        NON-idempotent -- calling twice records duplicate
        ``issue_activity`` events and re-overwrites ``progress_snapshot``
        with whatever counts are observed at call time.

    See also:
        - ``plane.bgtasks.issue_activities_task.issue_activity`` -- the
          Celery task enqueued for the transfer event.
        - ``plane.utils.analytics_plot.burndown_plot`` -- snapshot generator
          used for both points-based and issue-count progress charts.
        - ``plane.utils.host.base_host`` -- origin URL resolver used to
          stamp the activity payload.
    """
    # Get the new cycle
    new_cycle = Cycle.objects.filter(workspace__slug=slug, project_id=project_id, pk=new_cycle_id).first()

    # Check if new cycle is already completed
    if new_cycle.end_date is not None and new_cycle.end_date < timezone.now():
        return {
            "success": False,
            "error": "The cycle where the issues are transferred is already completed",
        }

    # Get the old cycle with issue counts
    old_cycle = (
        Cycle.objects.filter(workspace__slug=slug, project_id=project_id, pk=cycle_id)
        .annotate(
            total_issues=Count(
                "issue_cycle",
                filter=Q(
                    issue_cycle__issue__archived_at__isnull=True,
                    issue_cycle__issue__is_draft=False,
                    issue_cycle__deleted_at__isnull=True,
                    issue_cycle__issue__deleted_at__isnull=True,
                ),
            )
        )
        .annotate(
            completed_issues=Count(
                "issue_cycle__issue__state__group",
                filter=Q(
                    issue_cycle__issue__state__group="completed",
                    issue_cycle__issue__archived_at__isnull=True,
                    issue_cycle__issue__is_draft=False,
                    issue_cycle__issue__deleted_at__isnull=True,
                    issue_cycle__deleted_at__isnull=True,
                ),
            )
        )
        .annotate(
            cancelled_issues=Count(
                "issue_cycle__issue__state__group",
                filter=Q(
                    issue_cycle__issue__state__group="cancelled",
                    issue_cycle__issue__archived_at__isnull=True,
                    issue_cycle__issue__is_draft=False,
                    issue_cycle__issue__deleted_at__isnull=True,
                    issue_cycle__deleted_at__isnull=True,
                ),
            )
        )
        .annotate(
            started_issues=Count(
                "issue_cycle__issue__state__group",
                filter=Q(
                    issue_cycle__issue__state__group="started",
                    issue_cycle__issue__archived_at__isnull=True,
                    issue_cycle__issue__is_draft=False,
                    issue_cycle__issue__deleted_at__isnull=True,
                    issue_cycle__deleted_at__isnull=True,
                ),
            )
        )
        .annotate(
            unstarted_issues=Count(
                "issue_cycle__issue__state__group",
                filter=Q(
                    issue_cycle__issue__state__group="unstarted",
                    issue_cycle__issue__archived_at__isnull=True,
                    issue_cycle__issue__is_draft=False,
                    issue_cycle__issue__deleted_at__isnull=True,
                    issue_cycle__deleted_at__isnull=True,
                ),
            )
        )
        .annotate(
            backlog_issues=Count(
                "issue_cycle__issue__state__group",
                filter=Q(
                    issue_cycle__issue__state__group="backlog",
                    issue_cycle__issue__archived_at__isnull=True,
                    issue_cycle__issue__is_draft=False,
                    issue_cycle__issue__deleted_at__isnull=True,
                    issue_cycle__deleted_at__isnull=True,
                ),
            )
        )
    )
    old_cycle = old_cycle.first()

    if old_cycle is None:
        return {
            "success": False,
            "error": "Source cycle not found",
        }

    # Check if project uses estimates
    estimate_type = Project.objects.filter(
        workspace__slug=slug,
        pk=project_id,
        estimate__isnull=False,
        estimate__type="points",
    ).exists()

    # Initialize estimate distribution variables
    assignee_estimate_distribution = []
    label_estimate_distribution = []
    estimate_completion_chart = {}

    if estimate_type:
        assignee_estimate_data = (
            Issue.issue_objects.filter(
                issue_cycle__cycle_id=cycle_id,
                issue_cycle__deleted_at__isnull=True,
                workspace__slug=slug,
                project_id=project_id,
            )
            .annotate(display_name=F("assignees__display_name"))
            .annotate(assignee_id=F("assignees__id"))
            .annotate(
                avatar_url=Case(
                    # If `avatar_asset` exists, use it to generate the asset URL
                    When(
                        assignees__avatar_asset__isnull=False,
                        then=Concat(
                            Value("/api/assets/v2/static/"),
                            "assignees__avatar_asset",
                            Value("/"),
                        ),
                    ),
                    # If `avatar_asset` is None, fall back to using `avatar` field directly
                    When(
                        assignees__avatar_asset__isnull=True,
                        then="assignees__avatar",
                    ),
                    default=Value(None),
                    output_field=models.CharField(),
                )
            )
            .values("display_name", "assignee_id", "avatar_url")
            .annotate(total_estimates=Sum(Cast("estimate_point__value", FloatField())))
            .annotate(
                completed_estimates=Sum(
                    Cast("estimate_point__value", FloatField()),
                    filter=Q(
                        completed_at__isnull=False,
                        archived_at__isnull=True,
                        is_draft=False,
                    ),
                )
            )
            .annotate(
                pending_estimates=Sum(
                    Cast("estimate_point__value", FloatField()),
                    filter=Q(
                        completed_at__isnull=True,
                        archived_at__isnull=True,
                        is_draft=False,
                    ),
                )
            )
            .order_by("display_name")
        )
        # Assignee estimate distribution serialization
        assignee_estimate_distribution = [
            {
                "display_name": item["display_name"],
                "assignee_id": (str(item["assignee_id"]) if item["assignee_id"] else None),
                "avatar_url": item.get("avatar_url"),
                "total_estimates": item["total_estimates"],
                "completed_estimates": item["completed_estimates"],
                "pending_estimates": item["pending_estimates"],
            }
            for item in assignee_estimate_data
        ]

        label_distribution_data = (
            Issue.issue_objects.filter(
                issue_cycle__cycle_id=cycle_id,
                issue_cycle__deleted_at__isnull=True,
                workspace__slug=slug,
                project_id=project_id,
            )
            .annotate(label_name=F("labels__name"))
            .annotate(color=F("labels__color"))
            .annotate(label_id=F("labels__id"))
            .values("label_name", "color", "label_id")
            .annotate(total_estimates=Sum(Cast("estimate_point__value", FloatField())))
            .annotate(
                completed_estimates=Sum(
                    Cast("estimate_point__value", FloatField()),
                    filter=Q(
                        completed_at__isnull=False,
                        archived_at__isnull=True,
                        is_draft=False,
                    ),
                )
            )
            .annotate(
                pending_estimates=Sum(
                    Cast("estimate_point__value", FloatField()),
                    filter=Q(
                        completed_at__isnull=True,
                        archived_at__isnull=True,
                        is_draft=False,
                    ),
                )
            )
            .order_by("label_name")
        )

        estimate_completion_chart = burndown_plot(
            queryset=old_cycle,
            slug=slug,
            project_id=project_id,
            plot_type="points",
            cycle_id=cycle_id,
        )
        # Label estimate distribution serialization
        label_estimate_distribution = [
            {
                "label_name": item["label_name"],
                "color": item["color"],
                "label_id": (str(item["label_id"]) if item["label_id"] else None),
                "total_estimates": item["total_estimates"],
                "completed_estimates": item["completed_estimates"],
                "pending_estimates": item["pending_estimates"],
            }
            for item in label_distribution_data
        ]

    # Get the assignee distribution
    assignee_distribution = (
        Issue.issue_objects.filter(
            issue_cycle__cycle_id=cycle_id,
            issue_cycle__deleted_at__isnull=True,
            workspace__slug=slug,
            project_id=project_id,
        )
        .annotate(display_name=F("assignees__display_name"))
        .annotate(assignee_id=F("assignees__id"))
        .annotate(
            avatar_url=Case(
                # If `avatar_asset` exists, use it to generate the asset URL
                When(
                    assignees__avatar_asset__isnull=False,
                    then=Concat(
                        Value("/api/assets/v2/static/"),
                        "assignees__avatar_asset",
                        Value("/"),
                    ),
                ),
                # If `avatar_asset` is None, fall back to using `avatar` field directly
                When(assignees__avatar_asset__isnull=True, then="assignees__avatar"),
                default=Value(None),
                output_field=models.CharField(),
            )
        )
        .values("display_name", "assignee_id", "avatar_url")
        .annotate(total_issues=Count("id", filter=Q(archived_at__isnull=True, is_draft=False)))
        .annotate(
            completed_issues=Count(
                "id",
                filter=Q(
                    completed_at__isnull=False,
                    archived_at__isnull=True,
                    is_draft=False,
                ),
            )
        )
        .annotate(
            pending_issues=Count(
                "id",
                filter=Q(
                    completed_at__isnull=True,
                    archived_at__isnull=True,
                    is_draft=False,
                ),
            )
        )
        .order_by("display_name")
    )
    # Assignee distribution serialized
    assignee_distribution_data = [
        {
            "display_name": item["display_name"],
            "assignee_id": (str(item["assignee_id"]) if item["assignee_id"] else None),
            "avatar_url": item.get("avatar_url"),
            "total_issues": item["total_issues"],
            "completed_issues": item["completed_issues"],
            "pending_issues": item["pending_issues"],
        }
        for item in assignee_distribution
    ]

    # Get the label distribution
    label_distribution = (
        Issue.issue_objects.filter(
            issue_cycle__cycle_id=cycle_id,
            issue_cycle__deleted_at__isnull=True,
            workspace__slug=slug,
            project_id=project_id,
        )
        .annotate(label_name=F("labels__name"))
        .annotate(color=F("labels__color"))
        .annotate(label_id=F("labels__id"))
        .values("label_name", "color", "label_id")
        .annotate(total_issues=Count("id", filter=Q(archived_at__isnull=True, is_draft=False)))
        .annotate(
            completed_issues=Count(
                "id",
                filter=Q(
                    completed_at__isnull=False,
                    archived_at__isnull=True,
                    is_draft=False,
                ),
            )
        )
        .annotate(
            pending_issues=Count(
                "id",
                filter=Q(
                    completed_at__isnull=True,
                    archived_at__isnull=True,
                    is_draft=False,
                ),
            )
        )
        .order_by("label_name")
    )

    # Label distribution serialization
    label_distribution_data = [
        {
            "label_name": item["label_name"],
            "color": item["color"],
            "label_id": (str(item["label_id"]) if item["label_id"] else None),
            "total_issues": item["total_issues"],
            "completed_issues": item["completed_issues"],
            "pending_issues": item["pending_issues"],
        }
        for item in label_distribution
    ]

    # Generate completion chart
    completion_chart = burndown_plot(
        queryset=old_cycle,
        slug=slug,
        project_id=project_id,
        plot_type="issues",
        cycle_id=cycle_id,
    )

    # Get the current cycle and save progress snapshot
    current_cycle = Cycle.objects.filter(workspace__slug=slug, project_id=project_id, pk=cycle_id).first()

    current_cycle.progress_snapshot = {
        "total_issues": old_cycle.total_issues,
        "completed_issues": old_cycle.completed_issues,
        "cancelled_issues": old_cycle.cancelled_issues,
        "started_issues": old_cycle.started_issues,
        "unstarted_issues": old_cycle.unstarted_issues,
        "backlog_issues": old_cycle.backlog_issues,
        "distribution": {
            "labels": label_distribution_data,
            "assignees": assignee_distribution_data,
            "completion_chart": completion_chart,
        },
        "estimate_distribution": (
            {}
            if not estimate_type
            else {
                "labels": label_estimate_distribution,
                "assignees": assignee_estimate_distribution,
                "completion_chart": estimate_completion_chart,
            }
        ),
    }
    current_cycle.save(update_fields=["progress_snapshot"])

    # Get issues to transfer (only incomplete issues)
    cycle_issues = CycleIssue.objects.filter(
        cycle_id=cycle_id,
        project_id=project_id,
        workspace__slug=slug,
        issue__archived_at__isnull=True,
        issue__is_draft=False,
        issue__state__group__in=["backlog", "unstarted", "started"],
    )

    updated_cycles = []
    update_cycle_issue_activity = []
    for cycle_issue in cycle_issues:
        cycle_issue.cycle_id = new_cycle_id
        updated_cycles.append(cycle_issue)
        update_cycle_issue_activity.append(
            {
                "old_cycle_id": str(cycle_id),
                "new_cycle_id": str(new_cycle_id),
                "issue_id": str(cycle_issue.issue_id),
            }
        )

    # Bulk update cycle issues
    cycle_issues = CycleIssue.objects.bulk_update(updated_cycles, ["cycle_id"], batch_size=100)

    # Capture Issue Activity
    issue_activity.delay(
        type="cycle.activity.created",
        requested_data=json.dumps({"cycles_list": []}),
        actor_id=str(user_id),
        issue_id=None,
        project_id=str(project_id),
        current_instance=json.dumps(
            {
                "updated_cycle_issues": update_cycle_issue_activity,
                "created_cycle_issues": [],
            }
        ),
        epoch=int(timezone.now().timestamp()),
        notification=True,
        origin=base_host(request=request, is_app=True),
    )

    return {"success": True}
