# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for personal API tokens and their activity logs.

These serializers back the token-management endpoints under
:mod:`plane.app.views.api`. The secret :attr:`APIToken.token` value is
generated server-side by :func:`plane.db.models.api.generate_token` and is
never round-tripped through these serializers: it is enumerated in
``read_only_fields`` on the write serializer and explicitly removed via
``Meta.exclude`` on the read serializer, so the bearer credential can be
issued exactly once at creation time and never re-disclosed afterwards.

Cross-references:
    * Models: :class:`plane.db.models.APIToken`,
      :class:`plane.db.models.APIActivityLog`
      (``apps/api/plane/db/models/api.py``).
"""

from .base import BaseSerializer
from plane.db.models import APIToken, APIActivityLog
from rest_framework import serializers
from django.utils import timezone


class APITokenSerializer(BaseSerializer):
    """Write/read serializer for :class:`APIToken` records used by the token-management endpoints.

    Every token-identifying or server-managed field --- ``token``,
    ``expired_at``, ``created_at``, ``updated_at``, ``workspace``, ``user``,
    ``is_active``, ``last_used``, and ``user_type`` --- is marked read-only
    because tokens are minted server-side at creation and cannot be edited
    in place; clients revoke and re-mint rather than mutate. Only
    descriptive fields (``label``, ``description``) and revocation-adjacent
    controls left out of ``read_only_fields`` accept writes via this
    serializer.
    """

    class Meta:
        """Bind the serializer to :class:`APIToken` with all token-identifying fields kept read-only."""

        model = APIToken
        fields = "__all__"
        read_only_fields = [
            "token",
            "expired_at",
            "created_at",
            "updated_at",
            "workspace",
            "user",
            "is_active",
            "last_used",
            "user_type",
        ]


class APITokenReadSerializer(BaseSerializer):
    """Read-only :class:`APIToken` serializer that omits the secret token and exposes a computed ``is_active`` flag.

    The ``token`` column is intentionally listed in ``Meta.exclude`` --- the
    bearer credential is shown to the caller exactly once at mint time
    (via :class:`APITokenSerializer`) and is never returned by any
    listing/detail endpoint that uses this serializer. The ``is_active``
    flag exposed here is *not* read from a model column; it is computed
    by :meth:`get_is_active` from ``expired_at`` so the API surfaces the
    effective active state even when an explicit expiry has elapsed.
    """

    is_active = serializers.SerializerMethodField()

    class Meta:
        """Bind the serializer to :class:`APIToken` with the bearer ``token`` column excluded from the wire."""

        model = APIToken
        exclude = ("token",)

    def get_is_active(self, obj: APIToken) -> bool:
        """Return ``True`` if the token has no expiration or its expiration is in the future."""
        if obj.expired_at is None:
            return True
        return timezone.now() < obj.expired_at


class APIActivityLogSerializer(BaseSerializer):
    """Serializer for :class:`APIActivityLog` rows recording every API token usage event (read-only audit log).

    The underlying model is populated by the API logging middleware in
    :mod:`plane.middleware` on every authenticated external API call;
    callers use this serializer to read the audit trail (request path,
    method, headers, body, response code, IP, user agent), never to write
    to it.
    """

    class Meta:
        """Bind the serializer to :class:`APIActivityLog` and expose every column for audit-trail consumption."""

        model = APIActivityLog
        fields = "__all__"
