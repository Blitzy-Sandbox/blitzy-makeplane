# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Custom Django database-backed session backend.

This module overrides Django's default session model and session store so that
authoritative session state -- including the authenticated ``user_id`` and a
device-info payload -- is persisted in the PostgreSQL ``sessions`` table rather
than in Django's bundled session table. Redis is used elsewhere as a cache; it
is NOT the authoritative session backend.
"""

# Python imports
import string

# Django imports
from django.contrib.sessions.backends.db import SessionStore as DBSessionStore
from django.contrib.sessions.base_session import AbstractBaseSession
from django.db import models
from django.utils.crypto import get_random_string

VALID_KEY_CHARS = string.ascii_lowercase + string.digits


class Session(AbstractBaseSession):
    """Authoritative database-backed Django session model for Plane.

    Extends :class:`django.contrib.sessions.base_session.AbstractBaseSession`
    so the session backend lives in the ``sessions`` PostgreSQL table; carries
    ``user_id`` for fast lookups and ``device_info`` mirrored from the device
    session payload for device-aware logout flows.
    """

    device_info = models.JSONField(null=True, blank=True, default=None)
    session_key = models.CharField(max_length=128, primary_key=True)
    user_id = models.CharField(null=True, max_length=50, db_index=True)

    @classmethod
    def get_session_store_class(cls):
        """Return the :class:`SessionStore` subclass that drives this model."""
        return SessionStore

    class Meta(AbstractBaseSession.Meta):
        """Persist session rows in the project-specific ``sessions`` table."""

        db_table = "sessions"


class SessionStore(DBSessionStore):
    """Custom session store that returns the project's :class:`Session` model.

    Overrides session-key generation to use a constrained character set
    (:data:`VALID_KEY_CHARS`) and intercepts model instance creation to copy
    ``_auth_user_id`` and ``device_info`` into the persisted row at write time.
    """

    @classmethod
    def get_model_class(cls):
        """Return the :class:`Session` model backing this store."""
        return Session

    def _get_new_session_key(self):
        """Return a new session key that is not present in the current backend.

        Overridden so generated keys draw from :data:`VALID_KEY_CHARS` rather
        than Django's default alphabet.
        """
        while True:
            session_key = get_random_string(128, VALID_KEY_CHARS)
            if not self.exists(session_key):
                return session_key

    def create_model_instance(self, data):
        """Augment the persisted session row with ``_auth_user_id`` and ``device_info`` from the session payload."""
        obj = super().create_model_instance(data)
        try:
            user_id = data.get("_auth_user_id")
        except (ValueError, TypeError):
            user_id = None
        obj.user_id = user_id

        # Save the device info
        device_info = data.get("device_info")
        obj.device_info = device_info if isinstance(device_info, dict) else None
        return obj
