# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Analytics period -> date range resolution helpers.

Resolves the ``date_filter`` query parameter token from analytics endpoints to
either a current/previous date range comparison dict, a concrete
``(start_date, end_date)`` tuple, or a composed ORM filter payload, depending
on the helper invoked.

Supported period tokens:
  - ``yesterday``       -- single calendar day prior to ``timezone.now()``.
  - ``last_7_days``     -- rolling 7-day window ending today.
  - ``last_30_days``    -- rolling 30-day window ending today.
  - ``last_3_months``   -- rolling 90-day window ending today.
  - ``custom``          -- caller supplies explicit ``start_date`` and
    ``end_date`` query parameters (honored by
    :func:`get_analytics_date_range` only).

Consumers: ``plane.app.views.analytic.*`` advance endpoints and the
``plane.app.views.workspace.home`` chart endpoints.
"""

from datetime import datetime, timedelta, date
from django.utils import timezone
from typing import Dict, Optional, List, Union, Tuple, Any

from plane.db.models import User


def get_analytics_date_range(
    date_filter: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Optional[Dict[str, Dict[str, datetime]]]:
    """Resolve a ``date_filter`` token to a current/previous date-range comparison dict.

    For ``date_filter == "custom"`` the caller MUST supply ``start_date`` and
    ``end_date`` as ``YYYY-MM-DD`` strings; otherwise the window is computed
    relative to ``timezone.now()``. Rolling windows
    (``last_7_days``/``last_30_days``/``last_3_months``) also emit an
    equally-sized ``previous`` bucket for period-over-period comparison.
    Returns ``None`` when ``date_filter`` is falsy/unknown, or when a
    ``custom`` range fails to parse.
    """
    if not date_filter:
        return None

    today = timezone.now().date()

    if date_filter == "yesterday":
        yesterday = today - timedelta(days=1)
        return {
            "current": {
                "gte": datetime.combine(yesterday, datetime.min.time()),
                "lte": datetime.combine(yesterday, datetime.max.time()),
            }
        }
    elif date_filter == "last_7_days":
        return {
            "current": {
                "gte": datetime.combine(today - timedelta(days=7), datetime.min.time()),
                "lte": datetime.combine(today, datetime.max.time()),
            },
            "previous": {
                "gte": datetime.combine(today - timedelta(days=14), datetime.min.time()),
                "lte": datetime.combine(today - timedelta(days=8), datetime.max.time()),
            },
        }
    elif date_filter == "last_30_days":
        return {
            "current": {
                "gte": datetime.combine(today - timedelta(days=30), datetime.min.time()),
                "lte": datetime.combine(today, datetime.max.time()),
            },
            "previous": {
                "gte": datetime.combine(today - timedelta(days=60), datetime.min.time()),
                "lte": datetime.combine(today - timedelta(days=31), datetime.max.time()),
            },
        }
    elif date_filter == "last_3_months":
        return {
            "current": {
                "gte": datetime.combine(today - timedelta(days=90), datetime.min.time()),
                "lte": datetime.combine(today, datetime.max.time()),
            },
            "previous": {
                "gte": datetime.combine(today - timedelta(days=180), datetime.min.time()),
                "lte": datetime.combine(today - timedelta(days=91), datetime.max.time()),
            },
        }
    elif date_filter == "custom" and start_date and end_date:
        try:
            start = datetime.strptime(start_date, "%Y-%m-%d").date()
            end = datetime.strptime(end_date, "%Y-%m-%d").date()
            return {
                "current": {
                    "gte": datetime.combine(start, datetime.min.time()),
                    "lte": datetime.combine(end, datetime.max.time()),
                }
            }
        except (ValueError, TypeError):
            return None
    return None


def get_chart_period_range(
    date_filter: Optional[str] = None,
) -> Optional[Tuple[date, date]]:
    """Resolve a ``date_filter`` token to a ``(start_date, end_date)`` tuple for chart x-axis bucketing.

    Accepts ``yesterday``, ``last_7_days``, ``last_30_days``, and
    ``last_3_months``; returns ``None`` for falsy or unrecognized tokens
    (the ``custom`` token is intentionally not honored by this helper).
    """
    if not date_filter:
        return None

    today = timezone.now().date()
    period_ranges = {
        "yesterday": (
            today - timedelta(days=1),
            today - timedelta(days=1),
        ),
        "last_7_days": (today - timedelta(days=7), today),
        "last_30_days": (today - timedelta(days=30), today),
        "last_3_months": (today - timedelta(days=90), today),
    }

    return period_ranges.get(date_filter, None)


def get_analytics_filters(
    slug: str,
    user: User,
    type: str,
    date_filter: Optional[str] = None,
    project_ids: Optional[Union[str, List[str]]] = None,
) -> Dict[str, Any]:
    """Return the combined workspace/project/date filter payload for analytics endpoints.

    Composes the workspace-scoped ``base_filters`` (issue-level) and
    ``project_filters`` (project-level), optionally narrows them by
    ``project_ids`` (list or comma-separated string), and attaches either
    ``analytics_date_range`` (when ``type == "analytics"``) or
    ``chart_period_range`` (when ``type == "chart"``) derived from
    ``date_filter`` via :func:`get_analytics_date_range` and
    :func:`get_chart_period_range` respectively.
    """
    # Get project IDs from request
    if project_ids and isinstance(project_ids, str):
        project_ids = [str(project_id) for project_id in project_ids.split(",")]

    # Base filters for workspace and user
    base_filters = {
        "workspace__slug": slug,
        "project__project_projectmember__member": user,
        "project__project_projectmember__is_active": True,
        "project__deleted_at__isnull": True,
        "project__archived_at__isnull": True,
    }

    # Project filters
    project_filters = {
        "workspace__slug": slug,
        "project_projectmember__member": user,
        "project_projectmember__is_active": True,
        "deleted_at__isnull": True,
        "archived_at__isnull": True,
    }

    # Add project IDs to filters if provided
    if project_ids:
        base_filters["project_id__in"] = project_ids
        project_filters["id__in"] = project_ids

    # Initialize date range variables
    analytics_date_range = None
    chart_period_range = None

    # Get date range filters based on type
    if type == "analytics":
        analytics_date_range = get_analytics_date_range(date_filter)
    elif type == "chart":
        chart_period_range = get_chart_period_range(date_filter)

    return {
        "base_filters": base_filters,
        "project_filters": project_filters,
        "analytics_date_range": analytics_date_range,
        "chart_period_range": chart_period_range,
    }
