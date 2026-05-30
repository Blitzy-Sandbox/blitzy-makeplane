# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Base FilterSet classes for Plane's complex JSON filter backend.

This module defines the filterset machinery consumed by
:class:`plane.utils.filters.filter_backend.ComplexFilterBackend`:

  - :class:`UUIDInFilter` / :class:`CharInFilter` -- list-of-values
    variants used for ``?field__in=`` lookups whose elements are UUIDs
    or strings respectively. (Wraps django-filter's
    :class:`~django_filters.filters.BaseInFilter` over the
    corresponding scalar filter type.)
  - :class:`BaseFilterSet` -- :class:`django_filters.FilterSet`
    subclass with Plane defaults: auto-generates ``__exact`` mirrors
    of every ``exact`` filter (so the JSON filter UI can write
    ``priority__exact``) and exposes ``build_combined_q()`` which
    returns a single :class:`~django.db.models.Q` object covering all
    bound conditions. ``filter_queryset()`` is overridden to use the
    same path so both the legacy ``DjangoFilterBackend`` and the new
    :class:`ComplexFilterBackend` consume identical semantics.
  - :class:`IssueFilterSet` -- concrete filterset for
    :class:`plane.db.models.Issue` used by the issue / cycle-issue /
    module-issue / workspace-user issue / view-detail issue endpoints.

Soft-delete-aware joins
-----------------------

Plane uses soft deletes (``deleted_at IS NOT NULL`` marks a tombstone)
for many-to-many relations (``issue_assignee``, ``issue_cycle``,
``issue_module``, ``issue_mention``, ``label_issue``,
``issue_subscribers``). Every relation-based filter method on
:class:`IssueFilterSet` AND's an explicit
``<relation>__deleted_at__isnull=True`` guard onto the ``Q`` object
so issues whose only matching join row is tombstoned do NOT leak into
results. Naive ``Issue.objects.filter(label_issue__label_id=...)``
without the guard would include tombstoned join rows; the methods
here are the correct pattern and SHOULD be used as the template for
any new relation filter.

Combined Q assembly
-------------------

:meth:`BaseFilterSet.build_combined_q` is the integration point with
:class:`ComplexFilterBackend`. Custom filter methods (``method=...``)
may return a ``Q`` object directly OR a ``QuerySet`` (the latter is
wrapped as ``Q(pk__in=subquery.values("pk"))`` for backward
compatibility). Standard field filters fall back to
``Q(**{f"{field_name}__{lookup_expr}": value})``. Filters with
``exclude=True`` are negated.
"""

import copy

from django.db import models
from django.db.models import Q
from django_filters import FilterSet, filters

from plane.db.models import Issue


class UUIDInFilter(filters.BaseInFilter, filters.UUIDFilter):
    """``?field__in=<uuid>,<uuid>`` filter: comma-separated list of UUID values."""

    pass


class CharInFilter(filters.BaseInFilter, filters.CharFilter):
    """``?field__in=<str>,<str>`` filter: comma-separated list of string values."""

    pass


class BaseFilterSet(FilterSet):
    """``django_filters.FilterSet`` with Plane defaults: auto ``__exact`` mirrors and ``build_combined_q()``.

    Override of :class:`django_filters.FilterSet` that:

      - Auto-generates a ``<name>__exact`` mirror for every declared
        filter whose ``lookup_expr == "exact"`` so the JSON filter
        backend can address ``priority__exact`` etc. without each
        FilterSet repeating the declaration.
      - Exposes :meth:`build_combined_q` for the
        :class:`ComplexFilterBackend` to fold every bound filter into
        a single :class:`~django.db.models.Q` (custom methods may
        return either a ``Q`` or a ``QuerySet`` -- the latter is
        wrapped as ``Q(pk__in=qs.values("pk"))``).
      - Overrides :meth:`filter_queryset` to route through the same
        ``build_combined_q`` path so a single filterset can serve both
        ``DjangoFilterBackend`` and ``ComplexFilterBackend``
        consistently.
    """

    @classmethod
    def get_filters(cls):
        """Get all filters for the filterset, including dynamically created __exact filters."""
        # Get the standard filters first
        filters = super().get_filters()

        # Add __exact versions for filters that have 'exact' lookup
        exact_filters = {}
        for filter_name, filter_obj in filters.items():
            if hasattr(filter_obj, "lookup_expr") and filter_obj.lookup_expr == "exact":
                exact_field_name = f"{filter_name}__exact"
                if exact_field_name not in filters:
                    # Copy the filter object as-is and assign it to the new name
                    exact_filters[exact_field_name] = copy.deepcopy(filter_obj)

        # Add the exact filters to the main filters dict
        filters.update(exact_filters)
        return filters

    def build_combined_q(self):
        """
        Build a combined Q object from all bound filters.

        For filters with custom methods, we call them and expect Q objects (or wrap
        QuerySets as subqueries for backward compatibility).
        For standard field filters, we build Q objects directly from field lookups.

        Returns:
            Q object representing all filter conditions combined.
        """
        # Ensure form validation has occurred
        self.errors

        combined_q = Q()

        # Handle case where cleaned_data might be None or empty
        if not self.form.cleaned_data:
            return combined_q

        # Only process filters that were actually provided in the request data
        # This avoids processing all declared filters with None/empty default values
        provided_filters = set(self.data.keys()) if self.data else set()

        for name, value in self.form.cleaned_data.items():
            # Skip filters that weren't provided in the request
            if name not in provided_filters:
                continue

            f = self.filters[name]

            # Build the Q object for this filter
            if f.method is not None:
                # Custom filter method - call it to get Q object
                res = f.filter(self.queryset, value)
                if isinstance(res, Q):
                    q_piece = res
                elif isinstance(res, models.QuerySet):
                    # Backward compatibility: wrap QuerySet as subquery
                    q_piece = Q(pk__in=res.values("pk"))
                else:
                    raise TypeError(
                        f"Filter method '{name}' must return Q object or QuerySet, got {type(res).__name__}"
                    )
            else:
                # Standard field filter - build Q object directly
                lookup = f"{f.field_name}__{f.lookup_expr}"
                q_piece = Q(**{lookup: value})

            # Apply exclude/include logic
            if getattr(f, "exclude", False):
                combined_q &= ~q_piece
            else:
                combined_q &= q_piece

        return combined_q

    def filter_queryset(self, queryset):
        """
        Override to use Q-based filtering for compatibility with DjangoFilterBackend.

        This allows the same filterset to work with both ComplexFilterBackend
        (which calls build_combined_q directly) and DjangoFilterBackend
        (which calls this method).
        """
        # Ensure form validation
        self.errors

        # Build combined Q and apply to queryset
        combined_q = self.build_combined_q()
        qs = queryset.filter(combined_q)

        # Apply distinct if any filter requires it (typically for many-to-many relations)
        for f in self.filters.values():
            if getattr(f, "distinct", False):
                return qs.distinct()

        return qs


class IssueFilterSet(BaseFilterSet):
    """FilterSet for :class:`plane.db.models.Issue` -- soft-delete-aware relation filters.

    Used by the issue / cycle-issue / module-issue / workspace-user
    issue / view-detail issue endpoints (via ``filterset_class``).

    Declared filters fall into three buckets:

      - **Relation filters with soft-delete guards** (assignee, cycle,
        module, mention, label, subscriber): bound to custom methods
        (``filter_<name>``) so each join condition includes
        ``<relation>__deleted_at__isnull=True``.
      - **Direct field lookups**: ``created_by_id``, ``state_group``,
        ``state_id``, ``project_id`` (and their ``__in`` variants) are
        plain ``UUIDFilter`` / ``CharFilter`` against the issue row.
      - **Boolean convenience filter**: ``is_archived`` translates
        truthy/falsy to ``archived_at IS NOT NULL`` / ``archived_at
        IS NULL`` respectively.

    The ``Meta.fields`` dict adds date/range/exact lookups on
    ``start_date``, ``target_date``, ``created_at``, ``updated_at``,
    plus ``is_draft`` and ``priority`` direct lookups.
    """

    # Custom filter methods to handle soft delete exclusion for relations

    assignee_id = filters.UUIDFilter(method="filter_assignee_id")
    assignee_id__in = UUIDInFilter(method="filter_assignee_id_in", lookup_expr="in")

    cycle_id = filters.UUIDFilter(method="filter_cycle_id")
    cycle_id__in = UUIDInFilter(method="filter_cycle_id_in", lookup_expr="in")

    module_id = filters.UUIDFilter(method="filter_module_id")
    module_id__in = UUIDInFilter(method="filter_module_id_in", lookup_expr="in")

    mention_id = filters.UUIDFilter(method="filter_mention_id")
    mention_id__in = UUIDInFilter(method="filter_mention_id_in", lookup_expr="in")

    label_id = filters.UUIDFilter(method="filter_label_id")
    label_id__in = UUIDInFilter(method="filter_label_id_in", lookup_expr="in")

    # Direct field lookups remain the same
    created_by_id = filters.UUIDFilter(field_name="created_by_id")
    created_by_id__in = UUIDInFilter(field_name="created_by_id", lookup_expr="in")

    is_archived = filters.BooleanFilter(method="filter_is_archived")

    state_group = filters.CharFilter(field_name="state__group")
    state_group__in = CharInFilter(field_name="state__group", lookup_expr="in")

    state_id = filters.UUIDFilter(field_name="state_id")
    state_id__in = UUIDInFilter(field_name="state_id", lookup_expr="in")

    project_id = filters.UUIDFilter(field_name="project_id")
    project_id__in = UUIDInFilter(field_name="project_id", lookup_expr="in")

    subscriber_id = filters.UUIDFilter(method="filter_subscriber_id")
    subscriber_id__in = UUIDInFilter(method="filter_subscriber_id_in", lookup_expr="in")

    class Meta:
        """Declarative django-filter config: ``model = Issue`` plus exact/range/in lookups on date and scalar fields."""

        model = Issue
        fields = {
            "start_date": ["exact", "range"],
            "target_date": ["exact", "range"],
            "created_at": ["exact", "range"],
            "updated_at": ["exact", "range"],
            "is_draft": ["exact"],
            "priority": ["exact", "in"],
        }

    def filter_is_archived(self, queryset, name, value):
        """
        Apply a convenience boolean filter on ``archived_at``.

        Truthy values (``True`` / ``"true"`` / ``"True"`` / ``1`` /
        ``"1"``) match rows where ``archived_at`` IS NOT NULL.
        Falsy values (``False`` / ``"false"`` / ``"False"`` / ``0`` /
        ``"0"``) match rows where ``archived_at`` IS NULL.
        Any other value applies no filter (returns ``Q()``).
        """
        if value in (True, "true", "True", 1, "1"):
            return Q(archived_at__isnull=False)
        if value in (False, "false", "False", 0, "0"):
            return Q(archived_at__isnull=True)
        return Q()  # No filter

    # Filter methods with soft delete exclusion for relations

    def filter_assignee_id(self, queryset, name, value):
        """Filter by assignee ID, excluding soft-deleted ``issue_assignee`` join rows."""
        return Q(
            issue_assignee__assignee_id=value,
            issue_assignee__deleted_at__isnull=True,
        )

    def filter_assignee_id_in(self, queryset, name, value):
        """Filter by assignee IDs (``__in``), excluding soft-deleted ``issue_assignee`` join rows."""
        return Q(
            issue_assignee__assignee_id__in=value,
            issue_assignee__deleted_at__isnull=True,
        )

    def filter_cycle_id(self, queryset, name, value):
        """Filter by cycle ID, excluding soft-deleted ``issue_cycle`` join rows."""
        return Q(
            issue_cycle__cycle_id=value,
            issue_cycle__deleted_at__isnull=True,
        )

    def filter_cycle_id_in(self, queryset, name, value):
        """Filter by cycle IDs (``__in``), excluding soft-deleted ``issue_cycle`` join rows."""
        return Q(
            issue_cycle__cycle_id__in=value,
            issue_cycle__deleted_at__isnull=True,
        )

    def filter_module_id(self, queryset, name, value):
        """Filter by module ID, excluding soft-deleted ``issue_module`` join rows."""
        return Q(
            issue_module__module_id=value,
            issue_module__deleted_at__isnull=True,
        )

    def filter_module_id_in(self, queryset, name, value):
        """Filter by module IDs (``__in``), excluding soft-deleted ``issue_module`` join rows."""
        return Q(
            issue_module__module_id__in=value,
            issue_module__deleted_at__isnull=True,
        )

    def filter_mention_id(self, queryset, name, value):
        """Filter by mention ID, excluding soft-deleted ``issue_mention`` join rows."""
        return Q(
            issue_mention__mention_id=value,
            issue_mention__deleted_at__isnull=True,
        )

    def filter_mention_id_in(self, queryset, name, value):
        """Filter by mention IDs (``__in``), excluding soft-deleted ``issue_mention`` join rows."""
        return Q(
            issue_mention__mention_id__in=value,
            issue_mention__deleted_at__isnull=True,
        )

    def filter_label_id(self, queryset, name, value):
        """Filter by label ID, excluding soft-deleted ``label_issue`` join rows."""
        return Q(
            label_issue__label_id=value,
            label_issue__deleted_at__isnull=True,
        )

    def filter_label_id_in(self, queryset, name, value):
        """Filter by label IDs (``__in``), excluding soft-deleted ``label_issue`` join rows."""
        return Q(
            label_issue__label_id__in=value,
            label_issue__deleted_at__isnull=True,
        )

    def filter_subscriber_id(self, queryset, name, value):
        """Filter by subscriber ID, excluding soft-deleted ``issue_subscribers`` join rows."""
        return Q(
            issue_subscribers__subscriber_id=value,
            issue_subscribers__deleted_at__isnull=True,
        )

    def filter_subscriber_id_in(self, queryset, name, value):
        """Filter by subscriber IDs (``__in``), excluding soft-deleted ``issue_subscribers`` join rows."""
        return Q(
            issue_subscribers__subscriber_id__in=value,
            issue_subscribers__deleted_at__isnull=True,
        )
