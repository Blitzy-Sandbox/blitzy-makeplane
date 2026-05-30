# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Schema-driven concrete data-export pipeline for the Plane API.

This package assembles and emits CSV, JSON, and XLSX exports of Django
QuerySet data (or already-serialized dictionaries) using the declarative
``ExportSchema`` system defined in :mod:`plane.utils.exporters.schemas`.
It is distinct from :mod:`plane.utils.porters`, which provides a parallel
export path built on DRF serializers and is currently the surface invoked
by :mod:`plane.bgtasks.export_task`.

The public API surface re-exported below comprises:

- :class:`Exporter` -- the orchestration entry point that selects a
  formatter and serializes input data through a schema class.
- Schema primitives (:class:`ExportSchema`, :class:`ExportField`,
  :class:`StringField`, :class:`NumberField`, :class:`DateField`,
  :class:`DateTimeField`, :class:`BooleanField`, :class:`ListField`,
  :class:`JSONField`) for declaring per-entity export contracts.
- Concrete formatters (:class:`BaseFormatter`, :class:`CSVFormatter`,
  :class:`JSONFormatter`, :class:`XLSXFormatter`) that emit format-aware
  payloads.
- :class:`IssueExportSchema` -- the concrete schema for Plane issues.

CSV outputs are routed through
:func:`plane.utils.csv_utils.sanitize_csv_value` before writing to defend
against spreadsheet formula injection (OWASP CSV Injection).
"""

from .exporter import Exporter
from .formatters import BaseFormatter, CSVFormatter, JSONFormatter, XLSXFormatter
from .schemas import (
    BooleanField,
    DateField,
    DateTimeField,
    ExportField,
    ExportSchema,
    IssueExportSchema,
    JSONField,
    ListField,
    NumberField,
    StringField,
)

__all__ = [
    # Core Exporter
    "Exporter",
    # Schemas
    "ExportSchema",
    "ExportField",
    "StringField",
    "NumberField",
    "DateField",
    "DateTimeField",
    "BooleanField",
    "ListField",
    "JSONField",
    # Formatters
    "BaseFormatter",
    "CSVFormatter",
    "JSONFormatter",
    "XLSXFormatter",
    # Issue Schema
    "IssueExportSchema",
]
