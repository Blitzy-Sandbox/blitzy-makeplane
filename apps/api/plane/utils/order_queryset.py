# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Canonical orderings for issue listing endpoints.

The ``priority`` and ``state__group`` fields are categorical (not
lexicographic), so a naive ORM ``order_by("priority")`` would alphabetize
their values incorrectly. This module exposes the canonical orderings used
across every issue list endpoint so the resulting sequence matches user
expectations.

Canonical orderings:

  - :data:`PRIORITY_ORDER` = ``["urgent", "high", "medium", "low", "none"]``
    (descending severity).
  - :data:`STATE_ORDER` = ``["backlog", "unstarted", "started", "completed",
    "cancelled"]`` (workflow / pipeline flow).

:func:`order_issue_queryset` resolves a user-supplied ``order_by`` parameter
to a ``Case``/``When`` annotation that maps each categorical value to an
integer rank when the field is categorical, and falls through to the ORM
default ``order_by`` otherwise. Used by every issue list ViewSet in
``plane.app.views.issue.*`` in tandem with :mod:`plane.utils.issue_filters`
and :class:`plane.utils.paginator.BasePaginator`.
"""

from django.db.models import Case, CharField, Min, Value, When

# Custom ordering for priority and state
PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"]
STATE_ORDER = ["backlog", "unstarted", "started", "completed", "cancelled"]


def order_issue_queryset(issue_queryset, order_by_param="-created_at"):
    """Apply a stable, type-aware ordering to an issue queryset.

    Categorical fields (``priority``, ``state__group``) are ranked according
    to :data:`PRIORITY_ORDER` and :data:`STATE_ORDER` respectively so the
    resulting order matches user expectations (severity-descending and
    pipeline-flow). Aggregate fields (``labels__name``,
    ``assignees__first_name``, ``issue_module__module__name``) are reduced
    with :class:`~django.db.models.Min` to produce one row per issue. All
    other fields fall through to the default ORM ``order_by`` behavior with
    ``-created_at`` as the tiebreaker.

    Args:
        issue_queryset: A ``QuerySet`` of ``Issue`` objects to be ordered.
        order_by_param: Field name or ``-`` prefixed field name. Supports
            categorical canonicalization for ``priority`` and
            ``state__group`` plus aggregate canonicalization for label,
            assignee, and module name fields. Defaults to ``-created_at``
            (most recently created first).

    Returns:
        A tuple ``(issue_queryset, order_by_param)`` where the queryset has
        any necessary ranking annotations and ordering already applied, and
        ``order_by_param`` is rewritten to the annotation alias when
        canonicalization was performed (e.g. ``priority`` becomes
        ``-priority_order``) so callers can compose further sorts.
    """
    # Priority Ordering
    if order_by_param == "priority" or order_by_param == "-priority":
        issue_queryset = issue_queryset.annotate(
            priority_order=Case(
                *[When(priority=p, then=Value(i)) for i, p in enumerate(PRIORITY_ORDER)],
                output_field=CharField(),
            )
        ).order_by("priority_order", "-created_at")
        order_by_param = "priority_order" if order_by_param.startswith("-") else "-priority_order"
    # State Ordering
    elif order_by_param in ["state__group", "-state__group"]:
        state_order = STATE_ORDER if order_by_param in ["state__name", "state__group"] else STATE_ORDER[::-1]
        issue_queryset = issue_queryset.annotate(
            state_order=Case(
                *[When(state__group=state_group, then=Value(i)) for i, state_group in enumerate(state_order)],
                default=Value(len(state_order)),
                output_field=CharField(),
            )
        ).order_by("state_order", "-created_at")
        order_by_param = "-state_order" if order_by_param.startswith("-") else "state_order"
    # assignee and label ordering
    elif order_by_param in [
        "labels__name",
        "assignees__first_name",
        "issue_module__module__name",
        "-labels__name",
        "-assignees__first_name",
        "-issue_module__module__name",
    ]:
        issue_queryset = issue_queryset.annotate(
            min_values=Min(order_by_param[1::] if order_by_param.startswith("-") else order_by_param)
        ).order_by(
            "-min_values" if order_by_param.startswith("-") else "min_values",
            "-created_at",
        )
        order_by_param = "-min_values" if order_by_param.startswith("-") else "min_values"
    else:
        # If the order_by_param is created_at, then don't add the -created_at
        if "created_at" in order_by_param:
            issue_queryset = issue_queryset.order_by(order_by_param)
        else:
            issue_queryset = issue_queryset.order_by(order_by_param, "-created_at")
        order_by_param = order_by_param
    return issue_queryset, order_by_param
