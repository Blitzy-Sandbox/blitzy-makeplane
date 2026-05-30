# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Abstract model mixins shared across the Plane ORM.

Defines audit-timestamp, audit-user, soft-deletion, composite audit, and
field-change-tracking abstract bases. Concrete models compose these mixins to
inherit consistent lifecycle, ownership, and deletion semantics. Soft-delete
cascade is dispatched asynchronously via the ``soft_delete_related_objects``
Celery task on RabbitMQ.
"""

# Type imports
from typing import Any

# Django imports
from django.db import models
from django.utils import timezone

# Module imports
from plane.bgtasks.deletion_task import soft_delete_related_objects


class TimeAuditModel(models.Model):
    """Abstract model adding ``created_at`` and ``updated_at`` audit timestamps.

    Composed into concrete models that need automatic creation/modification
    timestamps. ``created_at`` is populated once via ``auto_now_add``;
    ``updated_at`` refreshes on every save via ``auto_now``.
    """

    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Last Modified At")

    class Meta:
        """Mark :class:`TimeAuditModel` as a non-table abstract base."""

        abstract = True


class UserAuditModel(models.Model):
    """Abstract model adding ``created_by`` and ``updated_by`` user-attribution FKs.

    Composed into concrete models that need ownership/audit attribution. Both FKs
    target ``db.User`` and are set to ``NULL`` if the referenced user is removed
    (``on_delete=SET_NULL``), preserving the audit trail without cascade.
    """

    created_by = models.ForeignKey(
        "db.User",
        on_delete=models.SET_NULL,
        related_name="%(class)s_created_by",
        verbose_name="Created By",
        null=True,
    )
    updated_by = models.ForeignKey(
        "db.User",
        on_delete=models.SET_NULL,
        related_name="%(class)s_updated_by",
        verbose_name="Last Modified By",
        null=True,
    )

    class Meta:
        """Mark :class:`UserAuditModel` as a non-table abstract base."""

        abstract = True


class SoftDeletionQuerySet(models.QuerySet):
    """QuerySet override that turns ``.delete()`` into a soft delete by default.

    Mirrors :class:`SoftDeletionManager` so queryset-level bulk deletions also
    respect the soft-delete semantics used across the Plane ORM.
    """

    def delete(self, soft=True):
        """Soft-delete every matched row, or hard-delete when ``soft=False``.

        When ``soft`` is True, every row's ``deleted_at`` is bulk-set to the current
        UTC timestamp via ``update()`` (no signals fire). When False, falls back to
        the standard Django ``QuerySet.delete()`` which cascades and emits signals.
        """
        if soft:
            return self.update(deleted_at=timezone.now())
        else:
            return super().delete()


class SoftDeletionManager(models.Manager):
    """Default manager that hides soft-deleted rows from ordinary queries.

    Used on every concrete model that inherits :class:`SoftDeleteModel`; the
    unfiltered ``all_objects`` manager remains available for administrative
    queries that need to inspect soft-deleted rows.
    """

    def get_queryset(self):
        """Return a :class:`SoftDeletionQuerySet` filtered to non-soft-deleted rows."""
        return SoftDeletionQuerySet(self.model, using=self._db).filter(deleted_at__isnull=True)


class SoftDeleteModel(models.Model):
    """Abstract model adding soft-delete semantics via a ``deleted_at`` timestamp.

    ``objects`` is the default manager and hides soft-deleted rows; ``all_objects``
    is the unfiltered manager kept for administrative queries. The overridden
    ``delete()`` defaults to soft-delete and asynchronously cascades soft-deletion
    to related rows via the ``soft_delete_related_objects`` Celery task.
    """

    deleted_at = models.DateTimeField(verbose_name="Deleted At", null=True, blank=True)

    objects = SoftDeletionManager()
    all_objects = models.Manager()

    class Meta:
        """Mark :class:`SoftDeleteModel` as a non-table abstract base."""

        abstract = True

    def delete(self, using=None, soft=True, *args, **kwargs):
        """Soft-delete this row, or hard-delete when ``soft=False``.

        Soft delete writes the current UTC timestamp to ``deleted_at``, saves the
        instance, and enqueues :func:`soft_delete_related_objects` (Celery on
        RabbitMQ) to propagate soft-deletion to related records asynchronously.
        Hard delete delegates to Django's standard cascade behavior.
        """
        if soft:
            # Soft delete the current instance
            self.deleted_at = timezone.now()
            self.save(using=using)

            soft_delete_related_objects.delay(self._meta.app_label, self._meta.model_name, self.pk, using=using)

        else:
            # Perform hard delete if soft deletion is not enabled
            return super().delete(using=using, *args, **kwargs)


class AuditModel(TimeAuditModel, UserAuditModel, SoftDeleteModel):
    """Composite abstract model combining time, user, and soft-delete audit behavior.

    Most concrete domain models in Plane inherit from this mixin to get audit
    timestamps, audit-user attribution, and soft-delete semantics in one base.
    """

    class Meta:
        """Mark :class:`AuditModel` as a non-table abstract base."""

        abstract = True


class ChangeTrackerMixin:
    """
    A mixin to track changes in model fields between initialization and save.

    This mixin captures the initial state of model fields when the instance is
    created and provides utilities to detect which fields have changed.

    Usage:
        To track specific fields, define a TRACKED_FIELDS list on your model:

        class MyModel(ChangeTrackerMixin, models.Model):
            TRACKED_FIELDS = ['field1', 'field2', 'field3']
            field1 = models.CharField(max_length=100)
            field2 = models.IntegerField()
            field3 = models.BooleanField()

        If TRACKED_FIELDS is not defined, all non-deferred fields will be tracked.

    Properties:
        changed_fields: A list of field names that have changed since initialization.
        old_values: A dictionary mapping field names to their original values.

    Methods:
        has_changed(field_name): Check if a specific field has changed.

    Notes:
        - Deferred fields (from .defer() or .only()) are automatically excluded
          from tracking to avoid triggering database queries.
        - Field values are captured in __init__, so changes are tracked relative
          to the initial state when the instance was loaded from the database.
    """

    _original_values: dict[str, Any]

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """Initialize the instance and snapshot the initial values of tracked fields."""
        super().__init__(*args, **kwargs)
        self._original_values = {}
        self._track_fields()

    def _track_fields(self) -> None:
        """
        Capture the initial values of fields to track.

        This method stores the current values of fields that should be tracked.
        If TRACKED_FIELDS is defined on the model, only those fields are tracked.
        Otherwise, all non-deferred fields are tracked. Deferred fields are
        automatically excluded to prevent unnecessary database queries.
        """
        deferred_fields = self.get_deferred_fields()
        tracked_fields = getattr(self, "TRACKED_FIELDS", None)
        if tracked_fields:
            for field in tracked_fields:
                if field not in deferred_fields:
                    self._original_values[field] = getattr(self, field)
        else:
            for field in self._meta.fields:
                if field.attname not in deferred_fields:
                    self._original_values[field.attname] = getattr(self, field.attname)

    def has_changed(self, field_name: str) -> bool:
        """
        Check if a specific field has changed since initialization.

        Args:
            field_name (str): The name of the field to check.

        Returns:
            bool: True if the field has changed, False otherwise. Returns False
                  if the field was not being tracked or is deferred.
        """
        if field_name not in self._original_values:
            return False
        return self._original_values[field_name] != getattr(self, field_name)

    @property
    def changed_fields(self) -> list[str]:
        """
        Get a list of all fields that have changed since initialization.

        Returns:
            list[str]: A list of field names that have different values than
                       when the instance was initialized. Returns an empty list
                       if no fields have changed.
        """
        changed = []
        for field, old_val in self._original_values.items():
            new_val = getattr(self, field)
            if old_val != new_val:
                changed.append(field)
        return changed

    @property
    def old_values(self) -> dict[str, Any]:
        """
        Get a dictionary of the original field values from initialization.

        Returns:
            dict: A dictionary mapping field names to their original values
                  as they were when the instance was initialized. Only includes
                  fields that are being tracked (either via TRACKED_FIELDS or
                  all non-deferred fields).
        """
        return self._original_values

    def save(self, *args: Any, **kwargs: Any) -> None:
        """
        Override save to automatically capture changed fields and reset tracking.

        Before saving, the current changed_fields are captured and stored in
        _changes_on_save. After saving, the tracked fields are reset so
        that subsequent saves correctly detect changes relative to the last
        saved state, not the original load-time state.

        Models that need to access the changed fields after save (e.g., for
        syncing related models) can use self._changes_on_save.
        """
        self._changes_on_save = self.changed_fields
        super().save(*args, **kwargs)
        self._reset_tracked_fields()

    def _reset_tracked_fields(self) -> None:
        """
        Reset the tracked field values to the current state.

        This is called automatically after save() to ensure that subsequent
        saves correctly detect changes relative to the last saved state,
        rather than the original load-time state.
        """
        self._original_values = {}
        self._track_fields()
