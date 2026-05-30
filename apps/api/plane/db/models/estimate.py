# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for project-level issue-effort estimation scales.

Defines :class:`EstimateType` (the kind of scale — categorical labels vs. point
values), :class:`Estimate` (a named per-project scale), and
:class:`EstimatePoint` (an individual graduation on a scale referenced from
:class:`Issue.estimate_point`).
"""

# Django imports
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q

# Module imports
from .project import ProjectBaseModel

class EstimateType(models.TextChoices):
    """Discriminator of how an :class:`Estimate` scale renders — categorical or numeric."""

    CATEGORIES = "categories", "Categories"
    POINTS = "points", "Points"


class Estimate(ProjectBaseModel):
    """Named per-project effort-estimation scale (e.g., T-shirt sizes, Fibonacci)."""

    name = models.CharField(max_length=255)
    description = models.TextField(verbose_name="Estimate Description", blank=True)
    # Valid: EstimateType values — "categories" | "points".
    type = models.CharField(max_length=255, choices=EstimateType.choices, default=EstimateType.CATEGORIES)
    last_used = models.BooleanField(default=False)

    def __str__(self):
        """Return ``"<name> <<project name>>"`` for admin/log display."""
        return f"{self.name} <{self.project.name}>"

    class Meta:
        """Enforces ``(name, project)`` uniqueness among non-soft-deleted rows."""

        unique_together = ["name", "project", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["name", "project"],
                condition=Q(deleted_at__isnull=True),
                name="estimate_unique_name_project_when_deleted_at_null",
            )
        ]
        verbose_name = "Estimate"
        verbose_name_plural = "Estimates"
        db_table = "estimates"
        ordering = ("name",)


class EstimatePoint(ProjectBaseModel):
    """A single graduation on an :class:`Estimate` scale.

    ``key`` is the ordinal position (0-based) used for sorting; ``value`` is the
    rendered label shown in the UI (e.g., "XS", "1", "Sprint-1").
    """

    estimate = models.ForeignKey("db.Estimate", on_delete=models.CASCADE, related_name="points")
    key = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    description = models.TextField(blank=True)
    value = models.CharField(max_length=255)

    def __str__(self):
        """Return ``"<estimate name> <key> <value>"`` for admin/log display."""
        return f"{self.estimate.name} <{self.key}> <{self.value}>"

    class Meta:
        """Orders points by ``value`` for consistent picker rendering."""

        verbose_name = "Estimate Point"
        verbose_name_plural = "Estimate Points"
        db_table = "estimate_points"
        ordering = ("value",)
