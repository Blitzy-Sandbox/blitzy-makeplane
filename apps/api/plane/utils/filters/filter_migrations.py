# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Filter spec migration helpers — backfill / clear ``rich_filters`` JSON columns.

These functions implement the operational layer of the "legacy filters →
rich filters" schema evolution. The Plane data model carries two parallel
JSON columns on saved-view-style records (``IssueView``,
``WorkspaceUserProperties``, ``ModuleUserProperties``, ``IssueUserProperty``,
``CycleUserProperties``):

  - ``filters``      — legacy flat dict (e.g.,
    ``{"state": [uuid1, uuid2], "priority": ["high", "urgent"]}``).
  - ``rich_filters`` — newer ``field__lookup`` tree (e.g.,
    ``{"and": [{"state_id__in": "uuid1,uuid2"}, {"priority__in": "high,urgent"}]}``)
    consumed by the v2 advanced-filter UI and
    :class:`plane.utils.filters.filter_backend.ComplexFilterBackend`.

Forward-compatible schema upgrade (FROM legacy ``filters`` → TO rich
``rich_filters``):

  - :func:`migrate_models_filters_to_rich_filters` iterates a set of model
    classes and, for each, converts every record whose ``filters`` is
    populated and whose ``rich_filters`` is empty, applying
    :class:`~plane.utils.filters.converters.LegacyToRichFiltersConverter`
    in non-strict mode so partial / invalid legacy data is dropped rather
    than aborting the run. Updates are flushed via ``bulk_update`` with a
    batch size of 1000 for efficiency. Per-record exceptions are logged but
    do not abort the rest of the migration (tolerant by design — engineering
    can repair stragglers after the fact).

  - :func:`migrate_single_model_filters` is the per-model worker invoked by
    the bulk orchestrator.

Reverse / cleanup (TO empty ``rich_filters``):

  - :func:`clear_models_rich_filters` clears ``rich_filters`` in bulk across
    multiple models — used as the rollback path on the data migration
    ``apps/api/plane/db/migrations/0107_migrate_filters_to_rich_filters.py``
    or as a maintenance helper when a fresh re-migration is desired.

Logging: all three helpers emit progress and error events to the
``plane.api.filters.migration`` logger. Routed via the JSON formatter from
:mod:`plane.celery` and visible to Sentry.

Intended invocation contexts: Django data migration scripts (via
``RunPython``), management commands, and one-off data-repair tasks. Not part
of the request/response path.
"""

import logging
from typing import Any, Dict, Tuple

from .converters import LegacyToRichFiltersConverter


logger = logging.getLogger("plane.api.filters.migration")


def migrate_single_model_filters(
    model_class, model_name: str, converter: LegacyToRichFiltersConverter
) -> Tuple[int, int]:
    """Convert legacy ``filters`` → ``rich_filters`` for every eligible row of one model.

    FROM: rows where ``filters`` is non-empty AND ``rich_filters`` is empty.
    TO:   ``rich_filters`` populated by
          :meth:`LegacyToRichFiltersConverter.convert` (non-strict mode so
          invalid legacy values are dropped rather than aborting).

    Updates are flushed via :meth:`QuerySet.bulk_update` with
    ``batch_size=1000``. Per-record conversion exceptions are caught and
    logged at WARNING; the loop continues so a single bad row does not abort
    a migration of thousands.

    Args:
        model_class: Django model class with both ``filters`` and
            ``rich_filters`` JSON columns.
        model_name: Human-readable name used in log messages.
        converter: Configured :class:`LegacyToRichFiltersConverter` instance.

    Returns:
        Tuple ``(updated_count, error_count)``.
    """
    # Find records that need migration - have filters but empty rich_filters
    records_to_migrate = model_class.objects.exclude(filters={}).filter(rich_filters={})

    if records_to_migrate.count() == 0:
        logger.info(f"No {model_name} records need migration")
        return 0, 0

    logger.info(f"Found {records_to_migrate.count()} {model_name} records to migrate")

    updated_records = []
    conversion_errors = 0

    for record in records_to_migrate:
        try:
            if record.filters:  # Double check that filters is not empty
                rich_filters = converter.convert(record.filters, strict=False)
                record.rich_filters = rich_filters
                updated_records.append(record)

        except Exception as e:
            logger.warning(f"Failed to convert filters for {model_name} ID {record.id}: {str(e)}")
            conversion_errors += 1
            continue

    # Bulk update all successfully converted records
    if updated_records:
        model_class.objects.bulk_update(updated_records, ["rich_filters"], batch_size=1000)
        logger.info(f"Successfully updated {len(updated_records)} {model_name} records")

    return len(updated_records), conversion_errors


def migrate_models_filters_to_rich_filters(
    models_to_migrate: Dict[str, Any],
    converter: LegacyToRichFiltersConverter,
) -> Dict[str, Tuple[int, int]]:
    """Run :func:`migrate_single_model_filters` across a set of models.

    FROM: legacy ``filters`` columns on each model in ``models_to_migrate``.
    TO:   populated ``rich_filters`` columns on the same rows.

    Tolerant of per-model failure: if conversion fails for an entire model
    the error is logged and the loop continues to the next model so a
    single broken model does not block migration of the others.

    Args:
        models_to_migrate: Mapping of model name -> Django model class.
        converter: Configured :class:`LegacyToRichFiltersConverter` instance.

    Returns:
        Mapping of model name -> ``(updated_count, error_count)``.
    """
    # Initialize the converter with default settings

    logger.info("Starting filters to rich_filters migration for all models")

    results = {}
    total_updated = 0
    total_errors = 0

    for model_name, model_class in models_to_migrate.items():
        try:
            updated_count, error_count = migrate_single_model_filters(model_class, model_name, converter)

            results[model_name] = (updated_count, error_count)
            total_updated += updated_count
            total_errors += error_count

        except Exception as e:
            logger.error(f"Failed to migrate {model_name}: {str(e)}")
            results[model_name] = (0, 1)
            total_errors += 1
            continue

    # Log final summary
    logger.info(f"Migration completed for all models. Total updated: {total_updated}, Total errors: {total_errors}")

    return results


def clear_models_rich_filters(models_to_clear: Dict[str, Any]) -> Dict[str, int]:
    """Clear ``rich_filters`` on every row across a set of models.

    FROM: populated ``rich_filters`` columns.
    TO:   ``rich_filters = {}`` on every affected row.

    Reverse migration / rollback helper: used to undo a prior
    :func:`migrate_models_filters_to_rich_filters` run, or to reset
    ``rich_filters`` before a fresh conversion. Legacy ``filters`` columns
    are untouched.

    Args:
        models_to_clear: Mapping of model name -> Django model class.

    Returns:
        Mapping of model name -> count of rows whose ``rich_filters`` was
        cleared.
    """
    logger.info("Starting reverse migration - clearing rich_filters for all models")

    results = {}
    total_cleared = 0

    for model_name, model_class in models_to_clear.items():
        try:
            # Clear rich_filters for all records that have them
            updated_count = model_class.objects.exclude(rich_filters={}).update(rich_filters={})
            results[model_name] = updated_count
            total_cleared += updated_count
            logger.info(f"Cleared rich_filters for {updated_count} {model_name} records")

        except Exception as e:
            logger.error(f"Failed to clear rich_filters for {model_name}: {str(e)}")
            results[model_name] = 0
            continue

    logger.info(f"Reverse migration completed. Total cleared: {total_cleared}")
    return results
