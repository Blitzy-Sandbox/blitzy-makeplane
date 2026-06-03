# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF filterset adapter layer for the Plane API.

This package is the public façade for Plane's lower-level filtering machinery
(django-filter integration, JSON ``Q`` translation, and persisted-filter
format conversion). It is DISTINCT from :mod:`plane.utils.issue_filters`,
which resolves the legacy query-parameter contract (``?state=...&priority=...``)
into ORM kwargs.

Re-exports (matches ``__all__``):

  - :class:`~plane.utils.filters.filter_backend.ComplexFilterBackend` — DRF
    ``BaseFilterBackend`` subclass that accepts a nested JSON filter payload
    (via the ``?filters=...`` query parameter or a ``filter_data`` kwarg) and
    translates it into a single ORM ``Q`` expression using the view's
    ``filterset_class``. Supports ``and`` / ``or`` / ``not`` composition with
    a configurable nesting-depth ceiling.
  - :class:`~plane.utils.filters.converters.LegacyToRichFiltersConverter` —
    converts older flat legacy filter dictionaries (e.g.,
    ``{"state": [uuid, ...], "priority": [...]}``) into the new
    ``field__lookup`` rich-filter tree used by the v2 advanced-filter UI and
    persisted in ``IssueView.rich_filters`` (and similar JSON columns on
    ``WorkspaceUserProperties`` / ``ModuleUserProperties`` /
    ``IssueUserProperty`` / ``CycleUserProperties``).
  - :class:`~plane.utils.filters.filterset.BaseFilterSet` — extends
    :class:`django_filters.FilterSet` with cloned ``__exact`` aliases, a
    ``build_combined_q`` method consumed by :class:`ComplexFilterBackend`,
    and a ``filter_queryset`` override that applies ``.distinct()`` only when
    a filter declares ``distinct=True``.
  - :class:`~plane.utils.filters.filterset.IssueFilterSet` —
    :class:`BaseFilterSet` for the ``Issue`` model with soft-delete-aware
    joins (every relationship-based filter excludes rows with
    ``deleted_at`` set) on assignee / cycle / module / mention / label /
    subscriber relations.

Submodules (not all are re-exported here):

  - :mod:`~plane.utils.filters.filter_backend`    — JSON ``Q`` translator.
  - :mod:`~plane.utils.filters.converters`        — legacy ↔ rich format conversion.
  - :mod:`~plane.utils.filters.filterset`         — base + ``Issue``-specific filtersets.
  - :mod:`~plane.utils.filters.filter_migrations` — operational helpers for the
    Django data migration that backfills ``rich_filters`` from legacy
    ``filters`` columns (used by
    ``apps/api/plane/db/migrations/0107_migrate_filters_to_rich_filters.py``).

Downstream consumers: filtered querysets flow into
:func:`plane.utils.grouper.issue_queryset_grouper` (group annotation /
soft-delete-aware m2m aggregation) and the
:class:`plane.utils.paginator.GroupedOffsetPaginator` /
:class:`plane.utils.paginator.SubGroupedOffsetPaginator` stack.
"""

# Filters module for handling complex filtering operations

# Import all utilities from base modules
from .filter_backend import ComplexFilterBackend
from .converters import LegacyToRichFiltersConverter
from .filterset import BaseFilterSet, IssueFilterSet


# Public API exports
__all__ = ["ComplexFilterBackend", "LegacyToRichFiltersConverter", "BaseFilterSet", "IssueFilterSet"]
