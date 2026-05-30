# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Generic data-porter abstractions for serializer-driven import/export.

This package exposes the format-agnostic porter layer used by export flows
in :mod:`plane.utils.exporters` and by Celery export tasks in
:mod:`plane.bgtasks.export_task`. It composes a DRF serializer with one of
the pluggable :class:`BaseFormatter` subclasses (CSV, JSON, XLSX) via the
:class:`DataExporter` orchestrator, and ships an export-tuned
:class:`IssueExportSerializer` for issue extracts.

Distinct from :mod:`plane.utils.exporters` (the concrete bgtask-driven
export pipeline that uploads results to S3); this package is the reusable
abstraction those pipelines build on.
"""

from .formatters import BaseFormatter, CSVFormatter, JSONFormatter, XLSXFormatter
from .exporter import DataExporter
from .serializers import IssueExportSerializer

__all__ = [
    # Formatters
    "BaseFormatter",
    "CSVFormatter",
    "JSONFormatter",
    "XLSXFormatter",
    # Exporters
    "DataExporter",
    # Export Serializers
    "IssueExportSerializer",
]
