# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Declarative schema layer for the ``plane.utils.exporters`` pipeline.

This subpackage defines the typed field primitives (:class:`ExportField`,
:class:`StringField`, :class:`NumberField`, :class:`DateField`,
:class:`DateTimeField`, :class:`BooleanField`, :class:`ListField`,
:class:`JSONField`), the :class:`ExportSchema` base class that captures
declared field ordering via
:class:`~plane.utils.exporters.schemas.base.ExportSchemaMeta`, and the
concrete :class:`IssueExportSchema` for Plane issue records.

The ``ExportSchema._declared_fields`` ordered mapping is the introspection
surface consumed by
:meth:`plane.utils.exporters.formatters.BaseFormatter._get_field_info` to
recover column order and human-readable labels when writing CSV, JSON,
and XLSX outputs.
"""

from .base import (
    BooleanField,
    DateField,
    DateTimeField,
    ExportField,
    ExportSchema,
    JSONField,
    ListField,
    NumberField,
    StringField,
)
from .issue import IssueExportSchema

__all__ = [
    # Base field types
    "ExportField",
    "StringField",
    "NumberField",
    "DateField",
    "DateTimeField",
    "BooleanField",
    "ListField",
    "JSONField",
    # Base schema
    "ExportSchema",
    # Issue schema
    "IssueExportSchema",
]
