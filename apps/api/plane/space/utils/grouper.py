# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Issue grouping helpers for the Space (public-board) API.

This module is the data-shape adapter between the ORM and the grouped-issue
API response used by ``plane.space.views.issue.ProjectIssuesPublicEndpoint``.
The grouping behaviour is split into three cooperating helpers:

* :func:`issue_queryset_grouper` — first-stage queryset preparer that applies
  soft-delete-aware filters across assignee, label, and module relations and
  annotates the queryset with ``ArrayAgg(Coalesce(...))`` group-key arrays.
* :func:`issue_on_results` — second-stage projection that selects the
  ``values()`` columns required by the active grouping dimensions and attaches
  per-issue ``vote_items`` / ``reaction_items`` JSON aggregates.
* :func:`issue_group_values` — enumeration lookup that returns the valid
  bucket values for a given grouping field, scoped to a workspace (and
  optionally a project).

Soft-delete-aware filters (``*__deleted_at__isnull=True``) are applied across
relation joins so that deleted assignee/label/module rows never pollute the
grouped output. The ``ArrayAgg(Coalesce(...))`` pattern is used because empty
buckets must produce a typed empty UUID array (not SQL ``NULL``) — the API
consumer iterates these arrays directly and a ``null`` would break stable
grouped rendering and consistent serialization.

Because the module imports concrete ``plane.db.models`` classes at import
time, it transitively depends on the Django app registry being ready; in the
production boot sequence this is guaranteed by the ``migrator`` container
completing schema migrations before any API service that imports this module
starts.
"""

# Django imports
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models import Q, UUIDField, Value, F, Case, When, JSONField, CharField
from django.db.models.functions import Coalesce, JSONObject, Concat
from django.db.models import QuerySet

from typing import List, Optional, Dict, Any, Union

# Module imports
from plane.db.models import (
    Cycle,
    Issue,
    Label,
    Module,
    Project,
    ProjectMember,
    State,
    WorkspaceMember,
)


def issue_queryset_grouper(
    queryset: QuerySet[Issue], group_by: Optional[str], sub_group_by: Optional[str]
) -> QuerySet[Issue]:
    """Annotate ``queryset`` with ``ArrayAgg(Coalesce(...))`` group keys for the requested grouping dimensions.

    Accepted ``group_by`` / ``sub_group_by`` values include the relation paths
    ``"assignees__id"``, ``"labels__id"``, and ``"issue_module__module_id"`` —
    these select the active grouping dimensions and trigger soft-delete-aware
    filters on the corresponding join tables (``issue_assignee``,
    ``label_issue``, ``issue_module``) so deleted relation rows are excluded
    from the grouped buckets.

    The returned queryset is annotated with ``assignee_ids``, ``label_ids``,
    and ``module_ids`` UUID arrays. The annotation for the dimension actively
    used as ``group_by`` / ``sub_group_by`` is suppressed (the raw relation
    column is already projected by :func:`issue_on_results` in that case).
    Empty relation buckets coalesce to a typed empty ``ArrayField(UUIDField())``
    rather than ``NULL`` so that consumers can iterate the arrays without
    null-guarding.

    :param queryset: Base ``Issue`` queryset to annotate.
    :param group_by: Primary grouping dimension (relation path) or ``None``.
    :param sub_group_by: Secondary grouping dimension or ``None``.
    :returns: The same queryset with ``ArrayAgg(Coalesce(...))`` annotations
        applied for the relation dimensions not used as the active grouping
        key.
    """
    FIELD_MAPPER = {
        "label_ids": "labels__id",
        "assignee_ids": "assignees__id",
        "module_ids": "issue_module__module_id",
    }

    GROUP_FILTER_MAPPER = {
        "assignees__id": Q(issue_assignee__deleted_at__isnull=True),
        "labels__id": Q(label_issue__deleted_at__isnull=True),
        "issue_module__module_id": Q(issue_module__deleted_at__isnull=True),
    }

    for group_key in [group_by, sub_group_by]:
        if group_key in GROUP_FILTER_MAPPER:
            queryset = queryset.filter(GROUP_FILTER_MAPPER[group_key])

    annotations_map = {
        "assignee_ids": (
            "assignees__id",
            ~Q(assignees__id__isnull=True) & Q(issue_assignee__deleted_at__isnull=True),
        ),
        "label_ids": (
            "labels__id",
            ~Q(labels__id__isnull=True) & Q(label_issue__deleted_at__isnull=True),
        ),
        "module_ids": (
            "issue_module__module_id",
            ~Q(issue_module__module_id__isnull=True),
        ),
    }
    default_annotations = {
        key: Coalesce(
            ArrayAgg(field, distinct=True, filter=condition),
            Value([], output_field=ArrayField(UUIDField())),
        )
        for key, (field, condition) in annotations_map.items()
        if FIELD_MAPPER.get(key) != group_by or FIELD_MAPPER.get(key) != sub_group_by
    }

    return queryset.annotate(**default_annotations)


def issue_on_results(
    issues: QuerySet[Issue], group_by: Optional[str], sub_group_by: Optional[str]
) -> List[Dict[str, Any]]:
    """Project grouped ``issues`` onto API-ready ``values()`` columns with ``vote_items`` / ``reaction_items``.

    The selected column set is adjusted by the active grouping dimensions: the
    bucket column corresponding to ``group_by`` / ``sub_group_by`` is appended
    to the projection (replacing its ``*_ids`` array form) so the response
    rows carry the identifier required to fan out into grouped buckets on the
    consumer side.

    Each row is additionally annotated with two arrays of JSON objects:

    * ``vote_items`` — one ``JSONObject`` per non-deleted vote, containing the
      ``vote`` value and an ``actor_details`` block (``id``, ``first_name``,
      ``last_name``, ``avatar``, resolved ``avatar_url``, ``display_name``).
    * ``reaction_items`` — one ``JSONObject`` per non-deleted reaction, with
      the ``reaction`` value and the same ``actor_details`` shape.

    Null and soft-deleted related rows are filtered out via the ``filter=Q(...
    __deleted_at__isnull=True)`` clauses on each ``ArrayAgg``, so empty
    aggregates collapse to an empty array.

    :param issues: Issue queryset, typically already annotated by
        :func:`issue_queryset_grouper`.
    :param group_by: Primary grouping dimension or ``None``.
    :param sub_group_by: Secondary grouping dimension or ``None``.
    :returns: A lazy ``values()`` queryset — NOT eager model instances — that
        the caller materialises into the grouped response.
    """
    FIELD_MAPPER = {
        "labels__id": "label_ids",
        "assignees__id": "assignee_ids",
        "issue_module__module_id": "module_ids",
    }

    original_list = ["assignee_ids", "label_ids", "module_ids"]

    required_fields = [
        "id",
        "name",
        "state_id",
        "sort_order",
        "estimate_point",
        "priority",
        "start_date",
        "target_date",
        "sequence_id",
        "project_id",
        "parent_id",
        "cycle_id",
        "created_by",
        "state__group",
    ]

    if group_by in FIELD_MAPPER:
        original_list.remove(FIELD_MAPPER[group_by])
        original_list.append(group_by)

    if sub_group_by in FIELD_MAPPER:
        original_list.remove(FIELD_MAPPER[sub_group_by])
        original_list.append(sub_group_by)

    required_fields.extend(original_list)

    issues = issues.annotate(
        vote_items=ArrayAgg(
            Case(
                When(
                    votes__isnull=False,
                    votes__deleted_at__isnull=True,
                    then=JSONObject(
                        vote=F("votes__vote"),
                        actor_details=JSONObject(
                            id=F("votes__actor__id"),
                            first_name=F("votes__actor__first_name"),
                            last_name=F("votes__actor__last_name"),
                            avatar=F("votes__actor__avatar"),
                            avatar_url=Case(
                                When(
                                    votes__actor__avatar_asset__isnull=False,
                                    then=Concat(
                                        Value("/api/assets/v2/static/"),
                                        F("votes__actor__avatar_asset"),
                                        Value("/"),
                                    ),
                                ),
                                default=F("votes__actor__avatar"),
                                output_field=CharField(),
                            ),
                            display_name=F("votes__actor__display_name"),
                        ),
                    ),
                ),
                default=None,
                output_field=JSONField(),
            ),
            filter=Q(votes__isnull=False, votes__deleted_at__isnull=True),
            distinct=True,
        ),
        reaction_items=ArrayAgg(
            Case(
                When(
                    issue_reactions__isnull=False,
                    issue_reactions__deleted_at__isnull=True,
                    then=JSONObject(
                        reaction=F("issue_reactions__reaction"),
                        actor_details=JSONObject(
                            id=F("issue_reactions__actor__id"),
                            first_name=F("issue_reactions__actor__first_name"),
                            last_name=F("issue_reactions__actor__last_name"),
                            avatar=F("issue_reactions__actor__avatar"),
                            avatar_url=Case(
                                When(
                                    issue_reactions__actor__avatar_asset__isnull=False,
                                    then=Concat(
                                        Value("/api/assets/v2/static/"),
                                        F("issue_reactions__actor__avatar_asset"),
                                        Value("/"),
                                    ),
                                ),
                                default=F("issue_reactions__actor__avatar"),
                                output_field=CharField(),
                            ),
                            display_name=F("issue_reactions__actor__display_name"),
                        ),
                    ),
                ),
                default=None,
                output_field=JSONField(),
            ),
            filter=Q(issue_reactions__isnull=False, issue_reactions__deleted_at__isnull=True),
            distinct=True,
        ),
    ).values(*required_fields, "vote_items", "reaction_items")

    return issues


def issue_group_values(
    field: str,
    slug: str,
    project_id: Optional[str] = None,
    filters: Dict[str, Any] = {},
    queryset: Optional[QuerySet] = None,
) -> List[Union[str, Any]]:
    """Enumerate the valid bucket values for grouping ``field`` within workspace ``slug`` (optional ``project_id``).

    The grouped issue API needs the complete list of buckets — including
    buckets that currently contain zero issues — so empty groups still render
    in the UI. This helper resolves that list per supported grouping field:

    * ``"state_id"`` — distinct non-triage ``State`` IDs in the workspace,
      narrowed to ``project_id`` when supplied.
    * ``"labels__id"`` — ``Label`` IDs in the workspace (narrowed to project
      when supplied) plus the sentinel string ``"None"`` to represent the
      unlabeled bucket.
    * ``"issue_module__module_id"`` — ``Module`` IDs (optionally narrowed to
      project) plus the ``"None"`` sentinel for issues with no module.
    * ``"cycle_id"`` — ``Cycle`` IDs (optionally narrowed to project) plus
      the ``"None"`` sentinel for issues outside any cycle.
    * ``"project_id"`` — distinct project IDs in the workspace.
    * ``"assignees__id"`` — active ``ProjectMember`` IDs when ``project_id``
      is given, otherwise active ``WorkspaceMember`` IDs.
    * ``"priority"`` — fixed enumeration
      ``["low", "medium", "high", "urgent", "none"]``.
    * ``"state__group"`` — fixed enumeration
      ``["backlog", "unstarted", "started", "completed", "cancelled"]``.
    * ``"target_date"`` / ``"start_date"`` / ``"created_by"`` — distinct
      values pulled from the caller-supplied ``queryset`` (optionally narrowed
      to project).

    The literal ``"None"`` sentinel for label / module / cycle is the
    contract used by the frontend to render the "uncategorized" or
    "unassigned" bucket and must be preserved by any future refactor.

    :param field: Grouping field name (relation path or scalar column).
    :param slug: Workspace slug used to scope model lookups.
    :param project_id: Optional project scope; when ``None`` the lookup falls
        back to workspace scope.
    :param filters: Reserved for caller-side filter passthrough — currently
        unused inside this helper.
    :param queryset: Issue queryset used to derive distinct values for
        ``target_date`` / ``start_date`` / ``created_by``.
    :returns: List of bucket values. Returns ``[]`` for fields not handled
        above (the implicit "unsupported field" branch).
    """
    if field == "state_id":
        queryset = State.objects.filter(is_triage=False, workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)
    if field == "labels__id":
        queryset = Label.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        else:
            return list(queryset) + ["None"]
    if field == "assignees__id":
        if project_id:
            return ProjectMember.objects.filter(
                workspace__slug=slug, project_id=project_id, is_active=True
            ).values_list("member_id", flat=True)
        else:
            return list(
                WorkspaceMember.objects.filter(workspace__slug=slug, is_active=True).values_list("member_id", flat=True)
            )
    if field == "issue_module__module_id":
        queryset = Module.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        else:
            return list(queryset) + ["None"]
    if field == "cycle_id":
        queryset = Cycle.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        else:
            return list(queryset) + ["None"]
    if field == "project_id":
        queryset = Project.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        return list(queryset)
    if field == "priority":
        return ["low", "medium", "high", "urgent", "none"]
    if field == "state__group":
        return ["backlog", "unstarted", "started", "completed", "cancelled"]
    if field == "target_date":
        queryset = queryset.values_list("target_date", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)
    if field == "start_date":
        queryset = queryset.values_list("start_date", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)

    if field == "created_by":
        queryset = queryset.values_list("created_by", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)

    return []
