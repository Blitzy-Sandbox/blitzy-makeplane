# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database model and managers for project-scoped issue workflow states.

Defines :class:`StateGroup` (the canonical 6-bucket workflow taxonomy:
backlog / unstarted / started / completed / cancelled / triage), the
``DEFAULT_STATES`` seed list used at project bootstrap, and :class:`State`
itself with three managers — :data:`State.objects` excludes triage,
:data:`State.all_state_objects` includes every state, and
:data:`State.triage_objects` returns triage only.
"""

# Django imports
from django.db import models
from django.template.defaultfilters import slugify
from django.db.models import Q

# Module imports
from .project import ProjectBaseModel
from plane.db.mixins import SoftDeletionManager

class StateGroup(models.TextChoices):
    """Canonical 6-bucket issue workflow taxonomy used to group :class:`State` rows.

    The first five (backlog, unstarted, started, completed, cancelled) form the
    project's visible workflow ladder; ``triage`` is reserved for the
    project's intake/triage flow and is filtered out of the default
    :class:`StateManager`.
    """

    BACKLOG = "backlog", "Backlog"
    UNSTARTED = "unstarted", "Unstarted"
    STARTED = "started", "Started"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"
    TRIAGE = "triage", "Triage"


# Default states
DEFAULT_STATES = [
    {
        "name": "Backlog",
        "color": "#60646C",
        "sequence": 15000,
        "group": StateGroup.BACKLOG.value,
        "default": True,
    },
    {
        "name": "Todo",
        "color": "#60646C",
        "sequence": 25000,
        "group": StateGroup.UNSTARTED.value,
    },
    {
        "name": "In Progress",
        "color": "#F59E0B",
        "sequence": 35000,
        "group": StateGroup.STARTED.value,
    },
    {
        "name": "Done",
        "color": "#46A758",
        "sequence": 45000,
        "group": StateGroup.COMPLETED.value,
    },
    {
        "name": "Cancelled",
        "color": "#9AA4BC",
        "sequence": 55000,
        "group": StateGroup.CANCELLED.value,
    },
    {
        "name": "Triage",
        "color": "#4E5355",
        "sequence": 65000,
        "group": StateGroup.TRIAGE.value,
    },
]


class StateManager(SoftDeletionManager):
    """Soft-delete-aware manager that excludes triage states from the default queryset."""

    def get_queryset(self):
        """Return all soft-delete-active states excluding the ``triage`` group."""
        return super().get_queryset().exclude(group=StateGroup.TRIAGE.value)


class TriageStateManager(SoftDeletionManager):
    """Soft-delete-aware manager that returns only triage states."""

    def get_queryset(self):
        """Return only soft-delete-active states in the ``triage`` group."""
        return super().get_queryset().filter(group=StateGroup.TRIAGE.value)


class State(ProjectBaseModel):
    """Workflow state in a project's issue pipeline, classified by :class:`StateGroup`.

    Each project owns its own set of states (seeded from ``DEFAULT_STATES`` at
    project creation); ``sequence`` controls the within-group display order;
    ``default`` flags the state that newly-created issues land in; ``is_triage``
    cross-checks the group=triage classifier and is exposed via
    :data:`State.triage_objects`.
    """

    name = models.CharField(max_length=255, verbose_name="State Name")
    description = models.TextField(verbose_name="State Description", blank=True)
    color = models.CharField(max_length=255, verbose_name="State Color")
    slug = models.SlugField(max_length=100, blank=True)
    sequence = models.FloatField(default=65535)
    # Valid: StateGroup — "backlog" | "unstarted" | "started" | "completed" | "cancelled" | "triage".
    group = models.CharField(
        choices=StateGroup.choices,
        default=StateGroup.BACKLOG,
        max_length=20,
    )
    is_triage = models.BooleanField(default=False)
    default = models.BooleanField(default=False)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    objects = StateManager()
    all_state_objects = models.Manager()
    triage_objects = TriageStateManager()

    def __str__(self):
        """Return name of the state."""
        return f"{self.name} <{self.project.name}>"

    class Meta:
        """Database table layout and uniqueness constraints for :class:`State`."""

        unique_together = ["name", "project", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["name", "project"],
                condition=Q(deleted_at__isnull=True),
                name="state_unique_name_project_when_deleted_at_null",
            )
        ]
        verbose_name = "State"
        verbose_name_plural = "States"
        db_table = "states"
        ordering = ("sequence",)

    def save(self, *args, **kwargs):
        """Slugify ``name`` and allocate the next per-project ``sequence`` slot on insert.

        On insert, ``sequence`` is set to ``max(existing) + 15000`` so the new
        state sorts after the project's existing states; ``slug`` is derived
        from ``name`` on every save (insert and update).
        """
        self.slug = slugify(self.name)
        if self._state.adding:
            # Get the maximum sequence value from the database
            last_id = State.objects.filter(project=self.project).aggregate(largest=models.Max("sequence"))["largest"]
            # if last_id is not None
            if last_id is not None:
                self.sequence = last_id + 15000

        return super().save(*args, **kwargs)
