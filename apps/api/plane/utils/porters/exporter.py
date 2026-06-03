# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializer-driven data exporter for CSV, JSON, and XLSX outputs.

This module supplies :class:`DataExporter`, the orchestrator that pairs a
Django REST Framework serializer with a pluggable :class:`BaseFormatter`
implementation drawn from the :attr:`DataExporter.FORMATTERS` registry.
Consumers (notably the Celery task ``apps/api/plane/bgtasks/export_task.py``,
running via Celery on RabbitMQ) call :meth:`DataExporter.export` to obtain
an ``(filename, content)`` tuple ready to write or upload. Legacy
:meth:`DataExporter.to_string` and :meth:`DataExporter.to_file` paths are
retained for callers that supply their own formatter instance.
"""

from typing import Dict, List, Union
from .formatters import BaseFormatter, CSVFormatter, JSONFormatter, XLSXFormatter


class DataExporter:
    """Orchestrate serializer-driven exports through the formatter registry.

    Composes a DRF serializer class with a :class:`BaseFormatter` selected
    from :attr:`FORMATTERS` (keyed by ``"csv"``, ``"json"``, ``"xlsx"``) so
    callers obtain ready-to-write payloads without coupling to a specific
    output format. The class uses composition rather than subclass override;
    new formats are added by registering another :class:`BaseFormatter`
    subclass in :attr:`FORMATTERS`.

    Usage:
        # New simplified interface
        exporter = DataExporter(BookSerializer, format_type='csv')
        filename, content = exporter.export('books_export', queryset)

        # Legacy interface (still supported)
        exporter = DataExporter(BookSerializer)
        csv_string = exporter.to_string(queryset, CSVFormatter())
    """

    # Available formatters
    FORMATTERS = {
        "csv": CSVFormatter,
        "json": JSONFormatter,
        "xlsx": XLSXFormatter,
    }

    def __init__(self, serializer_class, format_type: str = None, **serializer_kwargs):
        """
        Initialize exporter with serializer and optional format type.

        Args:
            serializer_class: DRF serializer class to use for data serialization
            format_type: Optional format type (csv, json, xlsx). If provided, enables export() method.
            **serializer_kwargs: Additional kwargs to pass to serializer
        """
        self.serializer_class = serializer_class
        self.serializer_kwargs = serializer_kwargs
        self.format_type = format_type
        self.formatter = None

        if format_type:
            if format_type not in self.FORMATTERS:
                raise ValueError(f"Unsupported format: {format_type}. Available: {list(self.FORMATTERS.keys())}")
            # Create formatter with default options
            self.formatter = self._create_formatter(format_type)

    def _create_formatter(self, format_type: str) -> BaseFormatter:
        """Create formatter instance with appropriate options."""
        formatter_class = self.FORMATTERS[format_type]

        # Apply format-specific options
        if format_type == "xlsx":
            return formatter_class(list_joiner=", ")
        else:
            return formatter_class()

    def serialize(self, queryset) -> List[Dict]:
        """Serialize ``queryset`` to a list of plain ``dict`` rows via the bound serializer."""
        serializer = self.serializer_class(
            queryset,
            many=True,
            **self.serializer_kwargs
        )
        return serializer.data

    def export(self, filename: str, queryset) -> tuple[str, Union[str, bytes]]:
        """Export ``queryset`` using the configured formatter and filename stem.

        Args:
            filename: Base filename (without extension).
            queryset: Django QuerySet to export.

        Returns:
            Tuple of (filename_with_extension, content).

        Raises:
            ValueError: If ``format_type`` was not provided at initialization.
        """
        if not self.formatter:
            raise ValueError("format_type must be provided during initialization to use export() method")

        data = self.serialize(queryset)
        content = self.formatter.encode(data)
        full_filename = f"{filename}.{self.formatter.extension}"

        return full_filename, content

    def to_string(self, queryset, formatter: BaseFormatter) -> Union[str, bytes]:
        """Return the encoded payload for ``queryset`` using a caller-supplied formatter (legacy interface)."""
        data = self.serialize(queryset)
        return formatter.encode(data)

    def to_file(self, queryset, filepath: str, formatter: BaseFormatter) -> str:
        """Write the encoded payload for ``queryset`` to ``filepath`` as UTF-8 text (legacy interface)."""
        content = self.to_string(queryset, formatter)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return filepath

    @classmethod
    def get_available_formats(cls) -> List[str]:
        """Get list of available export formats."""
        return list(cls.FORMATTERS.keys())
