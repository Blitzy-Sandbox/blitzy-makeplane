# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Issue queryset grouping and annotation helpers.

Prepares ``Issue`` querysets for the grouped/sub-grouped paginator stack
(``plane.utils.paginator.GroupedOffsetPaginator`` and
``plane.utils.paginator.SubGroupedOffsetPaginator``) by annotating m2m
result-field names (``label_ids``, ``assignee_ids``, ``module_ids``) back to
their ORM lookup paths (``labels__id``, ``assignees__id``,
``issue_module__module_id``) via ``Subquery + ArrayAgg`` so each result row
carries a consolidated list of related IDs instead of duplicating the issue
per related row. Every relationship-based group filter excludes rows whose
``deleted_at`` is set so soft-deleted assignees, labels, or modules do not
materialize as ghost groups. The companion helper :func:`issue_group_values`
returns the universe of valid bucket IDs (e.g., all state IDs, all priority
values) so the paginator can initialize a result dict with one entry per
bucket even when a bucket has zero matching issues.

Consumed by every issue layout endpoint (Kanban, List, Spreadsheet, Calendar,
Gantt) under ``plane.app.views.issue.*``, ``plane.app.views.workspace.*``,
``plane.app.views.cycle.*``, and ``plane.app.views.module.*``.
"""

# Django imports
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models import Q, UUIDField, Value, QuerySet, OuterRef, Subquery
from django.db.models.functions import Coalesce

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
    IssueAssignee,
    ModuleIssue,
    IssueLabel,
)
from typing import Optional, Dict, Tuple, Any, Union, List


def issue_queryset_grouper(
    queryset: QuerySet[Issue],
    group_by: Optional[str],
    sub_group_by: Optional[str],
) -> QuerySet[Issue]:
    """Annotate an Issue queryset with consolidated m2m ID arrays for grouped pagination.

    Adds ``assignee_ids``/``label_ids``/``module_ids`` ``ArrayAgg`` subquery
    annotations (skipping the column the caller is grouping or sub-grouping
    by so the grouping join is not double-counted by the outer annotation)
    and applies the matching soft-delete filter from ``GROUP_FILTER_MAPPER``
    whenever ``group_by`` or ``sub_group_by`` targets a relationship lookup,
    preventing deleted assignees, labels, or modules from materializing as
    ghost groups in the paginator output.
    """
    FIELD_MAPPER: Dict[str, str] = {
        "label_ids": "labels__id",
        "assignee_ids": "assignees__id",
        "module_ids": "issue_module__module_id",
    }

    GROUP_FILTER_MAPPER: Dict[str, Q] = {
        "assignees__id": Q(issue_assignee__deleted_at__isnull=True),
        "labels__id": Q(label_issue__deleted_at__isnull=True),
        "issue_module__module_id": Q(issue_module__deleted_at__isnull=True),
    }

    for group_key in [group_by, sub_group_by]:
        if group_key in GROUP_FILTER_MAPPER:
            queryset = queryset.filter(GROUP_FILTER_MAPPER[group_key])

    issue_assignee_subquery = Subquery(
        IssueAssignee.objects.filter(
            issue_id=OuterRef("pk"),
            deleted_at__isnull=True,
        )
        .values("issue_id")
        .annotate(arr=ArrayAgg("assignee_id", distinct=True))
        .values("arr")
    )

    issue_module_subquery = Subquery(
        ModuleIssue.objects.filter(
            issue_id=OuterRef("pk"),
            deleted_at__isnull=True,
            module__archived_at__isnull=True,
        )
        .values("issue_id")
        .annotate(arr=ArrayAgg("module_id", distinct=True))
        .values("arr")
    )

    issue_label_subquery = Subquery(
        IssueLabel.objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
        .values("issue_id")
        .annotate(arr=ArrayAgg("label_id", distinct=True))
        .values("arr")
    )

    annotations_map: Dict[str, Tuple[str, Q]] = {
        "assignee_ids": Coalesce(issue_assignee_subquery, Value([], output_field=ArrayField(UUIDField()))),
        "label_ids": Coalesce(issue_label_subquery, Value([], output_field=ArrayField(UUIDField()))),
        "module_ids": Coalesce(issue_module_subquery, Value([], output_field=ArrayField(UUIDField()))),
    }

    default_annotations: Dict[str, Any] = {}

    for key, expression in annotations_map.items():
        if FIELD_MAPPER.get(key) in {group_by, sub_group_by}:
            continue
        default_annotations[key] = expression

    return queryset.annotate(**default_annotations)


def issue_on_results(
    issues: QuerySet[Issue],
    group_by: Optional[str],
    sub_group_by: Optional[str],
) -> List[Dict[str, Any]]:
    """Materialize the annotated Issue queryset into the paginator's per-row dict shape.

    Projects the fixed set of fields the issue layouts (Kanban, List,
    Spreadsheet, Calendar, Gantt) depend on, swapping the consolidated m2m
    array name (``assignee_ids``/``label_ids``/``module_ids``) for the
    matching ORM lookup path
    (``assignees__id``/``labels__id``/``issue_module__module_id``) whenever
    the caller groups or sub-groups by that relationship, so the paginator
    receives the raw foreign-key value to bucket on rather than the
    pre-aggregated array.
    """
    FIELD_MAPPER: Dict[str, str] = {
        "labels__id": "label_ids",
        "assignees__id": "assignee_ids",
        "issue_module__module_id": "module_ids",
    }

    original_list: List[str] = ["assignee_ids", "label_ids", "module_ids"]

    required_fields: List[str] = [
        "id",
        "name",
        "state_id",
        "sort_order",
        "completed_at",
        "estimate_point",
        "priority",
        "start_date",
        "target_date",
        "sequence_id",
        "project_id",
        "parent_id",
        "cycle_id",
        "sub_issues_count",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "attachment_count",
        "link_count",
        "is_draft",
        "archived_at",
        "state__group",
    ]

    if group_by in FIELD_MAPPER:
        original_list.remove(FIELD_MAPPER[group_by])
        original_list.append(group_by)

    if sub_group_by in FIELD_MAPPER:
        original_list.remove(FIELD_MAPPER[sub_group_by])
        original_list.append(sub_group_by)

    required_fields.extend(original_list)
    return list(issues.values(*required_fields))


def issue_group_values(
    field: str,
    slug: str,
    project_id: Optional[str] = None,
    filters: Dict[str, Any] = {},
    queryset: Optional[QuerySet] = None,
) -> List[Union[str, Any]]:
    """Return the universe of valid bucket IDs for the requested grouping ``field``.

    Drives the grouped paginator's empty-bucket initialization: depending on
    ``field`` this resolves to state IDs, label IDs, project- or
    workspace-member IDs, module IDs, cycle IDs, project IDs, the fixed
    ``priority`` or ``state__group`` enumeration, or distinct
    ``target_date``/``start_date``/``created_by`` values pulled from the
    supplied ``queryset``, so the paginator emits an entry for every possible
    bucket even when no issue currently falls into it. Relationship-style
    fields append ``"None"`` to represent issues with no related row.
    """
    if field == "state_id":
        queryset = State.objects.filter(is_triage=False, workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id))
        return list(queryset)

    if field == "labels__id":
        queryset = Label.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        return list(queryset) + ["None"]

    if field == "assignees__id":
        if project_id:
            return list(
                ProjectMember.objects.filter(workspace__slug=slug, project_id=project_id, is_active=True).values_list(
                    "member_id", flat=True
                )
            )
        return list(
            WorkspaceMember.objects.filter(workspace__slug=slug, is_active=True).values_list("member_id", flat=True)
        )

    if field == "issue_module__module_id":
        queryset = Module.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        return list(queryset) + ["None"]

    if field == "cycle_id":
        queryset = Cycle.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
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
