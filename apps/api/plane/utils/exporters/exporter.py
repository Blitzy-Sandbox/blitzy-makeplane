# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Schema-driven export orchestration for CSV, JSON, and XLSX outputs.

This module defines :class:`Exporter`, the entry point that wires a
declarative ``ExportSchema`` (see :mod:`plane.utils.exporters.schemas`)
together with a format-specific writer
(:class:`~plane.utils.exporters.formatters.CSVFormatter`,
:class:`~plane.utils.exporters.formatters.JSONFormatter`,
:class:`~plane.utils.exporters.formatters.XLSXFormatter`) and emits a
``(filename, content)`` tuple ready for upload or in-memory streaming.
Callers may pass either a Django ``QuerySet`` (serialized through the
schema) or an already-serialized ``List[dict]`` (forwarded as-is).

The companion :mod:`plane.utils.exporters.formatters` module routes CSV
output through :func:`plane.utils.csv_utils.sanitize_csv_value` to
neutralize CSV formula injection. Storage placement (S3/MinIO upload,
ZIP packaging) is the caller's responsibility -- this module returns
bytes and a filename only.

This package is parallel to :mod:`plane.utils.porters`, which provides
the DRF-serializer-based export pipeline currently used by
:mod:`plane.bgtasks.export_task`. No Celery task in :mod:`plane.bgtasks`
dispatches this class directly as of the current code state.
"""

from typing import Any, Dict, List, Type, Union

from django.db.models import QuerySet

from .formatters import CSVFormatter, JSONFormatter, XLSXFormatter


class Exporter:
    """Schema-driven export orchestrator for CSV, JSON, and XLSX outputs.

    Wires a declarative ``ExportSchema`` subclass (see
    :mod:`plane.utils.exporters.schemas`) together with one of the
    registered formatters (``csv`` / ``json`` / ``xlsx``) and emits a
    ``(filename, content)`` tuple. Field ordering, labels, and value
    preparation are taken from the schema; the optional ``fields``
    argument on :meth:`export` restricts the output to a subset of
    declared fields, and per-format options are forwarded via
    ``self.options``.

    Supported formats are declared on the class-level :attr:`FORMATTERS`
    mapping (``csv`` -> :class:`CSVFormatter`, ``json`` ->
    :class:`JSONFormatter`, ``xlsx`` -> :class:`XLSXFormatter`) and may
    be extended at runtime via :meth:`register_formatter`.

    This class is the schema-driven counterpart to
    :class:`plane.utils.porters.exporter.DataExporter`, which serves the
    DRF-serializer-backed export path currently invoked by
    :mod:`plane.bgtasks.export_task`.
    """

    # Available formatters
    FORMATTERS = {
        "csv": CSVFormatter,
        "json": JSONFormatter,
        "xlsx": XLSXFormatter,
    }

    def __init__(self, format_type: str, schema_class: Type, options: Dict[str, Any] = None):
        """Initialize exporter with specified format type and schema.

        Args:
            format_type: The export format (csv, json, xlsx)
            schema_class: The schema class to use for field definitions
            options: Optional formatting options
        """
        if format_type not in self.FORMATTERS:
            raise ValueError(f"Unsupported format: {format_type}. Available: {list(self.FORMATTERS.keys())}")

        self.format_type = format_type
        self.schema_class = schema_class
        self.formatter = self.FORMATTERS[format_type]()
        self.options = options or {}

    def export(
        self,
        filename: str,
        data: Union[QuerySet, List[dict]],
        fields: List[str] = None,
    ) -> tuple[str, str | bytes]:
        """Export data using the configured formatter and return (filename, content).

        Args:
            filename: The filename for the export (without extension)
            data: Either a Django QuerySet or a list of already-serialized dicts
            fields: Optional list of field names to include in export

        Returns:
            Tuple of (filename_with_extension, content)
        """
        # Serialize the queryset if needed
        if isinstance(data, QuerySet):
            records = self.schema_class.serialize_queryset(data, fields=fields)
        else:
            # Already serialized data
            records = data

        # Merge fields into options for the formatter
        format_options = {**self.options}
        if fields:
            format_options["fields"] = fields

        return self.formatter.format(filename, records, self.schema_class, format_options)

    @classmethod
    def get_available_formats(cls) -> List[str]:
        """Get list of available export formats."""
        return list(cls.FORMATTERS.keys())

    @classmethod
    def register_formatter(cls, format_type: str, formatter_class: type) -> None:
        """Register a new formatter for a format type."""
        cls.FORMATTERS[format_type] = formatter_class
