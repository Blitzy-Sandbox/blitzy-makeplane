# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery dispatcher converting issue domain events into ``IssueActivity`` audit-trail rows.

This module is the central audit-trail dispatcher for the platform. It is the
single entry point for converting every issue / comment / cycle / module /
link / attachment / relation / reaction / vote / draft / intake change into
one or more ``IssueActivity`` rows and chains the downstream notification work
via a further Celery dispatch.

Trigger:
    Explicit ``issue_activity.delay(...)`` from many callers across the
    codebase, including the cycle, intake, workspace draft, estimate,
    module, issue, attachment, link, reaction, relation, and sub-issue
    view layers under ``apps/api/plane/app/views/``,
    ``apps/api/plane/api/views/``, and ``apps/api/plane/space/views/``,
    plus the auto-archive / auto-close sweep in
    ``apps/api/plane/bgtasks/issue_automation_task.py`` and the
    ``apps/api/plane/utils/cycle_transfer_issues.py`` helper.

Async infrastructure:
    Queued onto RabbitMQ and consumed by Celery workers (per the
    architectural rule that RabbitMQ is the task broker; Redis is used
    only for caching and session state). Inside this task Redis is
    additionally used to stash a 600-second ``origin`` hint keyed by
    ``issue_id`` so downstream consumers can attribute the activity to
    its source surface (``"app"`` / ``"api"`` / ``"live"``).

ACTIVITY_MAPPER coverage:
    The ``ACTIVITY_MAPPER`` dict inside :func:`issue_activity` maps each
    event ``type`` string to its per-event handler. Twenty-seven event
    types are supported:

        - ``issue.activity.{created, updated, deleted}``
        - ``comment.activity.{created, updated, deleted}``
        - ``cycle.activity.{created, deleted}`` (issue/cycle membership)
        - ``module.activity.{created, deleted}`` (issue/module membership)
        - ``link.activity.{created, updated, deleted}``
        - ``attachment.activity.{created, deleted}``
        - ``issue_relation.activity.{created, deleted}``
        - ``issue_reaction.activity.{created, deleted}``
        - ``comment_reaction.activity.{created, deleted}``
        - ``issue_vote.activity.{created, deleted}``
        - ``issue_draft.activity.{created, updated, deleted}``
        - ``intake.activity.created``

Chained task:
    ``notifications.delay(...)`` from
    ``apps/api/plane/bgtasks/notification_task.py`` is invoked when the
    caller passes ``notification=True``. That task creates in-app
    ``Notification`` rows and queues ``EmailNotificationLog`` rows for
    later aggregation by
    ``apps/api/plane/bgtasks/email_notification_task.py``. Webhook
    fan-out and ``IssueVersion`` snapshotting are NOT chained from this
    module — they are dispatched from the caller side (e.g., from the
    view layer) where applicable.
"""

# Python imports
import json


# Third Party imports
from celery import shared_task

# Django imports
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone


# Module imports
from plane.app.serializers import IssueActivitySerializer
from plane.bgtasks.notification_task import notifications
from plane.db.models import (
    CommentReaction,
    Cycle,
    Issue,
    IssueActivity,
    IssueComment,
    IssueReaction,
    IssueSubscriber,
    Label,
    Module,
    Project,
    State,
    User,
    EstimatePoint,
)
from plane.settings.redis import redis_instance
from plane.utils.exception_logger import log_exception
from plane.utils.issue_relation_mapper import get_inverse_relation
from plane.utils.uuid import is_valid_uuid


def extract_ids(data: dict | None, primary_key: str, fallback_key: str) -> set[str]:
    """Return the set of stringified IDs read from ``data[primary_key]`` (else ``data[fallback_key]``).

    Used to normalize the heterogeneous shape of payloads forwarded by
    the various callers — some use ``label_ids`` / ``assignee_ids``
    (the internal app surface) and others use ``labels`` / ``assignees``
    (the external ``/api/v1/`` surface).
    """
    if not data:
        return set()
    if primary_key in data:
        return {str(x) for x in data.get(primary_key, [])}
    return {str(x) for x in data.get(fallback_key, [])}


# Track Changes in name
def track_name(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row for an ``issue.name`` change when the value differs."""
    if current_instance.get("name") != requested_data.get("name"):
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="updated",
                old_value=current_instance.get("name"),
                new_value=requested_data.get("name"),
                field="name",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="updated the name to",
                epoch=epoch,
            )
        )


# Track issue description
def track_description(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append (or coalesce) a description-change ``IssueActivity`` row when ``description_html`` differs.

    Coalescing rule: if the most recent activity on this issue was also a
    description change by the same actor, its ``created_at`` is bumped
    instead of creating a duplicate row — this avoids spamming the
    audit trail during typing bursts.
    """
    if current_instance.get("description_html") != requested_data.get("description_html"):
        last_activity = IssueActivity.objects.filter(issue_id=issue_id).order_by("-created_at").first()
        if (
            last_activity is not None
            and last_activity.field == "description"
            and actor_id == str(last_activity.actor_id)
        ):
            last_activity.created_at = timezone.now()
            last_activity.save(update_fields=["created_at"])
        else:
            issue_activities.append(
                IssueActivity(
                    issue_id=issue_id,
                    actor_id=actor_id,
                    verb="updated",
                    old_value=current_instance.get("description_html"),
                    new_value=requested_data.get("description_html"),
                    field="description",
                    project_id=project_id,
                    workspace_id=workspace_id,
                    comment="updated the description to",
                    epoch=epoch,
                )
            )


# Track changes in parent issue
def track_parent(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row recording a parent-issue change.

    Resolves the new parent's project identifier and sequence id
    (``"<PROJ>-<N>"``) for the human-readable ``old_value`` / ``new_value``
    columns; non-UUID identifier inputs short-circuit the comparison.
    """
    current_parent_id = current_instance.get("parent_id") or current_instance.get("parent")
    requested_parent_id = requested_data.get("parent_id") or requested_data.get("parent")

    # Validate UUIDs before database queries
    if current_parent_id is not None and not is_valid_uuid(current_parent_id):
        return
    if requested_parent_id is not None and not is_valid_uuid(requested_parent_id):
        return

    if current_parent_id != requested_parent_id:
        old_parent = Issue.objects.filter(pk=current_parent_id).first() if current_parent_id is not None else None
        new_parent = Issue.objects.filter(pk=requested_parent_id).first() if requested_parent_id is not None else None

        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="updated",
                old_value=(
                    f"{old_parent.project.identifier}-{old_parent.sequence_id}" if old_parent is not None else ""
                ),
                new_value=(
                    f"{new_parent.project.identifier}-{new_parent.sequence_id}" if new_parent is not None else ""
                ),
                field="parent",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="updated the parent issue to",
                old_identifier=(old_parent.id if old_parent is not None else None),
                new_identifier=(new_parent.id if new_parent is not None else None),
                epoch=epoch,
            )
        )


# Track changes in priority
def track_priority(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row for an ``issue.priority`` change when the value differs."""
    if current_instance.get("priority") != requested_data.get("priority"):
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="updated",
                old_value=current_instance.get("priority"),
                new_value=requested_data.get("priority"),
                field="priority",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="updated the priority to",
                epoch=epoch,
            )
        )


# Track changes in state of the issue
def track_state(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row recording a state transition.

    Looks up both the old and new ``State`` rows by project-scoped UUID
    so the activity stores human-readable state names alongside the
    foreign-key identifiers.
    """
    current_state_id = current_instance.get("state_id") or current_instance.get("state")
    requested_state_id = requested_data.get("state_id") or requested_data.get("state")

    if current_state_id is not None and not is_valid_uuid(current_state_id):
        current_state_id = None
    if requested_state_id is not None and not is_valid_uuid(requested_state_id):
        requested_state_id = None

    if current_state_id != requested_state_id:
        new_state = State.objects.filter(pk=requested_state_id, project_id=project_id).first()
        old_state = State.objects.filter(pk=current_state_id, project_id=project_id).first()

        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="updated",
                old_value=old_state.name if old_state else None,
                new_value=new_state.name if new_state else None,
                field="state",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="updated the state to",
                old_identifier=old_state.id if old_state else None,
                new_identifier=new_state.id if new_state else None,
                epoch=epoch,
            )
        )


# Track changes in issue target date
def track_target_date(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row for an ``issue.target_date`` change when the value differs.

    ``None`` values are normalized to the empty string in the activity
    row so the audit trail surfaces "(no date)" cleanly in the UI.
    """
    if current_instance.get("target_date") != requested_data.get("target_date"):
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="updated",
                old_value=(
                    current_instance.get("target_date") if current_instance.get("target_date") is not None else ""
                ),
                new_value=(requested_data.get("target_date") if requested_data.get("target_date") is not None else ""),
                field="target_date",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="updated the target date to",
                epoch=epoch,
            )
        )


# Track changes in issue start date
def track_start_date(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row for an ``issue.start_date`` change when the value differs.

    ``None`` values are normalized to the empty string in the activity
    row so the audit trail surfaces "(no date)" cleanly in the UI.
    """
    if current_instance.get("start_date") != requested_data.get("start_date"):
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="updated",
                old_value=(
                    current_instance.get("start_date") if current_instance.get("start_date") is not None else ""
                ),
                new_value=(requested_data.get("start_date") if requested_data.get("start_date") is not None else ""),
                field="start_date",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="updated the start date to ",
                epoch=epoch,
            )
        )


# Track changes in issue labels
def track_labels(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append one ``IssueActivity`` row per added and per dropped label.

    Computes the set difference of requested vs. current labels using
    :func:`extract_ids` (which transparently handles both the
    ``label_ids`` and the ``labels`` payload shapes) and emits one row
    per change with the label name in ``old_value`` / ``new_value``.
    """
    # Labels
    requested_labels = extract_ids(requested_data, "label_ids", "labels")
    current_labels = extract_ids(current_instance, "label_ids", "labels")

    added_labels = requested_labels - current_labels
    dropped_labels = current_labels - requested_labels

    # Set of newly added labels
    for added_label in added_labels:
        # validate uuids
        if not is_valid_uuid(added_label):
            continue

        label = Label.objects.get(pk=added_label)
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                project_id=project_id,
                workspace_id=workspace_id,
                verb="updated",
                field="labels",
                comment="added label ",
                old_value="",
                new_value=label.name,
                new_identifier=label.id,
                old_identifier=None,
                epoch=epoch,
            )
        )

    # Set of dropped labels
    for dropped_label in dropped_labels:
        # validate uuids
        if not is_valid_uuid(dropped_label):
            continue

        label = Label.objects.get(pk=dropped_label)
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="updated",
                old_value=label.name,
                new_value="",
                field="labels",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="removed label ",
                old_identifier=label.id,
                new_identifier=None,
                epoch=epoch,
            )
        )


# Track changes in issue assignees
def track_assignees(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append one ``IssueActivity`` row per added/dropped assignee and auto-subscribe new assignees.

    For each newly added assignee, an ``IssueSubscriber`` row is also
    bulk-created (``ignore_conflicts=True``) so the new assignee receives
    future notifications about the issue. Removed assignees are NOT
    auto-unsubscribed — that is a separate user-driven action.
    """
    # Assignees
    requested_assignees = extract_ids(requested_data, "assignee_ids", "assignees")
    current_assignees = extract_ids(current_instance, "assignee_ids", "assignees")

    added_assignees = requested_assignees - current_assignees
    dropped_assginees = current_assignees - requested_assignees

    bulk_subscribers = []
    for added_asignee in added_assignees:
        # validate uuids
        if not is_valid_uuid(added_asignee):
            continue

        assignee = User.objects.get(pk=added_asignee)
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="updated",
                old_value="",
                new_value=assignee.display_name,
                field="assignees",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="added assignee ",
                new_identifier=assignee.id,
                epoch=epoch,
            )
        )
        bulk_subscribers.append(
            IssueSubscriber(
                subscriber_id=assignee.id,
                issue_id=issue_id,
                workspace_id=workspace_id,
                project_id=project_id,
                created_by_id=assignee.id,
                updated_by_id=assignee.id,
            )
        )

    # Create assignees subscribers to the issue and ignore if already
    IssueSubscriber.objects.bulk_create(bulk_subscribers, batch_size=10, ignore_conflicts=True)

    for dropped_assignee in dropped_assginees:
        # validate uuids
        if not is_valid_uuid(dropped_assignee):
            continue

        assignee = User.objects.get(pk=dropped_assignee)
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="updated",
                old_value=assignee.display_name,
                new_value="",
                field="assignees",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="removed assignee ",
                old_identifier=assignee.id,
                epoch=epoch,
            )
        )


def track_estimate_points(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row recording an estimate-point change.

    The activity ``field`` is suffixed with the estimate's
    ``estimate.type`` (e.g., ``"estimate_points"`` /
    ``"estimate_categories"`` / ``"estimate_time"``) so the UI can
    render the appropriate widget; the verb is ``"removed"`` when the
    new estimate is cleared and ``"updated"`` otherwise.
    """
    if current_instance.get("estimate_point") != requested_data.get("estimate_point"):
        old_estimate = (
            EstimatePoint.objects.filter(pk=current_instance.get("estimate_point")).first()
            if current_instance.get("estimate_point") is not None
            else None
        )
        new_estimate = (
            EstimatePoint.objects.filter(pk=requested_data.get("estimate_point")).first()
            if requested_data.get("estimate_point") is not None
            else None
        )
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="removed" if new_estimate is None else "updated",
                old_identifier=(
                    current_instance.get("estimate_point")
                    if current_instance.get("estimate_point") is not None
                    else None
                ),
                new_identifier=(
                    requested_data.get("estimate_point") if requested_data.get("estimate_point") is not None else None
                ),
                old_value=old_estimate.value if old_estimate else None,
                new_value=new_estimate.value if new_estimate else None,
                field="estimate_" + new_estimate.estimate.type,
                project_id=project_id,
                workspace_id=workspace_id,
                comment="updated the estimate point to ",
                epoch=epoch,
            )
        )


def track_archive_at(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row for archive / restore / auto-archive transitions.

    Distinguishes three transitions: restoration (``archived_at`` becomes
    ``None``), automated archive (``requested_data["automation"]`` is
    truthy → ``new_value="archive"``), and manual archive
    (``new_value="manual_archive"``). The transition kind is encoded in
    the row's ``comment`` and ``new_value`` so the UI can render
    "Plane archived" vs. "Actor archived" distinctly.
    """
    if current_instance.get("archived_at") != requested_data.get("archived_at"):
        if requested_data.get("archived_at") is None:
            issue_activities.append(
                IssueActivity(
                    issue_id=issue_id,
                    project_id=project_id,
                    workspace_id=workspace_id,
                    comment="has restored the issue",
                    verb="updated",
                    actor_id=actor_id,
                    field="archived_at",
                    old_value="archive",
                    new_value="restore",
                    epoch=epoch,
                )
            )
        else:
            if requested_data.get("automation"):
                comment = "Plane has archived the issue"
                new_value = "archive"
            else:
                comment = "Actor has archived the issue"
                new_value = "manual_archive"
            issue_activities.append(
                IssueActivity(
                    issue_id=issue_id,
                    project_id=project_id,
                    workspace_id=workspace_id,
                    comment=comment,
                    verb="updated",
                    actor_id=actor_id,
                    field="archived_at",
                    old_value=None,
                    new_value=new_value,
                    epoch=epoch,
                )
            )


def track_closed_to(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row recording an automated state transition into ``closed_to``.

    Emitted by the auto-close sweep in
    ``apps/api/plane/bgtasks/issue_automation_task.py`` when the
    workspace's auto-close policy moves an inactive issue into its
    configured terminal ``State``. The actor is the user who applied the
    automation policy.
    """
    if requested_data.get("closed_to") is not None:
        updated_state = State.objects.get(pk=requested_data.get("closed_to"), project_id=project_id)
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="updated",
                old_value=None,
                new_value=updated_state.name,
                field="state",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="Plane updated the state to ",
                old_identifier=None,
                new_identifier=updated_state.id,
                epoch=epoch,
            )
        )


def create_issue_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Record the "created the issue" ``IssueActivity`` plus any initial-assignee rows.

    Writes the seed ``IssueActivity`` row immediately (not via the
    bulk-create batch in :func:`issue_activity`) so the row's
    ``created_at`` and ``actor_id`` can be back-dated to the originating
    ``Issue`` instance; subsequent assignee rows are appended to the
    caller-provided ``issue_activities`` list. Called via
    ``ACTIVITY_MAPPER["issue.activity.created"]`` from
    :func:`issue_activity`.
    """
    issue = Issue.objects.get(pk=issue_id)
    issue_activity = IssueActivity.objects.create(
        issue_id=issue_id,
        project_id=project_id,
        workspace_id=workspace_id,
        comment="created the issue",
        verb="created",
        actor_id=actor_id,
        epoch=epoch,
    )
    issue_activity.created_at = issue.created_at
    issue_activity.actor_id = issue.created_by_id
    issue_activity.save(update_fields=["created_at", "actor_id"])
    requested_data = json.loads(requested_data) if requested_data is not None else None
    if requested_data.get("assignee_ids") is not None:
        track_assignees(
            requested_data,
            current_instance,
            issue_id,
            project_id,
            workspace_id,
            actor_id,
            issue_activities,
            epoch,
        )


def update_issue_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Dispatch per-field ``track_*`` helpers for each changed field in an issue update.

    Maintains a local ``ISSUE_ACTIVITY_MAPPER`` from field key to tracker
    function so that both the internal ``app`` surface (which uses keys
    like ``state_id`` / ``parent_id`` / ``label_ids`` / ``assignee_ids``)
    and the external ``api/v1`` surface (which uses ``state`` /
    ``parent`` / ``labels`` / ``assignees``) are dispatched correctly.
    Each tracker appends 0..N rows to ``issue_activities``. Called via
    ``ACTIVITY_MAPPER["issue.activity.updated"]`` from
    :func:`issue_activity`.
    """
    ISSUE_ACTIVITY_MAPPER = {
        "name": track_name,
        "parent_id": track_parent,
        "priority": track_priority,
        "state_id": track_state,
        "description_html": track_description,
        "target_date": track_target_date,
        "start_date": track_start_date,
        "label_ids": track_labels,
        "assignee_ids": track_assignees,
        "estimate_point": track_estimate_points,
        "archived_at": track_archive_at,
        "closed_to": track_closed_to,
        # External endpoint keys
        "parent": track_parent,
        "state": track_state,
        "assignees": track_assignees,
        "labels": track_labels,
    }

    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None

    for key in requested_data:
        func = ISSUE_ACTIVITY_MAPPER.get(key)
        if func is not None:
            func(
                requested_data=requested_data,
                current_instance=current_instance,
                issue_id=issue_id,
                project_id=project_id,
                workspace_id=workspace_id,
                actor_id=actor_id,
                issue_activities=issue_activities,
                epoch=epoch,
            )


def delete_issue_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append the "deleted the issue" ``IssueActivity`` row.

    Called via ``ACTIVITY_MAPPER["issue.activity.deleted"]`` from
    :func:`issue_activity`.
    """
    issue_activities.append(
        IssueActivity(
            project_id=project_id,
            workspace_id=workspace_id,
            issue_id=issue_id,
            comment="deleted the issue",
            verb="deleted",
            actor_id=actor_id,
            field="issue",
            epoch=epoch,
        )
    )


def create_comment_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row recording a new ``IssueComment``.

    Stores the new comment's HTML body in ``new_value`` and the comment
    primary key in both ``new_identifier`` and ``issue_comment_id`` so
    the audit-trail UI can deep-link back to the comment. Called via
    ``ACTIVITY_MAPPER["comment.activity.created"]`` from
    :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None

    issue_activities.append(
        IssueActivity(
            issue_id=issue_id,
            project_id=project_id,
            workspace_id=workspace_id,
            comment="created a comment",
            verb="created",
            actor_id=actor_id,
            field="comment",
            new_value=requested_data.get("comment_html", ""),
            new_identifier=requested_data.get("id", None),
            issue_comment_id=requested_data.get("id", None),
            epoch=epoch,
        )
    )


def update_comment_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row when an ``IssueComment``'s HTML body changes.

    No row is emitted when the body is unchanged (e.g., metadata-only
    edits). Called via ``ACTIVITY_MAPPER["comment.activity.updated"]``
    from :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None

    if current_instance.get("comment_html") != requested_data.get("comment_html"):
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                project_id=project_id,
                workspace_id=workspace_id,
                comment="updated a comment",
                verb="updated",
                actor_id=actor_id,
                field="comment",
                old_value=current_instance.get("comment_html", ""),
                old_identifier=current_instance.get("id"),
                new_value=requested_data.get("comment_html", ""),
                new_identifier=current_instance.get("id", None),
                issue_comment_id=current_instance.get("id", None),
                epoch=epoch,
            )
        )


def delete_comment_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row recording deletion of an ``IssueComment``.

    Stores the removed comment's primary key in ``issue_comment_id`` so
    the audit trail retains the linkage even after the comment row is
    gone. Called via ``ACTIVITY_MAPPER["comment.activity.deleted"]``
    from :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    issue_activities.append(
        IssueActivity(
            issue_comment_id=requested_data.get("comment_id", None),
            issue_id=issue_id,
            project_id=project_id,
            workspace_id=workspace_id,
            comment="deleted the comment",
            verb="deleted",
            actor_id=actor_id,
            field="comment",
            epoch=epoch,
        )
    )


def create_cycle_issue_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append ``IssueActivity`` rows for issue/cycle membership additions and moves.

    Handles two payload sub-shapes from the bulk cycle endpoint:

    - ``updated_cycle_issues``: each entry is an existing
      ``CycleIssue`` whose ``cycle_id`` changed; emits a ``verb="updated"``
      row capturing both the old and new cycle.
    - ``created_cycle_issues``: each entry is a newly inserted
      ``CycleIssue``; emits a ``verb="created"`` row.

    For every affected issue, ``issue.updated_at`` is also bumped so
    consumers (search index, recent-activity widgets) see the move.
    Called via ``ACTIVITY_MAPPER["cycle.activity.created"]`` from
    :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None

    # Updated Records:
    updated_records = current_instance.get("updated_cycle_issues", [])
    created_records = json.loads(current_instance.get("created_cycle_issues", []))

    for updated_record in updated_records:
        old_cycle = Cycle.objects.filter(pk=updated_record.get("old_cycle_id", None)).first()
        new_cycle = Cycle.objects.filter(pk=updated_record.get("new_cycle_id", None)).first()
        issue = Issue.objects.filter(pk=updated_record.get("issue_id")).first()
        if issue:
            issue.updated_at = timezone.now()
            issue.save(update_fields=["updated_at"])

        issue_activities.append(
            IssueActivity(
                issue_id=updated_record.get("issue_id"),
                actor_id=actor_id,
                verb="updated",
                old_value=old_cycle.name if old_cycle else "",
                new_value=new_cycle.name if new_cycle else "",
                field="cycles",
                project_id=project_id,
                workspace_id=workspace_id,
                comment=f"""updated cycle from {old_cycle.name if old_cycle else ""}
                to {new_cycle.name if new_cycle else ""}""",
                old_identifier=old_cycle.id if old_cycle else None,
                new_identifier=new_cycle.id if new_cycle else None,
                epoch=epoch,
            )
        )

    for created_record in created_records:
        cycle = Cycle.objects.filter(pk=created_record.get("fields").get("cycle")).first()
        issue = Issue.objects.filter(pk=created_record.get("fields").get("issue")).first()
        if issue:
            issue.updated_at = timezone.now()
            issue.save(update_fields=["updated_at"])

        issue_activities.append(
            IssueActivity(
                issue_id=created_record.get("fields").get("issue"),
                actor_id=actor_id,
                verb="created",
                old_value="",
                new_value=cycle.name,
                field="cycles",
                project_id=project_id,
                workspace_id=workspace_id,
                comment=f"added cycle {cycle.name}",
                new_identifier=cycle.id,
                epoch=epoch,
            )
        )


def delete_cycle_issue_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append one ``IssueActivity`` row per issue removed from a cycle.

    The cycle name is resolved from the database when possible and
    falls back to the payload-supplied ``cycle_name``; ``issue.updated_at``
    is bumped for each affected issue. Called via
    ``ACTIVITY_MAPPER["cycle.activity.deleted"]`` from
    :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None

    cycle_id = requested_data.get("cycle_id", "")
    cycle_name = requested_data.get("cycle_name", "")
    cycle = Cycle.objects.filter(pk=cycle_id).first()
    issues = requested_data.get("issues")
    for issue in issues:
        current_issue = Issue.objects.filter(pk=issue).first()
        if current_issue:
            current_issue.updated_at = timezone.now()
            current_issue.save(update_fields=["updated_at"])
        issue_activities.append(
            IssueActivity(
                issue_id=issue,
                actor_id=actor_id,
                verb="deleted",
                old_value=cycle.name if cycle is not None else cycle_name,
                new_value="",
                field="cycles",
                project_id=project_id,
                workspace_id=workspace_id,
                comment=f"removed this issue from {cycle.name if cycle is not None else cycle_name}",
                old_identifier=cycle_id if cycle_id is not None else None,
                epoch=epoch,
            )
        )


def create_module_issue_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row when an issue is added to a ``Module``.

    Resolves the ``Module`` row to surface the module name in the
    activity comment; ``issue.updated_at`` is bumped so consumers see
    the change. Called via
    ``ACTIVITY_MAPPER["module.activity.created"]`` from
    :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    module = Module.objects.filter(pk=requested_data.get("module_id")).first()
    issue = Issue.objects.filter(pk=issue_id).first()
    if issue:
        issue.updated_at = timezone.now()
        issue.save(update_fields=["updated_at"])
    issue_activities.append(
        IssueActivity(
            issue_id=issue_id,
            actor_id=actor_id,
            verb="created",
            old_value="",
            new_value=module.name if module else "",
            field="modules",
            project_id=project_id,
            workspace_id=workspace_id,
            comment=f"added module {module.name if module else ''}",
            new_identifier=requested_data.get("module_id"),
            epoch=epoch,
        )
    )


def delete_module_issue_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row when an issue is removed from a ``Module``.

    Uses the module name carried in ``current_instance`` to keep the
    label stable even after the row's removal; ``issue.updated_at`` is
    bumped. Called via ``ACTIVITY_MAPPER["module.activity.deleted"]``
    from :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None
    module_name = current_instance.get("module_name")
    current_issue = Issue.objects.filter(pk=issue_id).first()
    if current_issue:
        current_issue.updated_at = timezone.now()
        current_issue.save(update_fields=["updated_at"])
    issue_activities.append(
        IssueActivity(
            issue_id=issue_id,
            actor_id=actor_id,
            verb="deleted",
            old_value=module_name,
            new_value="",
            field="modules",
            project_id=project_id,
            workspace_id=workspace_id,
            comment=f"removed this issue from {module_name}",
            old_identifier=(requested_data.get("module_id") if requested_data.get("module_id") is not None else None),
            epoch=epoch,
        )
    )


def create_link_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    actor_id,
    workspace_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row recording a new ``IssueLink``.

    Stores the link's URL in ``new_value`` and its primary key in
    ``new_identifier``. Called via
    ``ACTIVITY_MAPPER["link.activity.created"]`` from
    :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None

    issue_activities.append(
        IssueActivity(
            issue_id=issue_id,
            project_id=project_id,
            workspace_id=workspace_id,
            comment="created a link",
            verb="created",
            actor_id=actor_id,
            field="link",
            new_value=requested_data.get("url", ""),
            new_identifier=requested_data.get("id", None),
            epoch=epoch,
        )
    )


def update_link_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row when an ``IssueLink``'s URL changes.

    Title-only edits do not produce a row. Called via
    ``ACTIVITY_MAPPER["link.activity.updated"]`` from
    :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None

    if current_instance.get("url") != requested_data.get("url"):
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                project_id=project_id,
                workspace_id=workspace_id,
                comment="updated a link",
                verb="updated",
                actor_id=actor_id,
                field="link",
                old_value=current_instance.get("url", ""),
                old_identifier=current_instance.get("id"),
                new_value=requested_data.get("url", ""),
                new_identifier=current_instance.get("id", None),
                epoch=epoch,
            )
        )


def delete_link_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row recording deletion of an ``IssueLink``.

    Captures the removed URL in ``old_value`` for the audit trail.
    Called via ``ACTIVITY_MAPPER["link.activity.deleted"]`` from
    :func:`issue_activity`.
    """
    current_instance = json.loads(current_instance) if current_instance is not None else None

    issue_activities.append(
        IssueActivity(
            issue_id=issue_id,
            project_id=project_id,
            workspace_id=workspace_id,
            comment="deleted the link",
            verb="deleted",
            actor_id=actor_id,
            field="link",
            old_value=current_instance.get("url", ""),
            new_value="",
            epoch=epoch,
        )
    )


def create_attachment_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    actor_id,
    workspace_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row recording a new ``FileAsset`` attachment.

    Stores the storage key (``asset``) in ``new_value`` and the asset's
    primary key in ``new_identifier`` so the audit trail can deep-link
    back to the attachment. Called via
    ``ACTIVITY_MAPPER["attachment.activity.created"]`` from
    :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None

    issue_activities.append(
        IssueActivity(
            issue_id=issue_id,
            project_id=project_id,
            workspace_id=workspace_id,
            comment="created an attachment",
            verb="created",
            actor_id=actor_id,
            field="attachment",
            new_value=current_instance.get("asset", ""),
            new_identifier=current_instance.get("id", None),
            epoch=epoch,
        )
    )


def delete_attachment_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row recording removal of an attachment.

    The row does not echo the asset key (a separate ``FileAsset``
    cleanup task tombstones the underlying object). Called via
    ``ACTIVITY_MAPPER["attachment.activity.deleted"]`` from
    :func:`issue_activity`.
    """
    issue_activities.append(
        IssueActivity(
            issue_id=issue_id,
            project_id=project_id,
            workspace_id=workspace_id,
            comment="deleted the attachment",
            verb="deleted",
            actor_id=actor_id,
            field="attachment",
            epoch=epoch,
        )
    )


def create_issue_reaction_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row when the actor adds an emoji reaction to an issue.

    Looks up the freshly inserted ``IssueReaction`` row id by
    (``reaction``, ``project_id``, ``actor_id``) and stores it in
    ``new_identifier``; the emoji shortcode is stored in ``new_value``.
    Called via ``ACTIVITY_MAPPER["issue_reaction.activity.created"]``
    from :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    if requested_data and requested_data.get("reaction") is not None:
        issue_reaction = (
            IssueReaction.objects.filter(
                reaction=requested_data.get("reaction"),
                project_id=project_id,
                actor_id=actor_id,
            )
            .values_list("id", flat=True)
            .first()
        )
        if issue_reaction is not None:
            issue_activities.append(
                IssueActivity(
                    issue_id=issue_id,
                    actor_id=actor_id,
                    verb="created",
                    old_value=None,
                    new_value=requested_data.get("reaction"),
                    field="reaction",
                    project_id=project_id,
                    workspace_id=workspace_id,
                    comment="added the reaction",
                    old_identifier=None,
                    new_identifier=issue_reaction,
                    epoch=epoch,
                )
            )


def delete_issue_reaction_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row when the actor removes their reaction from an issue.

    Stores the removed emoji shortcode in ``old_value`` and the prior
    ``IssueReaction`` id in ``old_identifier``. Called via
    ``ACTIVITY_MAPPER["issue_reaction.activity.deleted"]`` from
    :func:`issue_activity`.
    """
    current_instance = json.loads(current_instance) if current_instance is not None else None
    if current_instance and current_instance.get("reaction") is not None:
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="deleted",
                old_value=current_instance.get("reaction"),
                new_value=None,
                field="reaction",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="removed the reaction",
                old_identifier=current_instance.get("identifier"),
                new_identifier=None,
                epoch=epoch,
            )
        )


def create_comment_reaction_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row when the actor adds an emoji reaction to a comment.

    Resolves the ``CommentReaction`` row and joins through to the parent
    ``IssueComment.issue_id`` so the activity is filed against the issue
    that owns the comment (not the comment itself). Called via
    ``ACTIVITY_MAPPER["comment_reaction.activity.created"]`` from
    :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    if requested_data and requested_data.get("reaction") is not None:
        comment_reaction_id, comment_id = (
            CommentReaction.objects.filter(
                reaction=requested_data.get("reaction"),
                project_id=project_id,
                actor_id=actor_id,
            )
            .values_list("id", "comment__id")
            .first()
        )
        comment = IssueComment.objects.get(pk=comment_id, project_id=project_id)
        if comment is not None and comment_reaction_id is not None and comment_id is not None:
            issue_activities.append(
                IssueActivity(
                    issue_id=comment.issue_id,
                    actor_id=actor_id,
                    verb="created",
                    old_value=None,
                    new_value=requested_data.get("reaction"),
                    field="reaction",
                    project_id=project_id,
                    workspace_id=workspace_id,
                    comment="added the reaction",
                    old_identifier=None,
                    new_identifier=comment_reaction_id,
                    epoch=epoch,
                )
            )


def delete_comment_reaction_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row when the actor removes their reaction from a comment.

    Re-resolves the parent ``issue_id`` from the comment because the
    reaction itself may already be gone; emits no row if the parent
    comment cannot be found. Called via
    ``ACTIVITY_MAPPER["comment_reaction.activity.deleted"]`` from
    :func:`issue_activity`.
    """
    current_instance = json.loads(current_instance) if current_instance is not None else None
    if current_instance and current_instance.get("reaction") is not None:
        issue_id = (
            IssueComment.objects.filter(pk=current_instance.get("comment_id"), project_id=project_id)
            .values_list("issue_id", flat=True)
            .first()
        )
        if issue_id is not None:
            issue_activities.append(
                IssueActivity(
                    issue_id=issue_id,
                    actor_id=actor_id,
                    verb="deleted",
                    old_value=current_instance.get("reaction"),
                    new_value=None,
                    field="reaction",
                    project_id=project_id,
                    workspace_id=workspace_id,
                    comment="removed the reaction",
                    old_identifier=current_instance.get("identifier"),
                    new_identifier=None,
                    epoch=epoch,
                )
            )


def create_issue_vote_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row when the actor casts an upvote/downvote on a public-spaces issue.

    Used by the deployed-spaces voting flow; the vote value
    (``1`` upvote / ``-1`` downvote) is stored in ``new_value``. Called
    via ``ACTIVITY_MAPPER["issue_vote.activity.created"]`` from
    :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    if requested_data and requested_data.get("vote") is not None:
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="updated",
                old_value=None,
                new_value=requested_data.get("vote"),
                field="vote",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="added the vote",
                old_identifier=None,
                new_identifier=None,
                epoch=epoch,
            )
        )


def delete_issue_vote_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row when the actor retracts their vote on a public-spaces issue.

    Records the prior vote value in ``old_value``. Called via
    ``ACTIVITY_MAPPER["issue_vote.activity.deleted"]`` from
    :func:`issue_activity`.
    """
    current_instance = json.loads(current_instance) if current_instance is not None else None
    if current_instance and current_instance.get("vote") is not None:
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                actor_id=actor_id,
                verb="deleted",
                old_value=current_instance.get("vote"),
                new_value=None,
                field="vote",
                project_id=project_id,
                workspace_id=workspace_id,
                comment="removed the vote",
                old_identifier=current_instance.get("identifier"),
                new_identifier=None,
                epoch=epoch,
            )
        )


def create_issue_relation_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append two ``IssueActivity`` rows per new relation: one on each side of the link.

    For every related issue, records a forward row on the originating
    issue (``field=relation_type``) and an inverse row on the related
    issue using :func:`get_inverse_relation` to map e.g.
    ``"blocked_by"`` → ``"blocking"``. The human-readable
    ``"<PROJ>-<N>"`` identifier is stored in ``new_value`` on each side.
    Called via ``ACTIVITY_MAPPER["issue_relation.activity.created"]``
    from :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None
    if current_instance is None and requested_data.get("issues") is not None:
        for related_issue in requested_data.get("issues"):
            issue = Issue.objects.get(pk=related_issue)
            issue_activities.append(
                IssueActivity(
                    issue_id=issue_id,
                    actor_id=actor_id,
                    verb="updated",
                    old_value="",
                    new_value=f"{issue.project.identifier}-{issue.sequence_id}",
                    field=requested_data.get("relation_type"),
                    project_id=project_id,
                    workspace_id=workspace_id,
                    comment=f"added {requested_data.get('relation_type')} relation",
                    old_identifier=related_issue,
                    epoch=epoch,
                )
            )
            inverse_relation = get_inverse_relation(requested_data.get("relation_type"))
            issue = Issue.objects.get(pk=issue_id)
            issue_activities.append(
                IssueActivity(
                    issue_id=related_issue,
                    actor_id=actor_id,
                    verb="updated",
                    old_value="",
                    new_value=f"{issue.project.identifier}-{issue.sequence_id}",
                    field=inverse_relation,
                    project_id=project_id,
                    workspace_id=workspace_id,
                    comment=f"added {inverse_relation} relation",
                    old_identifier=issue_id,
                    epoch=epoch,
                )
            )


def delete_issue_relation_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append two ``IssueActivity`` rows per removed relation: one on each side of the link.

    The inverse-side ``field`` is mapped explicitly for the
    ``blocked_by`` / ``blocking`` pair (inverse-lookup is inlined here
    rather than via :func:`get_inverse_relation`); other relation kinds
    use the same field name on both sides. Called via
    ``ACTIVITY_MAPPER["issue_relation.activity.deleted"]`` from
    :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None
    issue = Issue.objects.get(pk=requested_data.get("related_issue"))
    issue_activities.append(
        IssueActivity(
            issue_id=issue_id,
            actor_id=actor_id,
            verb="deleted",
            old_value=f"{issue.project.identifier}-{issue.sequence_id}",
            new_value="",
            field=requested_data.get("relation_type"),
            project_id=project_id,
            workspace_id=workspace_id,
            comment=f"deleted {requested_data.get('relation_type')} relation",
            old_identifier=requested_data.get("related_issue"),
            epoch=epoch,
        )
    )
    issue = Issue.objects.get(pk=issue_id)
    issue_activities.append(
        IssueActivity(
            issue_id=requested_data.get("related_issue"),
            actor_id=actor_id,
            verb="deleted",
            old_value=f"{issue.project.identifier}-{issue.sequence_id}",
            new_value="",
            field=(
                "blocking"
                if requested_data.get("relation_type") == "blocked_by"
                else (
                    "blocked_by"
                    if requested_data.get("relation_type") == "blocking"
                    else requested_data.get("relation_type")
                )
            ),
            project_id=project_id,
            workspace_id=workspace_id,
            comment=f"deleted {requested_data.get('relation_type')} relation",
            old_identifier=requested_data.get("related_issue"),
            epoch=epoch,
        )
    )


def create_draft_issue_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append a "drafted the issue" ``IssueActivity`` for a new ``DraftIssue``.

    Called via ``ACTIVITY_MAPPER["issue_draft.activity.created"]`` from
    :func:`issue_activity`.
    """
    issue_activities.append(
        IssueActivity(
            issue_id=issue_id,
            project_id=project_id,
            workspace_id=workspace_id,
            comment="drafted the issue",
            field="draft",
            verb="created",
            actor_id=actor_id,
            epoch=epoch,
        )
    )


def update_draft_issue_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row for a draft-issue update or promotion to a real issue.

    Two cases:

    - ``is_draft`` transitions to ``False``: emits a "created the issue"
      row with no ``field`` (the draft has been promoted to a regular
      ``Issue``).
    - Otherwise: emits an "updated the draft issue" row with
      ``field="draft"``.

    Called via ``ACTIVITY_MAPPER["issue_draft.activity.updated"]`` from
    :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None
    if requested_data.get("is_draft") is not None and requested_data.get("is_draft") is False:
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                project_id=project_id,
                workspace_id=workspace_id,
                comment="created the issue",
                verb="updated",
                actor_id=actor_id,
                epoch=epoch,
            )
        )
    else:
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                project_id=project_id,
                workspace_id=workspace_id,
                comment="updated the draft issue",
                field="draft",
                verb="updated",
                actor_id=actor_id,
                epoch=epoch,
            )
        )


def delete_draft_issue_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append a "deleted the draft issue" ``IssueActivity`` row.

    The row is filed without an ``issue_id`` because the source draft
    row no longer exists. Called via
    ``ACTIVITY_MAPPER["issue_draft.activity.deleted"]`` from
    :func:`issue_activity`.
    """
    issue_activities.append(
        IssueActivity(
            project_id=project_id,
            workspace_id=workspace_id,
            comment="deleted the draft issue",
            field="draft",
            verb="deleted",
            actor_id=actor_id,
            epoch=epoch,
        )
    )


def create_intake_activity(
    requested_data,
    current_instance,
    issue_id,
    project_id,
    workspace_id,
    actor_id,
    issue_activities,
    epoch,
):
    """Append an ``IssueActivity`` row recording an intake-status transition.

    Translates the integer ``IntakeIssue.status`` enum values
    (``-2``: Pending, ``-1``: Rejected, ``0``: Snoozed, ``1``: Accepted,
    ``2``: Duplicate) into their human-readable labels for the
    ``old_value`` / ``new_value`` columns; the integer is stored in
    ``verb``. Called via ``ACTIVITY_MAPPER["intake.activity.created"]``
    from :func:`issue_activity`.
    """
    requested_data = json.loads(requested_data) if requested_data is not None else None
    current_instance = json.loads(current_instance) if current_instance is not None else None
    status_dict = {
        -2: "Pending",
        -1: "Rejected",
        0: "Snoozed",
        1: "Accepted",
        2: "Duplicate",
    }
    if requested_data.get("status") is not None:
        issue_activities.append(
            IssueActivity(
                issue_id=issue_id,
                project_id=project_id,
                workspace_id=workspace_id,
                comment="updated the intake status",
                field="intake",
                verb=requested_data.get("status"),
                actor_id=actor_id,
                epoch=epoch,
                old_value=status_dict.get(current_instance.get("status")),
                new_value=status_dict.get(requested_data.get("status")),
            )
        )


# Receive message from room group
@shared_task
def issue_activity(
    type,
    requested_data,
    current_instance,
    issue_id,
    actor_id,
    project_id,
    epoch,
    subscriber=True,
    notification=False,
    origin=None,
    intake=None,
):
    """Dispatch ``ACTIVITY_MAPPER[type]`` and conditionally chain to ``notifications``.

    Trigger:
        Explicit ``issue_activity.delay(type, requested_data,
        current_instance, issue_id, actor_id, project_id, epoch,
        subscriber=True, notification=False, origin=None, intake=None)``
        from many callers across the codebase (see module docstring for
        the full list). Queued onto RabbitMQ and consumed by a Celery
        worker.

    Side effects:
        - **Dispatch**: looks up ``ACTIVITY_MAPPER[type]`` to find the
          per-event-type handler. The handler diffs ``requested_data``
          against ``current_instance`` and appends ``IssueActivity``
          model instances to a local list. Events whose ``type`` is not
          in the mapper are silently no-ops at the dispatch step.
        - **DB write (``Issue``)**: when ``issue_id`` is provided, the
          owning issue's ``updated_at`` timestamp is bumped (errors are
          swallowed so a missing issue does not block the task).
        - **DB write (``IssueActivity``)**: every row accumulated by the
          handler is persisted via ``IssueActivity.objects.bulk_create``.
        - **Redis write**: when ``origin`` is truthy and an ``issue_id``
          is supplied, the call
          ``redis_instance().set(str(issue_id), origin, ex=600)`` stashes
          the originating surface for 10 minutes (Redis is used here
          purely as a short-lived cache — it is NOT the Celery broker).
        - **Task chain (``notifications.delay(...)``)**: when
          ``notification`` is truthy, dispatches the downstream
          notification task with the serialized
          ``IssueActivitySerializer`` payload. That task creates in-app
          ``Notification`` rows and queues ``EmailNotificationLog``
          rows; it does NOT send email directly (email shipping is the
          job of ``email_notification_task``).
        - **No** direct emails. **No** webhook delivery. **No** cache
          invalidation beyond the 10-minute origin hint above.
        - **Error handling**: top-level ``try/except`` routes any
          exception through ``log_exception`` and returns silently so
          that a failure in the audit-trail path never bubbles up to
          surface a user-visible failure for the originating request.

    Idempotency:
        NON-idempotent. Each invocation creates new ``IssueActivity``
        rows and (when ``notification=True``) enqueues a new chained
        notification task. The caller is expected to invoke at most
        once per logical state transition.

    Args:
        type: Event discriminator string; must be one of the keys in
            ``ACTIVITY_MAPPER`` (see module docstring for the full list).
        requested_data: New-state payload, typically a JSON-encoded
            string — what is about to be / was just persisted. Handlers
            ``json.loads``-decode when needed.
        current_instance: Previous-state payload, typically a
            JSON-encoded string — what was there before. Used for
            diffing.
        issue_id: Primary key of the ``Issue`` being acted on; may be
            ``None`` for cross-cutting events.
        actor_id: Primary key of the ``User`` whose action triggered the
            activity.
        project_id: Primary key of the ``Project``. The task aborts
            silently if this value is not a valid UUID.
        epoch: Integer epoch timestamp for cross-task / cross-row
            correlation; stored on every emitted ``IssueActivity`` row.
        subscriber: Forwarded as-is to ``notifications.delay`` to
            indicate whether assignees and watchers should be notified.
        notification: Gates whether ``notifications.delay`` is
            dispatched. Default ``False`` — callers must opt in
            explicitly to trigger downstream notification fan-out.
        origin: Optional originating surface (e.g., ``"app"`` /
            ``"api"`` / ``"live"``); when provided, cached in Redis for
            10 minutes keyed by ``issue_id`` so consumers (e.g., the
            realtime layer) can attribute the change to its source.
        intake: Reserved parameter retained for call-site compatibility
            (some callers pass an intake-inbox reference); not consumed
            within this task body — intake-specific handling is
            delegated to :func:`create_intake_activity` based on the
            ``type`` discriminator and the payload.
    """
    try:
        issue_activities = []

        # check if project_id is valid
        if not is_valid_uuid(str(project_id)):
            return

        project = Project.objects.get(pk=project_id)
        workspace_id = project.workspace_id

        if issue_id is not None:
            if origin:
                ri = redis_instance()
                # set the request origin in redis
                ri.set(str(issue_id), origin, ex=600)
            issue = Issue.objects.filter(pk=issue_id).first()
            if issue:
                try:
                    issue.updated_at = timezone.now()
                    issue.save(update_fields=["updated_at"])
                except Exception:
                    pass

        ACTIVITY_MAPPER = {
            "issue.activity.created": create_issue_activity,
            "issue.activity.updated": update_issue_activity,
            "issue.activity.deleted": delete_issue_activity,
            "comment.activity.created": create_comment_activity,
            "comment.activity.updated": update_comment_activity,
            "comment.activity.deleted": delete_comment_activity,
            "cycle.activity.created": create_cycle_issue_activity,
            "cycle.activity.deleted": delete_cycle_issue_activity,
            "module.activity.created": create_module_issue_activity,
            "module.activity.deleted": delete_module_issue_activity,
            "link.activity.created": create_link_activity,
            "link.activity.updated": update_link_activity,
            "link.activity.deleted": delete_link_activity,
            "attachment.activity.created": create_attachment_activity,
            "attachment.activity.deleted": delete_attachment_activity,
            "issue_relation.activity.created": create_issue_relation_activity,
            "issue_relation.activity.deleted": delete_issue_relation_activity,
            "issue_reaction.activity.created": create_issue_reaction_activity,
            "issue_reaction.activity.deleted": delete_issue_reaction_activity,
            "comment_reaction.activity.created": create_comment_reaction_activity,
            "comment_reaction.activity.deleted": delete_comment_reaction_activity,
            "issue_vote.activity.created": create_issue_vote_activity,
            "issue_vote.activity.deleted": delete_issue_vote_activity,
            "issue_draft.activity.created": create_draft_issue_activity,
            "issue_draft.activity.updated": update_draft_issue_activity,
            "issue_draft.activity.deleted": delete_draft_issue_activity,
            "intake.activity.created": create_intake_activity,
        }

        func = ACTIVITY_MAPPER.get(type)
        if func is not None:
            func(
                requested_data=requested_data,
                current_instance=current_instance,
                issue_id=issue_id,
                project_id=project_id,
                workspace_id=workspace_id,
                actor_id=actor_id,
                issue_activities=issue_activities,
                epoch=epoch,
            )

        # Save all the values to database
        issue_activities_created = IssueActivity.objects.bulk_create(issue_activities)

        if notification:
            notifications.delay(
                type=type,
                issue_id=issue_id,
                actor_id=actor_id,
                project_id=project_id,
                subscriber=subscriber,
                issue_activities_created=json.dumps(
                    IssueActivitySerializer(issue_activities_created, many=True).data,
                    cls=DjangoJSONEncoder,
                ),
                requested_data=requested_data,
                current_instance=current_instance,
            )

        return
    except Exception as e:
        log_exception(e)
        return
