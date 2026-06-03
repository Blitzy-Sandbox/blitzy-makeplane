# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Compact ``User`` projection for the ``plane.space`` public API.

Defines :class:`UserLiteSerializer`, a narrow ``User`` payload exposing only
the identity and display fields safe for anonymous traffic on published
deploy boards (``api/public/``): id, first/last/display name, avatar, and
the ``is_bot`` flag. Email, password, OAuth tokens, role, and other
sensitive user state are deliberately excluded.

Re-exported from the :mod:`plane.space.serializer` package barrel so external
callers can import it from the package namespace.
"""

# Module imports
from .base import BaseSerializer
from plane.db.models import User


class UserLiteSerializer(BaseSerializer):
    """Narrow ``User`` projection safe for anonymous public traffic.

    Serializes :class:`plane.db.models.User` with a deliberately minimal
    field surface for embedding inside issue, comment, reaction, and intake
    payloads served by the ``plane.space`` public deploy-board API mounted
    under ``api/public/``.

    Read-only fields:
        ``id``, ``is_bot`` -- the auto-assigned primary key and the
        system-managed bot flag must never be settable from a request.

    Fields exposed:
        * ``id`` -- stable key for client-side actor de-duplication and
          React list keying.
        * ``first_name`` / ``last_name`` / ``display_name`` -- copy used in
          actor mentions and assignee/commenter labels.
        * ``avatar`` -- legacy plain-text URL field on the ``User`` model;
          retained for backward compatibility with older clients.
        * ``avatar_url`` -- derived property (FileAsset URL preferred,
          legacy ``avatar`` fallback); the preferred field for new code.
        * ``is_bot`` -- UI affordance for badging non-human actors such as
          webhook bots or automation accounts.

    Fields deliberately NOT exposed (security boundary):
        Email, password hash, OAuth tokens, role assignments, last-login
        timestamps, and every other ``User`` attribute are private auth/PII
        state and must never leak through the unauthenticated
        ``api/public/`` surface.

    Consumers:
        Re-exported from :mod:`plane.space.serializer` and embedded as
        ``actor_detail``, ``assignee_details``, and ``created_by_detail``
        nested serializers across :mod:`plane.space.serializer.issue` and
        :mod:`plane.space.serializer.intake`.
    """

    class Meta:
        """DRF :class:`ModelSerializer` configuration binding the lite ``User`` projection."""

        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "avatar",
            "avatar_url",
            "is_bot",
            "display_name",
        ]
        read_only_fields = ["id", "is_bot"]
