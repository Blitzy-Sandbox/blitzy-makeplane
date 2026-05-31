# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Sticky-note serializer for the ``/api/v1/`` API surface.

Used by :mod:`plane.api.views.sticky`. The single :class:`StickySerializer`
guards both rich-text payloads (``description_html``) and the binary CRDT
payload (``description_binary``) through
:mod:`plane.utils.content_validator` so that malformed or unsafe content
never reaches storage.
"""

from rest_framework import serializers

from .base import BaseSerializer
from plane.db.models import Sticky
from plane.utils.content_validator import validate_html_content, validate_binary_data


class StickySerializer(BaseSerializer):
    """Read/write representation of a ``Sticky`` user note for the ``/api/v1/`` API.

    Inherits dynamic ``?fields=`` and ``?expand=`` from
    :class:`BaseSerializer`. ``workspace`` and ``owner`` are read-only (set by
    the ViewSet during create), and ``name`` is optional via
    ``extra_kwargs``. ``description_html`` and ``description_binary`` are
    sanitised in :meth:`validate`.
    """

    class Meta:
        """DRF metadata: serialize ``Sticky`` with all fields; ``workspace`` / ``owner`` are read-only."""

        model = Sticky
        fields = "__all__"
        read_only_fields = ["workspace", "owner"]
        extra_kwargs = {"name": {"required": False}}

    def validate(self, data):
        """Sanitise ``description_html`` and validate ``description_binary`` before persistence.

        Runs :func:`plane.utils.content_validator.validate_html_content` against
        the HTML payload (rejecting unsafe markup, substituting sanitized HTML)
        and :func:`plane.utils.content_validator.validate_binary_data` against
        the binary CRDT payload.
        """
        # Validate description content for security
        if "description_html" in data and data["description_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(data["description_html"])
            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})
            # Update the data with sanitized HTML if available
            if sanitized_html is not None:
                data["description_html"] = sanitized_html

        if "description_binary" in data and data["description_binary"]:
            is_valid, error_msg = validate_binary_data(data["description_binary"])
            if not is_valid:
                raise serializers.ValidationError({"description_binary": "Invalid binary data"})

        return data
