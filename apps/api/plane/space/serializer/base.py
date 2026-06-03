# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Foundational base serializers for the ``plane.space.serializer`` package.

Every serializer in :mod:`plane.space.serializer` inherits (directly or
transitively) from :class:`BaseSerializer`, which adds a read-only ``id``
``PrimaryKeyRelatedField`` so the model primary key is always exposed in
response payloads but never settable from a request.
:class:`DynamicBaseSerializer` extends that base with a ``fields=``
constructor kwarg, allowing callers to ask for a selective projection of
the declared fields without subclassing.

These classes are consumed entirely within the public read surface mounted
under ``api/public/`` on published deploy boards.
"""

from rest_framework import serializers


class BaseSerializer(serializers.ModelSerializer):
    """Shared ``ModelSerializer`` base for the ``plane.space.serializer`` package.

    Declares a single read-only ``id`` ``PrimaryKeyRelatedField`` on every
    subclass so the model primary key is always exposed in responses but
    never settable from a request. Every other serializer in this folder
    inherits from this class (directly or transitively via
    :class:`DynamicBaseSerializer`).
    """

    id = serializers.PrimaryKeyRelatedField(read_only=True)


class DynamicBaseSerializer(BaseSerializer):
    """``BaseSerializer`` extension supporting selective field projection.

    Accepts an optional ``fields=`` constructor kwarg containing either:

    * a list of strings naming the top-level fields to include, or
    * a list of dicts mapping a nested serializer field to a sub-projection
      (recursively filtered).

    Any declared field NOT listed in ``fields`` is removed from the
    serializer instance, so callers can request ad-hoc subset payloads
    without declaring additional ``*LiteSerializer`` subclasses. When
    ``fields`` is ``None`` (the default) the serializer is identical to
    :class:`BaseSerializer`.
    """

    def __init__(self, *args, **kwargs):
        """Initialize the serializer and apply the optional ``fields`` projection.

        Pops ``fields`` from ``kwargs`` before delegating to the parent
        ``__init__`` so the parent ``ModelSerializer.__init__`` does not see
        the custom kwarg (it would otherwise raise ``TypeError``), then
        prunes ``self.fields`` to the requested projection via
        :meth:`_filter_fields` when ``fields`` was provided.
        """
        # If 'fields' is provided in the arguments, remove it and store it separately.
        # This is done so as not to pass this custom argument up to the superclass.
        fields = kwargs.pop("fields", None)

        # Call the initialization of the superclass.
        super().__init__(*args, **kwargs)

        # If 'fields' was provided, filter the fields of the serializer accordingly.
        if fields is not None:
            self.fields = self._filter_fields(fields)

    def _filter_fields(self, fields):
        """
        Adjust the serializer's fields based on the provided 'fields' list.

        :param fields: List or dictionary specifying which fields to include in the serializer.
        :return: The updated fields for the serializer.
        """
        # Check each field_name in the provided fields.
        for field_name in fields:
            # If the field is a dictionary (indicating nested fields),
            # loop through its keys and values.
            if isinstance(field_name, dict):
                for key, value in field_name.items():
                    # If the value of this nested field is a list,
                    # perform a recursive filter on it.
                    if isinstance(value, list):
                        self._filter_fields(self.fields[key], value)

        # Create a list to store allowed fields.
        allowed = []
        for item in fields:
            # If the item is a string, it directly represents a field's name.
            if isinstance(item, str):
                allowed.append(item)
            # If the item is a dictionary, it represents a nested field.
            # Add the key of this dictionary to the allowed list.
            elif isinstance(item, dict):
                allowed.append(list(item.keys())[0])

        # Convert the current serializer's fields and the allowed fields to sets.
        existing = set(self.fields)
        allowed = set(allowed)

        # Remove fields from the serializer that aren't in the 'allowed' list.
        for field_name in existing - allowed:
            self.fields.pop(field_name)

        return self.fields
