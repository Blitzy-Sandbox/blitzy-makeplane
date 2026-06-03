# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Foundation abstract model for Plane's ORM hierarchy.

Defines :class:`BaseModel`, the abstract parent of every concrete model in
``apps/api/plane/db/models``. It contributes the UUID primary key column and
overrides :meth:`save` to attribute writes to the request-scoped user via
``crum.get_current_user`` while preserving manual overrides via the
``created_by_id`` and ``disable_auto_set_user`` keyword arguments. Inherits
audit timestamp and soft-delete behavior from :class:`AuditModel` in
``apps/api/plane/db/mixins.py``.
"""

import uuid

# Django imports
from django.db import models

# Third party imports
from crum import get_current_user

# Module imports
from ..mixins import AuditModel


class BaseModel(AuditModel):
    """Abstract foundation model contributing a UUID primary key and audit-aware save.

    All concrete Plane models extend ``BaseModel`` (directly or via
    :class:`WorkspaceBaseModel` / :class:`ProjectBaseModel`). It supplies the
    ``id`` UUID4 primary key and an audit-aware :meth:`save` that auto-populates
    ``created_by`` on insert and ``updated_by`` on update from the request-scoped
    user, with explicit-override and opt-out escape hatches for non-request code
    paths such as Celery workers and management commands.
    """

    # UUID4 primary key: globally unique across all shards/replicas, URL-safe,
    # and avoids sequential-integer enumeration leaks.
    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True)

    class Meta:
        """Mark this model as abstract so Django will not create a table for it."""

        abstract = True

    def save(self, *args, created_by_id=None, disable_auto_set_user=False, **kwargs):
        """Persist with automatic ``created_by`` / ``updated_by`` attribution.

        The audit-user resolution follows this precedence:

        1. ``disable_auto_set_user=True`` -- skip all audit-user logic. Used by
           data-fixture loaders and migrations where the row's authorship is
           intentionally external.
        2. ``created_by_id`` keyword -- assign this user as the creator. Used by
           Celery tasks that must impersonate a specific user (e.g., webhook
           replay on behalf of an account).
        3. Fallback to ``crum.get_current_user()`` -- reads the current HTTP
           request's authenticated user from thread-local storage. When the
           user is ``None`` or anonymous (e.g., Celery worker context), both
           ``created_by`` and ``updated_by`` are nulled. On insert
           (``self._state.adding``) only ``created_by`` is populated; on
           subsequent saves only ``updated_by`` is updated.
        """
        if not disable_auto_set_user:
            # Check if created_by_id is provided
            if created_by_id:
                self.created_by_id = created_by_id
            else:
                user = get_current_user()

                if user is None or user.is_anonymous:
                    self.created_by = None
                    self.updated_by = None
                else:
                    # Check if the model is being created or updated
                    if self._state.adding:
                        # If creating, set created_by and leave updated_by as None
                        self.created_by = user
                        self.updated_by = None
                    else:
                        # If updating, set updated_by only
                        self.updated_by = user

        super(BaseModel, self).save(*args, **kwargs)

    def __str__(self):
        """Return the UUID primary key as a string for admin/debug rendering."""
        return str(self.id)
