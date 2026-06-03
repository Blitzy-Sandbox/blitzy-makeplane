# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Declarative field/schema primitives for the export pipeline.

Defines :class:`ExportField` and its typed subclasses
(:class:`StringField`, :class:`NumberField`, :class:`DateField`,
:class:`DateTimeField`, :class:`BooleanField`, :class:`ListField`,
:class:`JSONField`), the :class:`ExportSchemaMeta` metaclass that
captures declared fields in source order into ``_declared_fields``, and
the :class:`ExportSchema` base class that turns object/queryset input
into per-format-ready dictionaries.

Each ``ExportField`` carries a ``source`` (dotted-path on the model
instance, resolved via :meth:`ExportField._resolve_dotted_path`), a
``label`` (column header used by the formatters), a ``default`` returned
when the raw value is ``None``, and a typed ``_format_value`` override
that coerces the raw attribute into the output type required by
:mod:`plane.utils.exporters.formatters`. Subclasses of
:class:`ExportSchema` may additionally define ``prepare_<field_name>``
methods to override per-field serialization with arbitrary Python (used
extensively by
:class:`~plane.utils.exporters.schemas.issue.IssueExportSchema`), and
may override the classmethod :meth:`ExportSchema.get_context_data` to
precompute queryset-wide lookups (e.g., reverse-join dictionaries)
before per-row serialization.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from django.db.models import QuerySet


@dataclass
class ExportField:
    """Base export field class for generic fields."""

    source: Optional[str] = None
    default: Any = ""
    label: Optional[str] = None  # Display name for export headers

    def get_value(self, obj: Any, context: Dict[str, Any]) -> Any:
        """Resolve and format the field value from ``obj``.

        Walks the dotted ``self.source`` path on ``obj`` (or returns
        ``obj`` itself when ``source`` is unset) and coerces the result
        through :meth:`_format_value`.
        """
        raw: Any
        if self.source:
            raw = self._resolve_dotted_path(obj, self.source)
        else:
            raw = obj

        return self._format_value(raw)

    def _format_value(self, raw: Any) -> Any:
        """Format the raw value. Override in subclasses for type-specific formatting."""
        return raw if raw is not None else self.default

    def _resolve_dotted_path(self, obj: Any, path: str) -> Any:
        current = obj
        for part in path.split("."):
            if current is None:
                return None
            if hasattr(current, part):
                current = getattr(current, part)
            elif isinstance(current, dict):
                current = current.get(part)
            else:
                return None
        return current


@dataclass
class StringField(ExportField):
    """Export field for string values."""

    default: str = ""

    def _format_value(self, raw: Any) -> str:
        if raw is None:
            return self.default
        return str(raw)


@dataclass
class DateField(ExportField):
    """Export field for date values with automatic conversion."""

    default: str = ""

    def _format_value(self, raw: Any) -> str:
        if raw is None:
            return self.default
        # Convert date to formatted string
        if hasattr(raw, "strftime"):
            return raw.strftime("%a, %d %b %Y")
        return str(raw)


@dataclass
class DateTimeField(ExportField):
    """Export field for datetime values with automatic conversion."""

    default: str = ""

    def _format_value(self, raw: Any) -> str:
        if raw is None:
            return self.default
        # Convert datetime to formatted string
        if hasattr(raw, "strftime"):
            return raw.strftime("%a, %d %b %Y %I:%M:%S %Z%z")
        return str(raw)


@dataclass
class NumberField(ExportField):
    """Export field for numeric values."""

    default: Any = ""

    def _format_value(self, raw: Any) -> Any:
        if raw is None:
            return self.default
        return raw


@dataclass
class BooleanField(ExportField):
    """Export field for boolean values."""

    default: bool = False

    def _format_value(self, raw: Any) -> bool:
        if raw is None:
            return self.default
        return bool(raw)


@dataclass
class ListField(ExportField):
    """Export field for list/array values.

    Returns the list as-is by default. The formatter will handle conversion to strings
    when needed (e.g., CSV/XLSX will join with separator, JSON will keep as array).
    """

    default: Optional[List] = field(default_factory=list)

    def _format_value(self, raw: Any) -> List[Any]:
        if raw is None:
            return self.default if self.default is not None else []
        if isinstance(raw, (list, tuple)):
            return list(raw)
        return [raw]  # Wrap single items in a list


@dataclass
class JSONField(ExportField):
    """Export field for complex JSON-serializable values (dicts, lists of dicts, etc).

    Preserves the structure as-is for JSON exports. For CSV/XLSX, the formatter
    will handle serialization (e.g., JSON stringify).
    """

    default: Any = field(default_factory=dict)

    def _format_value(self, raw: Any) -> Any:
        if raw is None:
            return self.default
        # Return as-is - should be JSON-serializable
        return raw


class ExportSchemaMeta(type):
    """Capture declared :class:`ExportField` attributes into ``_declared_fields`` in source order.

    The resulting ordered mapping is the introspection surface consumed
    by :class:`plane.utils.exporters.formatters.BaseFormatter` to emit
    column headers and row values in the same order they appear on the
    schema subclass.
    """

    def __new__(mcls, name, bases, attrs):
        """Build the schema class with merged ``_declared_fields``.

        Pops ``ExportField`` attributes from ``attrs``, merges them with
        inherited ``_declared_fields`` from bases, and attaches the
        resulting ordered mapping to the new class.
        """
        declared: Dict[str, ExportField] = {
            key: value for key, value in list(attrs.items()) if isinstance(value, ExportField)
        }
        for key in declared.keys():
            attrs.pop(key)
        cls = super().__new__(mcls, name, bases, attrs)
        base_fields: Dict[str, ExportField] = {}
        for base in bases:
            if hasattr(base, "_declared_fields"):
                base_fields.update(base._declared_fields)
        base_fields.update(declared)
        cls._declared_fields = base_fields
        return cls


class ExportSchema(metaclass=ExportSchemaMeta):
    """Base schema for exporting data in various formats.

    Subclasses should define fields as class attributes and can override:
    - prepare_<field_name> methods for custom field serialization
    - get_context_data() class method to pre-fetch related data for the queryset
    """

    def __init__(self, context: Optional[Dict[str, Any]] = None) -> None:
        """Initialize the schema instance with an optional shared ``context`` mapping; defaults to ``{}``."""
        self.context = context or {}

    def serialize(self, obj: Any, fields: Optional[List[str]] = None) -> Dict[str, Any]:
        """Serialize a single object.

        Args:
            obj: The object to serialize
            fields: Optional list of field names to include. If None, all fields are serialized.

        Returns:
            Dictionary of serialized data
        """
        output: Dict[str, Any] = {}
        # Determine which fields to process
        fields_to_process = fields if fields else list(self._declared_fields.keys())

        for field_name in fields_to_process:
            # Skip if field doesn't exist in schema
            if field_name not in self._declared_fields:
                continue

            export_field = self._declared_fields[field_name]

            # Prefer explicit preparer methods if present
            preparer = getattr(self, f"prepare_{field_name}", None)
            if callable(preparer):
                output[field_name] = preparer(obj)
                continue

            output[field_name] = export_field.get_value(obj, self.context)
        return output

    @classmethod
    def get_context_data(cls, queryset: QuerySet) -> Dict[str, Any]:
        """Get context data for serialization. Override in subclasses to pre-fetch related data.

        Args:
            queryset: QuerySet of objects to be serialized

        Returns:
            Dictionary of context data to be passed to the schema instance
        """
        return {}

    @classmethod
    def serialize_queryset(cls, queryset: QuerySet, fields: List[str] = None) -> List[Dict[str, Any]]:
        """Serialize a queryset of objects to export data.

        Args:
            queryset: QuerySet of objects to serialize
            fields: Optional list of field names to include. Defaults to all fields.

        Returns:
            List of dictionaries containing serialized data
        """
        # Get context data (can be extended by subclasses)
        context = cls.get_context_data(queryset)

        # Serialize each object, passing fields to only process requested fields
        schema = cls(context=context)
        data = []
        for obj in queryset:
            obj_data = schema.serialize(obj, fields=fields)
            data.append(obj_data)

        return data
