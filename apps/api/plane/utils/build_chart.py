# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""V2 analytics chart payload builders.

Complements :mod:`plane.utils.analytics_plot` for the second-generation
analytics endpoints (``plane.app.views.analytic.advance`` and
``plane.app.views.analytic.project_analytics``). Provides four layers of
chart resolution helpers used to translate a request-time axis name into
an ORM grouping and aggregation:

  - :data:`x_axis_mapper` -- canonical names of all supported grouping
    axes (``STATES``, ``STATE_GROUPS``, ``LABELS``, ``ASSIGNEES``,
    ``ESTIMATE_POINTS``, ``CYCLES``, ``MODULES``, ``PRIORITY``,
    ``START_DATE``, ``TARGET_DATE``, ``CREATED_AT``, ``COMPLETED_AT``,
    ``CREATED_BY``). Used by :func:`build_analytics_chart` to validate
    the incoming ``x_axis``/``group_by`` query parameters.
  - :func:`get_x_axis_field` -- resolves each axis name to a 3-tuple
    ``(value_lookup, name_lookup, optional_filter_dict)`` describing
    which ORM field carries the bucket id, which carries the
    human-readable display name, and any ``Q``-style ``.filter(**)`` dict
    that must be applied to exclude soft-deleted join rows (e.g.,
    ``{"label_issue__deleted_at__isnull": True}`` for ``LABELS``).
  - :func:`get_y_axis_filter` -- resolves a y-axis dimension (e.g.,
    ``WORK_ITEM_COUNT``) to the ORM ``.filter(**)`` kwargs consumed by
    :func:`build_number_chart_response` when computing single-cell number
    cards.
  - :func:`build_analytics_chart` -- top-level dispatcher that validates
    axes, applies any axis-specific filters, picks the grouped vs.
    simple build path, and returns the ``{"data": rows, "schema": map}``
    payload shape that the analytics frontend consumes.

Consumers: ``plane.app.views.analytic.advance`` and
``plane.app.views.analytic.project_analytics`` (v2 analytics endpoints).
"""

from typing import Dict, Any, Tuple, Optional, List, Union


# Django imports
from django.db.models import (
    Count,
    F,
    QuerySet,
    Aggregate,
)

from plane.db.models import Issue
from rest_framework.exceptions import ValidationError


x_axis_mapper = {
    "STATES": "STATES",
    "STATE_GROUPS": "STATE_GROUPS",
    "LABELS": "LABELS",
    "ASSIGNEES": "ASSIGNEES",
    "ESTIMATE_POINTS": "ESTIMATE_POINTS",
    "CYCLES": "CYCLES",
    "MODULES": "MODULES",
    "PRIORITY": "PRIORITY",
    "START_DATE": "START_DATE",
    "TARGET_DATE": "TARGET_DATE",
    "CREATED_AT": "CREATED_AT",
    "COMPLETED_AT": "COMPLETED_AT",
    "CREATED_BY": "CREATED_BY",
}


def get_y_axis_filter(y_axis: str) -> Dict[str, Any]:
    """Return the ORM ``.filter(**)`` kwargs corresponding to a y-axis dimension.

    Currently recognizes only ``WORK_ITEM_COUNT`` (mapped to
    ``{"id": F("id")}``, a tautological filter that simply restricts the
    queryset to rows with a non-null primary key). Unknown dimensions
    yield an empty dict so the caller's queryset is left unfiltered.
    """
    filter_mapping = {
        "WORK_ITEM_COUNT": {"id": F("id")},
    }
    return filter_mapping.get(y_axis, {})


def get_x_axis_field() -> Dict[str, Tuple[str, str, Optional[Dict[str, Any]]]]:
    """Return the x-axis dimension table mapping each axis name to its ORM resolution tuple.

    Each value is ``(value_lookup, name_lookup, optional_filter)``: the
    ORM field carrying the bucket id, the field carrying the display
    name (often the same as the value lookup for primitive axes like
    ``PRIORITY``), and an optional ``.filter(**)`` dict applied to
    exclude soft-deleted rows when the axis traverses a deletable join
    table (``LABELS``, ``ASSIGNEES``, ``CYCLES``, ``MODULES``).
    """
    return {
        "STATES": ("state__id", "state__name", None),
        "STATE_GROUPS": ("state__group", "state__group", None),
        "LABELS": (
            "labels__id",
            "labels__name",
            {"label_issue__deleted_at__isnull": True},
        ),
        "ASSIGNEES": (
            "assignees__id",
            "assignees__display_name",
            {"issue_assignee__deleted_at__isnull": True},
        ),
        "ESTIMATE_POINTS": ("estimate_point__key", "estimate_point__value", None),
        "CYCLES": (
            "issue_cycle__cycle_id",
            "issue_cycle__cycle__name",
            {"issue_cycle__deleted_at__isnull": True},
        ),
        "MODULES": (
            "issue_module__module_id",
            "issue_module__module__name",
            {"issue_module__deleted_at__isnull": True},
        ),
        "PRIORITY": ("priority", "priority", None),
        "START_DATE": ("start_date", "start_date", None),
        "TARGET_DATE": ("target_date", "target_date", None),
        "CREATED_AT": ("created_at__date", "created_at__date", None),
        "COMPLETED_AT": ("completed_at__date", "completed_at__date", None),
        "CREATED_BY": ("created_by_id", "created_by__display_name", None),
    }


def process_grouped_data(
    data: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Pivot flat ``(key, group_key, count)`` rows into chart rows plus a group-key schema.

    Returns ``(rows, schema)`` where ``rows`` is a list of per-bucket
    dicts (each containing ``key``, ``name``, total ``count``, and one
    integer column per encountered ``group_key``) and ``schema`` maps
    each ``group_key`` to its human-readable display name. ``None`` ids
    are coerced to the literal strings ``"none"``/``"None"`` so chart
    rendering produces stable bucket labels.
    """
    response = {}
    schema = {}

    for item in data:
        key = item["key"]
        if key not in response:
            response[key] = {
                "key": key if key else "none",
                "name": (item.get("display_name", key) if item.get("display_name", key) else "None"),
                "count": 0,
            }
        group_key = str(item["group_key"]) if item["group_key"] else "none"
        schema[group_key] = item.get("group_name", item["group_key"])
        schema[group_key] = schema[group_key] if schema[group_key] else "None"
        response[key][group_key] = response[key].get(group_key, 0) + item["count"]
        response[key]["count"] += item["count"]

    return list(response.values()), schema


def build_number_chart_response(
    queryset: QuerySet[Issue],
    y_axis_filter: Dict[str, Any],
    y_axis: str,
    aggregate_func: Aggregate,
) -> List[Dict[str, Any]]:
    """Build a single-cell ``number`` chart payload from an aggregate over ``queryset``.

    Applies ``y_axis_filter`` (typically the dict returned by
    :func:`get_y_axis_filter`), evaluates ``aggregate_func`` as ``total``,
    and returns a one-element row list shaped like
    ``[{"key": y_axis, "name": y_axis, "count": <int>}]`` so the
    frontend can render a single KPI card with the same row schema as
    the multi-bucket chart endpoints.
    """
    count = queryset.filter(**y_axis_filter).aggregate(total=aggregate_func).get("total", 0)
    return [{"key": y_axis, "name": y_axis, "count": count}]


def build_grouped_chart_response(
    queryset: QuerySet[Issue],
    id_field: str,
    name_field: str,
    group_field: str,
    group_name_field: str,
    aggregate_func: Aggregate,
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Build a 2-D grouped chart payload from ``queryset``, returning rows plus group-key schema.

    Annotates the queryset with ``(key, group_key, group_name,
    display_name)`` from the supplied ORM lookups, aggregates
    ``aggregate_func`` per ``(key, group_key)`` bucket ordered by
    descending count, then pivots the flat result through
    :func:`process_grouped_data` to produce the final
    ``(rows, schema)`` tuple consumed by :func:`build_analytics_chart`.
    """
    data = (
        queryset.annotate(
            key=F(id_field),
            group_key=F(group_field),
            group_name=F(group_name_field),
            display_name=F(name_field) if name_field else F(id_field),
        )
        .values("key", "group_key", "group_name", "display_name")
        .annotate(count=aggregate_func)
        .order_by("-count")
    )
    return process_grouped_data(data)


def build_simple_chart_response(
    queryset: QuerySet, id_field: str, name_field: str, aggregate_func: Aggregate
) -> List[Dict[str, Any]]:
    """Build a 1-D chart payload from ``queryset`` for a single ``x_axis`` (no secondary grouping).

    Annotates the queryset with ``(key, display_name)`` from the
    supplied ORM lookups, aggregates ``aggregate_func`` per key ordered
    by ``key``, and returns one row per bucket shaped like
    ``{"key": <id>, "name": <display>, "count": <int>}``. ``None`` ids
    and names are coerced to the literal string ``"None"`` so the
    rendered chart has stable bucket labels.
    """
    data = (
        queryset.annotate(key=F(id_field), display_name=F(name_field) if name_field else F(id_field))
        .values("key", "display_name")
        .annotate(count=aggregate_func)
        .order_by("key")
    )

    return [
        {
            "key": item["key"] if item["key"] else "None",
            "name": item["display_name"] if item["display_name"] else "None",
            "count": item["count"],
        }
        for item in data
    ]


def build_analytics_chart(
    queryset: QuerySet[Issue],
    x_axis: str,
    group_by: Optional[str] = None,
    date_filter: Optional[str] = None,
) -> Dict[str, Union[List[Dict[str, Any]], Dict[str, str]]]:
    """Build the v2 analytics chart payload for ``x_axis`` (with optional ``group_by``).

    Validates ``x_axis`` and ``group_by`` against :data:`x_axis_mapper`
    (raising :class:`rest_framework.exceptions.ValidationError` on
    unknown axes), resolves each axis through :func:`get_x_axis_field`,
    applies any axis-specific soft-delete filters, then dispatches to
    :func:`build_grouped_chart_response` when ``group_by`` is supplied
    or :func:`build_simple_chart_response` otherwise. Aggregation is a
    distinct ``COUNT(id)`` in both branches. The ``date_filter``
    parameter is accepted for API compatibility but is currently
    unused; callers apply date narrowing on ``queryset`` before
    invocation. Returns ``{"data": <rows>, "schema": <group-key map>}``
    -- the schema dict is empty for the un-grouped path.
    """
    # Validate x_axis
    if x_axis not in x_axis_mapper:
        raise ValidationError(f"Invalid x_axis field: {x_axis}")

    # Validate group_by
    if group_by and group_by not in x_axis_mapper:
        raise ValidationError(f"Invalid group_by field: {group_by}")

    field_mapping = get_x_axis_field()

    id_field, name_field, additional_filter = field_mapping.get(x_axis, (None, None, {}))
    group_field, group_name_field, group_additional_filter = field_mapping.get(group_by, (None, None, {}))

    # Apply additional filters if they exist
    if additional_filter or {}:
        queryset = queryset.filter(**additional_filter)

    if group_additional_filter or {}:
        queryset = queryset.filter(**group_additional_filter)

    aggregate_func = Count("id", distinct=True)

    if group_field:
        response, schema = build_grouped_chart_response(
            queryset,
            id_field,
            name_field,
            group_field,
            group_name_field,
            aggregate_func,
        )
    else:
        response = build_simple_chart_response(queryset, id_field, name_field, aggregate_func)
        schema = {}

    return {"data": response, "schema": schema}
