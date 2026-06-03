# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for the project-level intake triage queue.

Defines :class:`Intake` (the triage queue itself), the
:class:`IntakeIssueStatus` and :class:`SourceType` enums that bound triage
state and submission origin, and :class:`IntakeIssue` (the per-issue triage
record linking a submitted :class:`Issue` to its parent :class:`Intake`).
"""

# Django imports
from django.db import models

# Module imports
from plane.db.models.project import ProjectBaseModel


class Intake(ProjectBaseModel):
    """Per-project triage queue used to vet incoming issue submissions."""

    name = models.CharField(max_length=255)
    description = models.TextField(verbose_name="Intake Description", blank=True)
    is_default = models.BooleanField(default=False)
    # INTENT UNCLEAR: view-display props consumed by the intake UI; shape varies per surface.
    view_props = models.JSONField(default=dict)
    # INTENT UNCLEAR: logo/icon metadata consumed by the intake UI; shape varies per surface.
    logo_props = models.JSONField(default=dict)

    def __str__(self):
        """Return name of the intake."""
        return f"{self.name} <{self.project.name}>"

    class Meta:
        """Django model metadata for ``Intake``."""

        unique_together = ["name", "project", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["name", "project"],
                condition=models.Q(deleted_at__isnull=True),
                name="intake_unique_name_project_when_deleted_at_null",
            )
        ]
        verbose_name = "Intake"
        verbose_name_plural = "Intakes"
        db_table = "intakes"
        ordering = ("name",)


class SourceType(models.TextChoices):
    """Closed set of submission origins for an intake issue."""

    IN_APP = "IN_APP"


class IntakeIssueStatus(models.IntegerChoices):
    """Triage outcomes for an :class:`IntakeIssue` (integer-valued for legacy compatibility)."""

    PENDING = -2
    REJECTED = -1
    SNOOZED = 0
    ACCEPTED = 1
    DUPLICATE = 2


class IntakeIssue(ProjectBaseModel):
    """Per-issue triage record linking an :class:`Issue` to its parent :class:`Intake`.

    Carries the triage outcome (``status``), the snooze window (``snoozed_till``),
    the canonical original when marked as a duplicate (``duplicate_to``), and
    the inbound source metadata (``source``, ``source_email``, ``extra``).
    """

    intake = models.ForeignKey("db.Intake", related_name="issue_intake", on_delete=models.CASCADE)
    issue = models.ForeignKey("db.Issue", related_name="issue_intake", on_delete=models.CASCADE)
    # Valid: -2 (Pending) | -1 (Rejected) | 0 (Snoozed) | 1 (Accepted) | 2 (Duplicate); see IntakeIssueStatus.
    status = models.IntegerField(
        choices=(
            (-2, "Pending"),
            (-1, "Rejected"),
            (0, "Snoozed"),
            (1, "Accepted"),
            (2, "Duplicate"),
        ),
        default=-2,
    )
    snoozed_till = models.DateTimeField(null=True)
    duplicate_to = models.ForeignKey(
        "db.Issue",
        related_name="intake_duplicate",
        on_delete=models.SET_NULL,
        null=True,
    )
    # Valid: SourceType values — currently only "IN_APP".
    source = models.CharField(max_length=255, default="IN_APP", null=True, blank=True)
    source_email = models.TextField(blank=True, null=True)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)
    # INTENT UNCLEAR: provider-specific auxiliary payload preserved across triage; shape varies by source.
    extra = models.JSONField(default=dict)

    class Meta:
        """Django model metadata for ``IntakeIssue``."""

        verbose_name = "IntakeIssue"
        verbose_name_plural = "IntakeIssues"
        db_table = "intake_issues"
        ordering = ("-created_at",)

    def __str__(self):
        """Return name of the Issue."""
        return f"{self.issue.name} <{self.intake.name}>"
