# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Per-format row/column writers for the export pipeline.

This module supplies the file-format writers consumed by
``plane.utils.exporters.exporter.Exporter``. Each formatter accepts
schema-serialized records (a ``List[dict]``), a schema class (used to
recover declared field order and labels), and an options bag, and
returns a ``(filename_with_extension, content)`` tuple.

- ``CSVFormatter`` emits comma-delimited UTF-8 text with
  ``csv.QUOTE_ALL``. Every row is routed through
  ``plane.utils.csv_utils.sanitize_csv_row`` to prefix values starting
  with formula-trigger characters (``=``, ``+``, ``-``, ``@``, tab,
  carriage return, newline) with a single quote, defeating OWASP-style
  CSV formula injection when the file is opened in a spreadsheet
  application.
- ``JSONFormatter`` emits a JSON array, preserving Python primitive
  types (lists stay as arrays, dicts stay as objects).
- ``XLSXFormatter`` emits an XLSX workbook built with ``openpyxl`` in
  an in-memory ``BytesIO`` buffer.

All formatters are intentionally stateless across export calls; per-call
behavior is driven by the ``options`` dict (notably the ``fields``
allow-list and the CSV/XLSX ``list_joiner`` separator).
"""

import csv
import io
import json
from typing import Any, Dict, List, Type

from openpyxl import Workbook

# Module imports
from plane.utils.csv_utils import sanitize_csv_row


class BaseFormatter:
    """Base class for export formatters."""

    def format(
        self,
        filename: str,
        records: List[dict],
        schema_class: Type,
        options: Dict[str, Any] | None = None,
    ) -> tuple[str, str | bytes]:
        """Format records for export.

        Args:
            filename: The filename for the export (without extension)
            records: List of records to export
            schema_class: Schema class to extract field order and labels
            options: Optional formatting options

        Returns:
            Tuple of (filename_with_extension, content)
        """
        raise NotImplementedError

    @staticmethod
    def _get_field_info(schema_class: Type) -> tuple[List[str], Dict[str, str]]:
        """Extract field order and labels from schema.

        Args:
            schema_class: Schema class with field definitions

        Returns:
            Tuple of (field_order, field_labels)
        """
        if not hasattr(schema_class, "_declared_fields"):
            raise ValueError(f"Schema class {schema_class.__name__} must have _declared_fields attribute")

        # Get order and labels from schema
        field_order = list(schema_class._declared_fields.keys())
        field_labels = {
            name: field.label if field.label else name.replace("_", " ").title()
            for name, field in schema_class._declared_fields.items()
        }

        return field_order, field_labels


class CSVFormatter(BaseFormatter):
    """Formatter for CSV exports."""

    @staticmethod
    def _format_field_value(value: Any, list_joiner: str = ", ") -> str:
        """Format a field value for CSV output."""
        if value is None:
            return ""
        if isinstance(value, list):
            return list_joiner.join(str(v) for v in value)
        if isinstance(value, dict):
            # For complex objects, serialize as JSON
            return json.dumps(value)
        return str(value)

    def _generate_table_row(
        self, record: dict, field_order: List[str], options: Dict[str, Any] | None = None
    ) -> List[str]:
        """Generate a CSV row from a record."""
        opts = options or {}
        list_joiner = opts.get("list_joiner", ", ")
        return [self._format_field_value(record.get(field, ""), list_joiner) for field in field_order]

    def _create_csv_file(self, data: List[List[str]]) -> str:
        """Create CSV file content from row data."""
        buf = io.StringIO()
        writer = csv.writer(buf, delimiter=",", quoting=csv.QUOTE_ALL)
        for row in data:
            writer.writerow(sanitize_csv_row(row))
        buf.seek(0)
        return buf.getvalue()

    def format(self, filename, records, schema_class, options: Dict[str, Any] | None = None) -> tuple[str, str]:
        """Serialize ``records`` to a CSV string paired with ``<filename>.csv``.

        Honors ``options['fields']`` (allow-list) and
        ``options['list_joiner']`` (default ``", "``). Every row is
        routed through ``plane.utils.csv_utils.sanitize_csv_row`` to
        neutralize OWASP-style spreadsheet formula injection before the
        bytes leave this process.
        """
        if not records:
            return (f"{filename}.csv", "")

        # Get field order and labels from schema
        field_order, field_labels = self._get_field_info(schema_class)

        # Filter to requested fields if specified
        opts = options or {}
        requested_fields = opts.get("fields")
        if requested_fields:
            field_order = [f for f in field_order if f in requested_fields]

        header = [field_labels[field] for field in field_order]

        rows = [header]
        for record in records:
            row = self._generate_table_row(record, field_order, options)
            rows.append(row)
        content = self._create_csv_file(rows)
        return (f"{filename}.csv", content)


class JSONFormatter(BaseFormatter):
    """Formatter for JSON exports."""

    def _generate_json_row(
        self, record: dict, field_labels: Dict[str, str], field_order: List[str], options: Dict[str, Any] | None = None
    ) -> dict:
        """Generate a JSON object from a record.

        Preserves data types - lists stay as arrays, dicts stay as objects.
        """
        return {field_labels[field]: record.get(field) for field in field_order if field in record}

    def format(self, filename, records, schema_class, options: Dict[str, Any] | None = None) -> tuple[str, str]:
        """Serialize ``records`` to a JSON array string paired with ``<filename>.json``.

        Honors ``options['fields']`` (allow-list). Nested Python lists
        and dicts are preserved as native JSON arrays and objects rather
        than coerced to strings, so downstream consumers can round-trip
        complex values.
        """
        if not records:
            return (f"{filename}.json", "[]")

        # Get field order and labels from schema
        field_order, field_labels = self._get_field_info(schema_class)

        # Filter to requested fields if specified
        opts = options or {}
        requested_fields = opts.get("fields")
        if requested_fields:
            field_order = [f for f in field_order if f in requested_fields]

        rows: List[dict] = []
        for record in records:
            row = self._generate_json_row(record, field_labels, field_order, options)
            rows.append(row)
        content = json.dumps(rows)
        return (f"{filename}.json", content)


class XLSXFormatter(BaseFormatter):
    """Formatter for XLSX (Excel) exports."""

    @staticmethod
    def _format_field_value(value: Any, list_joiner: str = ", ") -> str:
        """Format a field value for XLSX output."""
        if value is None:
            return ""
        if isinstance(value, list):
            return list_joiner.join(str(v) for v in value)
        if isinstance(value, dict):
            # For complex objects, serialize as JSON
            return json.dumps(value)
        return str(value)

    def _generate_table_row(
        self, record: dict, field_order: List[str], options: Dict[str, Any] | None = None
    ) -> List[str]:
        """Generate an XLSX row from a record."""
        opts = options or {}
        list_joiner = opts.get("list_joiner", ", ")
        return [self._format_field_value(record.get(field, ""), list_joiner) for field in field_order]

    def _create_xlsx_file(self, data: List[List[str]]) -> bytes:
        """Create XLSX file content from row data."""
        wb = Workbook()
        sh = wb.active
        for row in data:
            sh.append(row)
        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        return out.getvalue()

    def format(self, filename, records, schema_class, options: Dict[str, Any] | None = None) -> tuple[str, bytes]:
        """Serialize ``records`` to an XLSX workbook bytes blob paired with ``<filename>.xlsx``.

        Honors ``options['fields']`` (allow-list) and
        ``options['list_joiner']`` (default ``", "``). The workbook is
        built in-memory with ``openpyxl`` and returned as raw bytes; the
        caller writes or uploads them.
        """
        if not records:
            # Create empty workbook
            content = self._create_xlsx_file([])
            return (f"{filename}.xlsx", content)

        # Get field order and labels from schema
        field_order, field_labels = self._get_field_info(schema_class)

        # Filter to requested fields if specified
        opts = options or {}
        requested_fields = opts.get("fields")
        if requested_fields:
            field_order = [f for f in field_order if f in requested_fields]

        header = [field_labels[field] for field in field_order]

        rows = [header]
        for record in records:
            row = self._generate_table_row(record, field_order, options)
            rows.append(row)
        content = self._create_xlsx_file(rows)
        return (f"{filename}.xlsx", content)
