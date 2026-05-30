# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Legacy → rich filter format converter.

This module exposes :class:`LegacyToRichFiltersConverter`, which
translates Plane's v1 "legacy" flat-dict filter format (still used by
saved views and persisted in the ``filters`` JSON column) into the
v2 "rich" nested operator-tree format consumed by the advanced filter
UI and :class:`plane.utils.filters.filter_backend.ComplexFilterBackend`
(persisted in the ``rich_filters`` JSON column).

Wire format — legacy (input)
----------------------------

Flat ``{name: value}`` dict where ``name`` is a user-facing label and
``value`` is a scalar, list of scalars, or — for date fields — a
list of strings using a ``"<date>;<direction>"`` directional syntax::

    {
        "state":       ["<uuid>", "<uuid>"],         # M:N IDs
        "priority":    "high",                       # scalar choice
        "labels":      ["<uuid>"],                   # single-element list
        "assignees":   ["<uuid>", "<uuid>"],         # multi-value M:N
        "start_date":  ["2023-01-01"],               # simple date
        "target_date": ["2023-01-01;after", "2023-12-31;before"],
                                                     # range (after AND before)
        "start_date":  ["2_weeks"],                  # relative — SKIPPED
    }

Wire format — rich (output)
---------------------------

Either a single-leaf dict (when exactly one condition is produced) or
a top-level ``"and"`` of leaf conditions. Each leaf key is
``<rich_field>__<lookup>``; list values are joined with commas for the
``__in`` and ``__range`` lookups (so the value is always a string,
never a list)::

    # Empty input
    {}

    # One condition -> leaf
    {"state_id__in": "<uuid>,<uuid>"}

    # Multiple conditions -> wrapped in "and"
    {
        "and": [
            {"state_id__in":   "<uuid>,<uuid>"},
            {"priority__exact": "high"},
            {"target_date__range": "2023-01-01,2023-12-31"},
        ]
    }

Lossiness boundary
------------------

Conversion is intentionally lossy in two scenarios:

  1. **Relative date patterns** like ``"2_weeks"`` / ``"3_months"``
     are SKIPPED for the entire field — the rich format expresses
     absolute dates only and there is no rich equivalent.
  2. **Complex date conditions** (more than two ``"<date>;<dir>"``
     parts) are SKIPPED — only the simple ``after && before`` range
     OR a single ``__exact`` are emitted.

Both behaviors are intentional and are NOT signaled as errors even in
strict mode — see ``_convert_date_value`` for the exact rules.

Strict vs non-strict mode
-------------------------

  - **Non-strict** (default, used by the data migration at
    :mod:`plane.db.migrations.0107_migrate_filters_to_rich_filters`):
    silently drops invalid values (bad UUIDs, unknown choices,
    malformed dates) and unsupported legacy keys. Used to backfill
    ``rich_filters`` on existing rows where we'd rather drop garbage
    than abort the migration.
  - **Strict**: collects every validation issue into a list and
    raises a single ``ValueError`` at the end with a
    semicolon-joined error message. Used by callers that want a hard
    failure for invalid input.

Configuration
-------------

Conversion is driven by four class-level defaults
(``DEFAULT_FIELD_MAPPINGS``, ``DEFAULT_UUID_FIELDS``,
``DEFAULT_VALID_CHOICES``, ``DEFAULT_DATE_FIELDS``). Callers may
extend or replace any of them via constructor args; the per-instance
copies (``FIELD_MAPPINGS``, ``UUID_FIELDS``, ``VALID_CHOICES``,
``DATE_FIELDS``) are built once in ``__init__`` and never mutate the
class-level defaults.
"""

import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Union

from dateutil.parser import parse as dateutil_parse


class LegacyToRichFiltersConverter:
    """Stateful converter from legacy flat-dict filters to rich operator-tree filters.

    Instantiate once per migration / request and call
    :meth:`convert` repeatedly. The instance carries the active
    ``FIELD_MAPPINGS`` / ``UUID_FIELDS`` / ``VALID_CHOICES`` /
    ``DATE_FIELDS`` configuration (initialized in
    :meth:`__init__` from the ``DEFAULT_*`` class attributes, with
    optional extension or full replacement via constructor args).

    Public API:

      - :meth:`convert` — main entry point; legacy dict -> rich dict
        (or raises ``ValueError`` in strict mode).
      - :meth:`add_field_mapping`, :meth:`add_uuid_field`,
        :meth:`add_choice_field`, :meth:`add_date_field`,
        :meth:`update_mappings` — runtime extension helpers used by
        the migration to add migration-specific field mappings.

    Class-level defaults (immutable; per-instance copies are made):

      - ``DEFAULT_FIELD_MAPPINGS``: 12 legacy → rich field renames
        (``state`` → ``state_id``, ``labels`` → ``label_id``,
        ``cycle`` → ``cycle_id``, ``module`` → ``module_id``,
        ``assignees`` → ``assignee_id``,
        ``mentions`` → ``mention_id``,
        ``created_by`` → ``created_by_id``,
        ``project`` → ``project_id``, plus identity mappings for
        ``state_group``, ``priority``, ``start_date``,
        ``target_date``).
      - ``DEFAULT_UUID_FIELDS``: 8 rich fields whose values must
        parse via :class:`uuid.UUID`.
      - ``DEFAULT_VALID_CHOICES``: ``state_group`` ∈
        {backlog, unstarted, started, completed, cancelled};
        ``priority`` ∈ {urgent, high, medium, low, none}.
      - ``DEFAULT_DATE_FIELDS``: {``start_date``, ``target_date``}.
      - ``DATE_PATTERN``: regex matching relative-date tokens like
        ``2_weeks`` or ``3_months`` so they can be detected and
        skipped (no rich-format equivalent).

    See the module docstring for the input / output wire formats,
    the lossiness boundary, and the strict vs non-strict semantics.
    """

    # Default mapping from legacy filter names to new rich filter field names
    DEFAULT_FIELD_MAPPINGS = {
        "state": "state_id",
        "labels": "label_id",
        "cycle": "cycle_id",
        "module": "module_id",
        "assignees": "assignee_id",
        "mentions": "mention_id",
        "created_by": "created_by_id",
        "state_group": "state_group",
        "priority": "priority",
        "project": "project_id",
        "start_date": "start_date",
        "target_date": "target_date",
    }

    # Default fields that expect UUID values
    DEFAULT_UUID_FIELDS = {
        "state_id",
        "label_id",
        "cycle_id",
        "module_id",
        "assignee_id",
        "mention_id",
        "created_by_id",
        "project_id",
    }

    # Default valid choices for choice fields
    DEFAULT_VALID_CHOICES = {
        "state_group": ["backlog", "unstarted", "started", "completed", "cancelled"],
        "priority": ["urgent", "high", "medium", "low", "none"],
    }

    # Default date fields
    DEFAULT_DATE_FIELDS = {"start_date", "target_date"}

    # Pattern for relative date strings like "2_weeks" or "3_months"
    DATE_PATTERN = re.compile(r"(\d+)_(weeks|months)$")

    def __init__(
        self,
        field_mappings: Dict[str, str] = None,
        uuid_fields: set = None,
        valid_choices: Dict[str, List[str]] = None,
        date_fields: set = None,
        extend_defaults: bool = True,
    ):
        """
        Initialize the converter with optional custom configurations.

        Args:
            field_mappings: Custom field mappings (legacy_key -> rich_field_name)
            uuid_fields: Set of field names that should be validated as UUIDs
            valid_choices: Dict of valid choices for choice fields
            date_fields: Set of field names that should be treated as dates
            extend_defaults: If True, merge with defaults; if False, replace defaults

        Examples:
            # Use defaults
            converter = LegacyToRichFiltersConverter()

            # Add custom field mapping
            converter = LegacyToRichFiltersConverter(
                field_mappings={"custom_field": "custom_field_id"}
            )

            # Override priority choices
            converter = LegacyToRichFiltersConverter(
                valid_choices={"priority": ["critical", "high", "medium", "low"]}
            )

            # Complete replacement (not extending defaults)
            converter = LegacyToRichFiltersConverter(
                field_mappings={"state": "status_id"},
                extend_defaults=False
            )
        """
        if extend_defaults:
            # Merge with defaults
            self.FIELD_MAPPINGS = {**self.DEFAULT_FIELD_MAPPINGS}
            if field_mappings:
                self.FIELD_MAPPINGS.update(field_mappings)

            self.UUID_FIELDS = {*self.DEFAULT_UUID_FIELDS}
            if uuid_fields:
                self.UUID_FIELDS.update(uuid_fields)

            self.VALID_CHOICES = {**self.DEFAULT_VALID_CHOICES}
            if valid_choices:
                self.VALID_CHOICES.update(valid_choices)

            self.DATE_FIELDS = {*self.DEFAULT_DATE_FIELDS}
            if date_fields:
                self.DATE_FIELDS.update(date_fields)
        else:
            # Replace defaults entirely
            self.FIELD_MAPPINGS = field_mappings or {}
            self.UUID_FIELDS = uuid_fields or set()
            self.VALID_CHOICES = valid_choices or {}
            self.DATE_FIELDS = date_fields or set()

    def add_field_mapping(self, legacy_key: str, rich_field_name: str) -> None:
        """Add or update a single field mapping."""
        self.FIELD_MAPPINGS[legacy_key] = rich_field_name

    def add_uuid_field(self, field_name: str) -> None:
        """Add a field that should be validated as UUID."""
        self.UUID_FIELDS.add(field_name)

    def add_choice_field(self, field_name: str, choices: List[str]) -> None:
        """Add or update valid choices for a choice field."""
        self.VALID_CHOICES[field_name] = choices

    def add_date_field(self, field_name: str) -> None:
        """Add a field that should be treated as a date field."""
        self.DATE_FIELDS.add(field_name)

    def update_mappings(
        self,
        field_mappings: Dict[str, str] = None,
        uuid_fields: set = None,
        valid_choices: Dict[str, List[str]] = None,
        date_fields: set = None,
    ) -> None:
        """
        Update multiple configurations at once.

        Args:
            field_mappings: Additional field mappings to add/update
            uuid_fields: Additional UUID fields to add
            valid_choices: Additional choice fields to add/update
            date_fields: Additional date fields to add
        """
        if field_mappings:
            self.FIELD_MAPPINGS.update(field_mappings)
        if uuid_fields:
            self.UUID_FIELDS.update(uuid_fields)
        if valid_choices:
            self.VALID_CHOICES.update(valid_choices)
        if date_fields:
            self.DATE_FIELDS.update(date_fields)

    def _validate_uuid(self, value: str) -> bool:
        """Return ``True`` iff ``value`` parses as a valid UUID."""
        try:
            uuid.UUID(str(value))
            return True
        except (ValueError, TypeError):
            return False

    def _validate_choice(self, field_name: str, value: str) -> bool:
        """Return ``True`` iff ``value`` is an allowed choice for ``field_name``.

        Returns ``True`` for fields not registered in ``VALID_CHOICES``.
        """
        if field_name not in self.VALID_CHOICES:
            return True  # No validation needed for this field
        return value in self.VALID_CHOICES[field_name]

    def _validate_date(self, value: Union[str, datetime]) -> bool:
        """Return ``True`` iff ``value`` is a valid date.

        Accepts a :class:`~datetime.datetime` instance or a string
        parseable by :func:`dateutil.parser.parse`.
        """
        if isinstance(value, datetime):
            return True
        if isinstance(value, str):
            try:
                # Use dateutil for flexible date parsing
                dateutil_parse(value)
                return True
            except (ValueError, TypeError):
                return False
        return False

    def _validate_value(self, rich_field_name: str, value: Any) -> bool:
        """Dispatch validation to UUID / choice / date validators by field type.

        Routes to :meth:`_validate_uuid` / :meth:`_validate_choice` /
        :meth:`_validate_date` based on which set ``rich_field_name``
        belongs to. Returns ``True`` if no specific validator applies.
        """
        if rich_field_name in self.UUID_FIELDS:
            return self._validate_uuid(value)
        elif rich_field_name in self.VALID_CHOICES:
            return self._validate_choice(rich_field_name, value)
        elif rich_field_name in self.DATE_FIELDS:
            return self._validate_date(value)
        return True  # No specific validation needed

    def _filter_valid_values(self, rich_field_name: str, values: List[Any]) -> List[Any]:
        """Return the subset of ``values`` for which :meth:`_validate_value` returns ``True`` (preserves order)."""
        valid_values = []
        for value in values:
            if self._validate_value(rich_field_name, value):
                valid_values.append(value)
        return valid_values

    def _add_validation_error(self, strict: bool, validation_errors: List[str], message: str) -> None:
        """Add validation error if in strict mode."""
        if strict:
            validation_errors.append(message)

    def _add_rich_filter(self, rich_filters: Dict[str, Any], field_name: str, operator: str, value: Any) -> None:
        """Add a rich filter with proper field name formatting."""
        # Convert lists to comma-separated strings for 'in' and 'range' operations
        if operator in ("in", "range") and isinstance(value, list):
            value = ",".join(str(v) for v in value)
        rich_filters[f"{field_name}__{operator}"] = value

    def _handle_value_error(self, e: ValueError, strict: bool, validation_errors: List[str]) -> None:
        """Handle ValueError with consistent strict/non-strict behavior."""
        if strict:
            validation_errors.append(str(e))
        # In non-strict mode, we just skip (no action needed)

    def _process_date_field(
        self,
        rich_field_name: str,
        values: List[str],
        strict: bool,
        validation_errors: List[str],
        rich_filters: Dict[str, Any],
    ) -> bool:
        """Process date field with basic functionality (exact, range)."""
        if rich_field_name not in self.DATE_FIELDS:
            return False

        try:
            date_filter_result = self._convert_date_value(rich_field_name, values, strict)
            if date_filter_result:
                rich_filters.update(date_filter_result)
            return True
        except ValueError as e:
            self._handle_value_error(e, strict, validation_errors)
            return True

    def _convert_date_value(self, field_name: str, values: List[str], strict: bool = False) -> Dict[str, Any]:
        """
        Convert legacy date values to rich filter format - basic implementation.

        Supports:
        - Simple dates: "2023-01-01" -> __exact
        - Basic ranges: ["2023-01-01;after", "2023-12-31;before"] -> __range
        - Skips complex or relative date patterns

        Args:
            field_name: Name of the rich filter field
            values: List of legacy date values
            strict: If True, raise errors for validation failures

        Raises:
            ValueError: For malformed date patterns (strict mode)
        """
        # Check for relative dates and skip the entire field if found
        for value in values:
            if ";" in value:
                parts = value.split(";")
                if len(parts) > 0 and self.DATE_PATTERN.match(parts[0]):
                    # Skip relative date patterns entirely
                    return {}

        # Skip complex conditions (more than 2 values)
        if len(values) > 2:
            return {}

        # Process each date value
        exact_dates = []
        after_dates = []
        before_dates = []

        for value in values:
            if ";" not in value:
                # Simple date string
                if not self._validate_date(value):
                    if strict:
                        raise ValueError(f"Invalid date format: {value}")
                    continue
                exact_dates.append(value)
            else:
                # Directional date - only handle basic after/before
                parts = value.split(";")
                if len(parts) < 2:
                    if strict:
                        raise ValueError(f"Invalid date format: {value}")
                    continue

                date_part = parts[0]
                direction = parts[1]

                if not self._validate_date(date_part):
                    if strict:
                        raise ValueError(f"Invalid date format: {date_part}")
                    continue

                if direction == "after":
                    after_dates.append(date_part)
                elif direction == "before":
                    before_dates.append(date_part)
                # Skip unsupported directions

        # Determine return format
        result = {}
        if len(after_dates) == 1 and len(before_dates) == 1 and len(exact_dates) == 0:
            # Simple range: one after and one before
            start_date = min(after_dates[0], before_dates[0])
            end_date = max(after_dates[0], before_dates[0])
            self._add_rich_filter(result, field_name, "range", [start_date, end_date])
        elif len(exact_dates) == 1 and len(after_dates) == 0 and len(before_dates) == 0:
            # Single exact date
            self._add_rich_filter(result, field_name, "exact", exact_dates[0])
        # Skip all other combinations

        return result

    def convert(self, legacy_filters: dict, strict: bool = False) -> Dict[str, Any]:
        """
        Convert a legacy flat-dict filter into the rich operator-tree filter format.

        See the module docstring for the input / output wire formats
        and the lossiness boundary. Unsupported legacy keys (those not
        in ``self.FIELD_MAPPINGS``) and individually-invalid values
        (bad UUID, unknown choice, unparseable date) are skipped in
        non-strict mode; in strict mode every issue is collected and
        a single ``ValueError`` is raised at the end with a
        semicolon-joined error message.

        Args:
            legacy_filters: Dict of legacy filters
                (see module docstring for wire format).
            strict: If True, collect validation errors and raise
                ``ValueError`` at the end. If False (default),
                silently skip invalid values.

        Returns:
            Rich filter dict (empty dict, single leaf, or
            ``{"and": [...]}`` of leaves).

        Raises:
            ValueError: If ``strict=True`` and validation found at
                least one issue.
        """
        rich_filters = {}
        validation_errors = []

        for legacy_key, value in legacy_filters.items():
            # Skip if value is None or empty
            if value is None or (isinstance(value, list) and len(value) == 0):
                continue

            # Skip if legacy key is not in our mappings (not supported in filterset)
            if legacy_key not in self.FIELD_MAPPINGS:
                self._add_validation_error(strict, validation_errors, f"Unsupported filter key: {legacy_key}")
                continue

            # Get the new field name
            rich_field_name = self.FIELD_MAPPINGS[legacy_key]

            # Handle list values
            if isinstance(value, list):
                # Process date fields with helper method
                if self._process_date_field(rich_field_name, value, strict, validation_errors, rich_filters):
                    continue

                # Regular non-date field processing
                # Filter out invalid values
                valid_values = self._filter_valid_values(rich_field_name, value)

                if not valid_values:
                    self._add_validation_error(
                        strict,
                        validation_errors,
                        f"No valid values found for {legacy_key}: {value}",
                    )
                    continue

                # Check for invalid values if in strict mode
                if strict and len(valid_values) != len(value):
                    invalid_values = [v for v in value if v not in valid_values]
                    self._add_validation_error(
                        strict,
                        validation_errors,
                        f"Invalid values for {legacy_key}: {invalid_values}",
                    )

                # For list values, always use __in operator for non-date fields
                self._add_rich_filter(rich_filters, rich_field_name, "in", valid_values)

            else:
                # Handle single values
                # Process date fields with helper method
                if self._process_date_field(rich_field_name, [value], strict, validation_errors, rich_filters):
                    continue

                # For non-list values, use __exact operator for non-date fields
                if self._validate_value(rich_field_name, value):
                    self._add_rich_filter(rich_filters, rich_field_name, "exact", value)
                else:
                    error_msg = f"Invalid value for {legacy_key}: {value}"
                    self._add_validation_error(strict, validation_errors, error_msg)

        # Raise validation errors if in strict mode
        if strict and validation_errors:
            error_message = f"Filter validation errors: {'; '.join(validation_errors)}"
            raise ValueError(error_message)

        # Convert flat dict to rich filter format
        return self._format_as_rich_filter(rich_filters)

    def _format_as_rich_filter(self, flat_filters: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert a flat dictionary of filters to the proper rich filter format.

        Args:
            flat_filters: Dictionary with field__lookup keys and values

        Returns:
            Rich filter format using logical operators (and/or/not)
        """
        if not flat_filters:
            return {}

        # If only one filter, return as leaf node
        if len(flat_filters) == 1:
            key, value = next(iter(flat_filters.items()))
            return {key: value}

        # Multiple filters: wrap in 'and' operator
        filter_conditions = []
        for key, value in flat_filters.items():
            filter_conditions.append({key: value})

        return {"and": filter_conditions}
