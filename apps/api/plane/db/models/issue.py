# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for the issue domain: the core work-item, its joins, history, and versions.

This module owns the central :class:`Issue` ORM model plus every join table
(assignees / labels / links / subscribers / mentions / reactions / votes /
blockers / relations), the audit log (:class:`IssueActivity`), the per-issue
comment thread (:class:`IssueComment` — which mirrors its content into a
paired :class:`Description` for the rich-text editor), the per-project
monotonic sequence counter (:class:`IssueSequence`), and point-in-time
version snapshots (:class:`IssueVersion`, :class:`IssueDescriptionVersion`).

:class:`Issue.save` uses a PostgreSQL transaction-level advisory lock
(``pg_advisory_xact_lock``) keyed on the project UUID to serialise
:attr:`Issue.sequence_id` allocation across concurrent creates.
"""

# Python import
from uuid import uuid4

# Django imports
from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models, transaction, connection
from django.utils import timezone
from django.db.models import Q
from django import apps

# Module imports
from plane.utils.html_processor import strip_tags
from plane.utils.path_validator import sanitize_filename
from plane.db.mixins import SoftDeletionManager, ChangeTrackerMixin
from plane.utils.exception_logger import log_exception
from .project import ProjectBaseModel
from plane.utils.uuid import convert_uuid_to_integer
from .description import Description
from .state import StateGroup


def get_default_properties():
    """Return the default per-user issue display-column toggle dict (every column enabled)."""
    return {
        "assignee": True,
        "start_date": True,
        "due_date": True,
        "labels": True,
        "key": True,
        "priority": True,
        "state": True,
        "sub_issue_count": True,
        "link": True,
        "attachment_count": True,
        "estimate": True,
        "created_on": True,
        "updated_on": True,
    }


def get_default_filters():
    """Return the default issue-filter dict shape (all facets unset)."""
    return {
        "priority": None,
        "state": None,
        "state_group": None,
        "assignees": None,
        "created_by": None,
        "labels": None,
        "start_date": None,
        "target_date": None,
        "subscriber": None,
    }


def get_default_display_filters():
    """Return the default issue display-filter dict (list layout, newest-first ordering)."""
    return {
        "group_by": None,
        "order_by": "-created_at",
        "type": None,
        "sub_issue": True,
        "show_empty_groups": True,
        "layout": "list",
        "calendar_date_range": "",
    }


def get_default_display_properties():
    """Return the default issue display-property dict (every issue column enabled)."""
    return {
        "assignee": True,
        "attachment_count": True,
        "created_on": True,
        "due_date": True,
        "estimate": True,
        "key": True,
        "labels": True,
        "link": True,
        "priority": True,
        "start_date": True,
        "state": True,
        "sub_issue_count": True,
        "updated_on": True,
    }


# TODO: Handle identifiers for Bulk Inserts - nk
class IssueManager(SoftDeletionManager):
    """Soft-delete-aware manager that excludes triage, archived, and draft issues from the default queryset.

    The default :data:`Issue.issue_objects` queryset filters out:

    - states in :data:`StateGroup.TRIAGE`,
    - archived issues (``archived_at__isnull=False``),
    - issues in archived projects (``project__archived_at__isnull=False``), and
    - issues marked ``is_draft=True``.
    """

    def get_queryset(self):
        """Return live issues only — excluding triage states, archived issues, archived projects, and drafts."""
        return (
            super()
            .get_queryset()
            .exclude(state__group=StateGroup.TRIAGE.value)
            .exclude(archived_at__isnull=False)
            .exclude(project__archived_at__isnull=False)
            .exclude(is_draft=True)
        )


class Issue(ChangeTrackerMixin, ProjectBaseModel):
    """Central work-item tracked by Plane within a project.

    Composes :class:`ChangeTrackerMixin` (to capture ``state_id`` transitions
    in :meth:`save`) with :class:`ProjectBaseModel`. ``sequence_id`` is a
    monotonic per-project counter allocated under a PostgreSQL advisory lock
    in :meth:`save`; ``parent`` enables sub-issue hierarchies; the four
    description columns (``binary``, ``html``, ``stripped``, ``json``) follow
    the standard rich-text tri-state pattern with Y.js binary as the
    real-time authority (see :class:`Description`).
    """

    TRACKED_FIELDS = ["state_id"]

    PRIORITY_CHOICES = (
        ("urgent", "Urgent"),
        ("high", "High"),
        ("medium", "Medium"),
        ("low", "Low"),
        ("none", "None"),
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="parent_issue",
    )
    state = models.ForeignKey(
        "db.State",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="state_issue",
    )
    point = models.IntegerField(validators=[MinValueValidator(0), MaxValueValidator(12)], null=True, blank=True)
    estimate_point = models.ForeignKey(
        "db.EstimatePoint",
        on_delete=models.SET_NULL,
        related_name="issue_estimates",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=255, verbose_name="Issue Name")
    # Shape: ProseMirror JSON document tree (TipTap-compatible) for editor hydration.
    description_json = models.JSONField(blank=True, default=dict)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_stripped = models.TextField(blank=True, null=True)
    description_binary = models.BinaryField(null=True)
    # Valid: PRIORITY_CHOICES — "urgent" | "high" | "medium" | "low" | "none".
    priority = models.CharField(
        max_length=30,
        choices=PRIORITY_CHOICES,
        verbose_name="Issue Priority",
        default="none",
    )
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    assignees = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="assignee",
        through="IssueAssignee",
        through_fields=("issue", "assignee"),
    )
    sequence_id = models.IntegerField(default=1, verbose_name="Issue Sequence ID")
    labels = models.ManyToManyField("db.Label", blank=True, related_name="labels", through="IssueLabel")
    sort_order = models.FloatField(default=65535)
    completed_at = models.DateTimeField(null=True)
    archived_at = models.DateField(null=True)
    is_draft = models.BooleanField(default=False)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)
    type = models.ForeignKey(
        "db.IssueType",
        on_delete=models.SET_NULL,
        related_name="issue_type",
        null=True,
        blank=True,
    )

    issue_objects = IssueManager()

    class Meta:
        """Django model metadata for :class:`Issue` (table ``issues``, newest-first ordering)."""

        verbose_name = "Issue"
        verbose_name_plural = "Issues"
        db_table = "issues"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        """Allocate ``sequence_id`` under an advisory lock, sync ``completed_at``, and recompute stripped body.

        On insert, acquires a PostgreSQL transaction-level advisory lock
        keyed on the project UUID (``pg_advisory_xact_lock``) so concurrent
        creates cannot collide on :attr:`sequence_id`; then allocates
        ``sequence_id = max(IssueSequence.sequence) + 1`` and
        ``sort_order = max + 10000``, recomputes
        ``description_stripped``, persists the row, and inserts the
        matching :class:`IssueSequence` checkpoint. On update, only recomputes
        ``description_stripped`` (state-change syncing of ``completed_at``
        already happened via :meth:`_sync_completed_at`).
        """
        self._ensure_default_state()
        kwargs = self._sync_completed_at(kwargs)

        if self._state.adding:
            with transaction.atomic():
                # Create a lock for this specific project using a transaction-level advisory lock
                # This ensures only one transaction per project can execute this code at a time
                # The lock is automatically released when the transaction ends
                lock_key = convert_uuid_to_integer(self.project.id)

                with connection.cursor() as cursor:
                    # Get an exclusive transaction-level lock using the project ID as the lock key
                    cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_key])

                # Get the last sequence for the project
                last_sequence = IssueSequence.objects.filter(project=self.project).aggregate(
                    largest=models.Max("sequence")
                )["largest"]
                self.sequence_id = last_sequence + 1 if last_sequence else 1
                # Strip the html tags using html parser
                self.description_stripped = (
                    None
                    if (self.description_html == "" or self.description_html is None)
                    else strip_tags(self.description_html)
                )
                largest_sort_order = Issue.objects.filter(project=self.project, state=self.state).aggregate(
                    largest=models.Max("sort_order")
                )["largest"]
                if largest_sort_order is not None:
                    self.sort_order = largest_sort_order + 10000

                super(Issue, self).save(*args, **kwargs)

                IssueSequence.objects.create(issue=self, sequence=self.sequence_id, project=self.project)
        else:
            # Strip the html tags using html parser
            self.description_stripped = (
                None
                if (self.description_html == "" or self.description_html is None)
                else strip_tags(self.description_html)
            )
            super(Issue, self).save(*args, **kwargs)

    def __str__(self):
        """Return name of the issue."""
        return f"{self.name} <{self.project.name}>"

    def _ensure_default_state(self):
        """Assign a default state when none is set."""
        if self.state is not None:
            return
        try:
            from plane.db.models import State

            default_state = State.objects.filter(~models.Q(is_triage=True), project=self.project, default=True).first()
            self.state = default_state or State.objects.filter(~models.Q(is_triage=True), project=self.project).first()
        except ImportError as e:
            log_exception(e)

    def _sync_completed_at(self, kwargs):
        """Update completed_at when state changes. Returns kwargs."""
        if not self.state:
            return kwargs
        if not self._state.adding and not self.has_changed("state_id"):
            return kwargs

        if self.state.group == StateGroup.COMPLETED.value:
            self.completed_at = timezone.now()
        else:
            self.completed_at = None

        update_fields = kwargs.get("update_fields")
        if update_fields is not None:
            kwargs["update_fields"] = list(set(update_fields) | {"completed_at"})
        return kwargs


class IssueBlocker(ProjectBaseModel):
    """Legacy issue-blocker join (largely superseded by :class:`IssueRelation` with ``blocked_by``)."""

    block = models.ForeignKey(Issue, related_name="blocker_issues", on_delete=models.CASCADE)
    blocked_by = models.ForeignKey(Issue, related_name="blocked_issues", on_delete=models.CASCADE)

    class Meta:
        """Django model metadata for :class:`IssueBlocker` (table ``issue_blockers``)."""

        verbose_name = "Issue Blocker"
        verbose_name_plural = "Issue Blockers"
        db_table = "issue_blockers"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the blocker pair (block name + blocked_by name) for admin/debug rendering."""
        return f"{self.block.name} {self.blocked_by.name}"


class IssueRelationChoices(models.TextChoices):
    """Canonical taxonomy of issue-to-issue relationships.

    ``_RELATION_PAIRS`` (assigned after the class to avoid TextChoices
    metaclass conflicts) maps each forward relation to its reverse-display
    label (e.g., ``blocked_by`` ↔ ``blocking``); ``_REVERSE_MAPPING`` is the
    derived forward→reverse dict consumed by serializers when rendering the
    relation from the perspective of the related issue.
    """

    DUPLICATE = "duplicate", "Duplicate"
    RELATES_TO = "relates_to", "Relates To"
    BLOCKED_BY = "blocked_by", "Blocked By"
    START_BEFORE = "start_before", "Start Before"
    FINISH_BEFORE = "finish_before", "Finish Before"
    IMPLEMENTED_BY = "implemented_by", "Implemented By"


# Bidirectional relation pairs: (forward, reverse)
# Defined after class to avoid enum metaclass conflicts
IssueRelationChoices._RELATION_PAIRS = (
    ("blocked_by", "blocking"),
    ("relates_to", "relates_to"),  # symmetric
    ("duplicate", "duplicate"),  # symmetric
    ("start_before", "start_after"),
    ("finish_before", "finish_after"),
    ("implemented_by", "implements"),
)

# Generate reverse mapping from pairs
IssueRelationChoices._REVERSE_MAPPING = {forward: reverse for forward, reverse in IssueRelationChoices._RELATION_PAIRS}


class IssueRelation(ProjectBaseModel):
    """Active issue-to-issue relationship row with a directional ``relation_type``.

    Defaults to ``BLOCKED_BY``. Soft-delete-aware unique constraint on
    ``(issue, related_issue)`` prevents duplicate active rows.
    """

    issue = models.ForeignKey(Issue, related_name="issue_relation", on_delete=models.CASCADE)
    related_issue = models.ForeignKey(Issue, related_name="issue_related", on_delete=models.CASCADE)
    relation_type = models.CharField(
        max_length=20,
        verbose_name="Issue Relation Type",
        default=IssueRelationChoices.BLOCKED_BY,
    )

    class Meta:
        """Django model metadata for :class:`IssueRelation` (table ``issue_relations``)."""

        unique_together = ["issue", "related_issue", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "related_issue"],
                condition=Q(deleted_at__isnull=True),
                name="issue_relation_unique_issue_related_issue_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Relation"
        verbose_name_plural = "Issue Relations"
        db_table = "issue_relations"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the issue name + related issue name for admin/debug rendering."""
        return f"{self.issue.name} {self.related_issue.name}"


class IssueMention(ProjectBaseModel):
    """Many-to-many join recording each user mentioned inside an :class:`Issue` body or comment."""

    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="issue_mention")
    mention = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="issue_mention")

    class Meta:
        """Django model metadata for :class:`IssueMention` (table ``issue_mentions``)."""

        unique_together = ["issue", "mention", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "mention"],
                condition=Q(deleted_at__isnull=True),
                name="issue_mention_unique_issue_mention_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Mention"
        verbose_name_plural = "Issue Mentions"
        db_table = "issue_mentions"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the issue name + mentioned user email for admin/debug rendering."""
        return f"{self.issue.name} {self.mention.email}"


class IssueAssignee(ProjectBaseModel):
    """Many-to-many join binding a user as an assignee of an :class:`Issue`."""

    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="issue_assignee")
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="issue_assignee",
    )

    class Meta:
        """Django model metadata for :class:`IssueAssignee` (table ``issue_assignees``)."""

        unique_together = ["issue", "assignee", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "assignee"],
                condition=Q(deleted_at__isnull=True),
                name="issue_assignee_unique_issue_assignee_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Assignee"
        verbose_name_plural = "Issue Assignees"
        db_table = "issue_assignees"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the issue name + assignee email for admin/debug rendering."""
        return f"{self.issue.name} {self.assignee.email}"


class IssueLink(ProjectBaseModel):
    """External resource link (URL + optional title + metadata) attached to an :class:`Issue`."""

    title = models.CharField(max_length=255, null=True, blank=True)
    url = models.TextField()
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_link")
    # INTENT UNCLEAR: opaque per-link metadata (e.g., favicon, og-image); shape varies per link source.
    metadata = models.JSONField(default=dict)

    class Meta:
        """Django model metadata for :class:`IssueLink` (table ``issue_links``)."""

        verbose_name = "Issue Link"
        verbose_name_plural = "Issue Links"
        db_table = "issue_links"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the issue name + URL for admin/debug rendering."""
        return f"{self.issue.name} {self.url}"


def get_upload_path(instance, filename):
    """Build the storage-backend upload path for an :class:`IssueAttachment` instance.

    Sanitises ``filename`` (falling back to a hex UUID), then prefixes with
    the workspace UUID.
    """
    filename = sanitize_filename(filename) or uuid4().hex
    return f"{instance.workspace.id}/{uuid4().hex}-{filename}"


def file_size(value):
    """Validate that an uploaded file does not exceed ``settings.FILE_SIZE_LIMIT`` (5 MB on cloud).

    Raises:
        django.core.exceptions.ValidationError: if the file exceeds the size cap.
    """
    # File limit check is only for cloud hosted
    if value.size > settings.FILE_SIZE_LIMIT:
        raise ValidationError("File too large. Size should not exceed 5 MB.")


class IssueAttachment(ProjectBaseModel):
    """Legacy per-issue file attachment (predates the polymorphic :class:`FileAsset`).

    Retained for backward compatibility with existing data; new uploads route
    through :class:`FileAsset` with ``entity_type=ISSUE_ATTACHMENT``.
    """

    # INTENT UNCLEAR: per-attachment client-supplied attributes; shape varies per attachment.
    attributes = models.JSONField(default=dict)
    asset = models.FileField(upload_to=get_upload_path, validators=[file_size])
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_attachment")
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        """Django model metadata for :class:`IssueAttachment` (table ``issue_attachments``)."""

        verbose_name = "Issue Attachment"
        verbose_name_plural = "Issue Attachments"
        db_table = "issue_attachments"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the issue name + asset path for admin/debug rendering."""
        return f"{self.issue.name} {self.asset}"


class IssueActivity(ProjectBaseModel):
    """Append-only audit log of one issue field change or comment event.

    ``verb`` describes the action (default ``"created"``); ``field`` /
    ``old_value`` / ``new_value`` record what changed; ``epoch`` is a float
    timestamp consumed by the activity worker for ordered fan-out;
    ``attachments`` is an ArrayField of up to 10 URLs.
    """

    issue = models.ForeignKey(Issue, on_delete=models.DO_NOTHING, null=True, related_name="issue_activity")
    verb = models.CharField(max_length=255, verbose_name="Action", default="created")
    field = models.CharField(max_length=255, verbose_name="Field Name", blank=True, null=True)
    old_value = models.TextField(verbose_name="Old Value", blank=True, null=True)
    new_value = models.TextField(verbose_name="New Value", blank=True, null=True)

    comment = models.TextField(verbose_name="Comment", blank=True)
    attachments = ArrayField(models.URLField(), size=10, blank=True, default=list)
    issue_comment = models.ForeignKey(
        "db.IssueComment",
        on_delete=models.DO_NOTHING,
        related_name="issue_comment",
        null=True,
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="issue_activities",
    )
    old_identifier = models.UUIDField(null=True)
    new_identifier = models.UUIDField(null=True)
    epoch = models.FloatField(null=True)

    class Meta:
        """Django model metadata for :class:`IssueActivity` (table ``issue_activities``)."""

        verbose_name = "Issue Activity"
        verbose_name_plural = "Issue Activities"
        db_table = "issue_activities"
        ordering = ("-created_at",)

    def __str__(self):
        """Return issue of the comment."""
        return str(self.issue)


class IssueComment(ChangeTrackerMixin, ProjectBaseModel):
    """Per-issue threaded comment, mirroring its rich-text body into a paired :class:`Description`.

    Composes :class:`ChangeTrackerMixin` so :meth:`save` can detect which of
    the tracked body columns (``comment_stripped``, ``comment_json``,
    ``comment_html``) changed and write only those into the paired
    :class:`Description` row inside a single atomic transaction.
    ``access`` discriminates ``INTERNAL`` comments from those visible on the
    public deploy board (``EXTERNAL``).
    """

    comment_stripped = models.TextField(verbose_name="Comment", blank=True)
    # Shape: ProseMirror JSON document tree (TipTap-compatible); mirrored into Description.description_json.
    comment_json = models.JSONField(blank=True, default=dict)
    comment_html = models.TextField(blank=True, default="<p></p>")
    description = models.OneToOneField(
        "db.Description", on_delete=models.CASCADE, related_name="issue_comment_description", null=True
    )
    attachments = ArrayField(models.URLField(), size=10, blank=True, default=list)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="issue_comments")
    # System can also create comment
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="comments",
        null=True,
    )
    # Valid: "INTERNAL" (default; team-only) | "EXTERNAL" (visible on public deploy board).
    access = models.CharField(
        choices=(("INTERNAL", "INTERNAL"), ("EXTERNAL", "EXTERNAL")),
        default="INTERNAL",
        max_length=100,
    )
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="parent_issue_comment"
    )

    TRACKED_FIELDS = ["comment_stripped", "comment_json", "comment_html"]

    def save(self, *args, **kwargs):
        """Persist the comment and mirror its body into the paired :class:`Description` row.

        Handles creation and updates of both the comment and its description
        inside a single atomic transaction to ensure data consistency: on
        first save the linked :class:`Description` row is created from the
        comment body; on subsequent saves only the body columns that
        actually changed (per :class:`ChangeTrackerMixin._changes_on_save`)
        are written back to the description.
        """
        self.comment_stripped = strip_tags(self.comment_html) if self.comment_html != "" else ""
        is_creating = self._state.adding

        # Prepare description defaults
        description_defaults = {
            "workspace_id": self.workspace_id,
            "project_id": self.project_id,
            "created_by_id": self.created_by_id,
            "updated_by_id": self.updated_by_id,
            "description_stripped": self.comment_stripped,
            "description_json": self.comment_json,
            "description_html": self.comment_html,
        }

        with transaction.atomic():
            super(IssueComment, self).save(*args, **kwargs)

            if is_creating or not self.description_id:
                # Create new description for new comment
                description = Description.objects.create(**description_defaults)
                self.description_id = description.id
                super(IssueComment, self).save(update_fields=["description_id"])
            else:
                field_mapping = {
                    "comment_html": "description_html",
                    "comment_stripped": "description_stripped",
                    "comment_json": "description_json",
                }

                # Use _changes_on_save which is captured by ChangeTrackerMixin.save()
                # before the tracked fields are reset
                changed_fields = {
                    desc_field: getattr(self, comment_field)
                    for comment_field, desc_field in field_mapping.items()
                    if comment_field in self._changes_on_save
                }

                # Update description only if comment fields changed
                if changed_fields and self.description_id:
                    Description.objects.filter(pk=self.description_id).update(
                        **changed_fields, updated_by_id=self.updated_by_id, updated_at=self.updated_at
                    )

    class Meta:
        """Django model metadata for :class:`IssueComment` (table ``issue_comments``)."""

        verbose_name = "Issue Comment"
        verbose_name_plural = "Issue Comments"
        db_table = "issue_comments"
        ordering = ("-created_at",)

    def __str__(self):
        """Return issue of the comment."""
        return str(self.issue)


class IssueLabel(ProjectBaseModel):
    """Many-to-many join binding a :class:`Label` to an :class:`Issue`."""

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="label_issue")
    label = models.ForeignKey("db.Label", on_delete=models.CASCADE, related_name="label_issue")

    class Meta:
        """Django model metadata for :class:`IssueLabel` (table ``issue_labels``)."""

        verbose_name = "Issue Label"
        verbose_name_plural = "Issue Labels"
        db_table = "issue_labels"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the issue name + label name for admin/debug rendering."""
        return f"{self.issue.name} {self.label.name}"


class IssueSequence(ProjectBaseModel):
    """Per-project monotonic sequence counter row, preserved across issue soft-deletion.

    ``issue`` is nullable so soft-deleted issues do not lose their allocated
    sequence number (the user-facing ``PROJ-123`` identifier survives
    deletion); ``sequence`` is indexed for fast max-aggregate lookups
    during the advisory-locked allocation in :meth:`Issue.save`.
    """

    issue = models.ForeignKey(
        Issue,
        on_delete=models.SET_NULL,
        related_name="issue_sequence",
        null=True,  # This is set to null because we want to keep the sequence even if the issue is deleted
    )
    sequence = models.PositiveBigIntegerField(default=1, db_index=True)
    deleted = models.BooleanField(default=False)

    class Meta:
        """Django model metadata for :class:`IssueSequence` (table ``issue_sequences``)."""

        verbose_name = "Issue Sequence"
        verbose_name_plural = "Issue Sequences"
        db_table = "issue_sequences"
        ordering = ("-created_at",)


class IssueSubscriber(ProjectBaseModel):
    """Many-to-many join binding a user as a subscriber to an :class:`Issue` for notification fan-out."""

    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="issue_subscribers")
    subscriber = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="issue_subscribers",
    )

    class Meta:
        """Django model metadata for :class:`IssueSubscriber` (table ``issue_subscribers``)."""

        unique_together = ["issue", "subscriber", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "subscriber"],
                condition=models.Q(deleted_at__isnull=True),
                name="issue_subscriber_unique_issue_subscriber_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Subscriber"
        verbose_name_plural = "Issue Subscribers"
        db_table = "issue_subscribers"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the issue name + subscriber email for admin/debug rendering."""
        return f"{self.issue.name} {self.subscriber.email}"


class IssueReaction(ProjectBaseModel):
    """Emoji reaction attached by a user to an :class:`Issue`.

    Soft-delete-aware uniqueness on ``(issue, actor, reaction)`` allows each
    user to add one of each reaction emoji per issue.
    """

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="issue_reactions",
    )
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="issue_reactions")
    reaction = models.TextField()

    class Meta:
        """Django model metadata for :class:`IssueReaction` (table ``issue_reactions``)."""

        unique_together = ["issue", "actor", "reaction", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "actor", "reaction"],
                condition=models.Q(deleted_at__isnull=True),
                name="issue_reaction_unique_issue_actor_reaction_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Reaction"
        verbose_name_plural = "Issue Reactions"
        db_table = "issue_reactions"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the issue name + actor email for admin/debug rendering."""
        return f"{self.issue.name} {self.actor.email}"


class CommentReaction(ProjectBaseModel):
    """Emoji reaction attached by a user to an :class:`IssueComment`."""

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="comment_reactions",
    )
    comment = models.ForeignKey(IssueComment, on_delete=models.CASCADE, related_name="comment_reactions")
    reaction = models.TextField()

    class Meta:
        """Django model metadata for :class:`CommentReaction` (table ``comment_reactions``)."""

        unique_together = ["comment", "actor", "reaction", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["comment", "actor", "reaction"],
                condition=models.Q(deleted_at__isnull=True),
                name="comment_reaction_unique_comment_actor_reaction_when_deleted_at_null",
            )
        ]
        verbose_name = "Comment Reaction"
        verbose_name_plural = "Comment Reactions"
        db_table = "comment_reactions"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the comment's issue name + actor email for admin/debug rendering."""
        return f"{self.issue.name} {self.actor.email}"


class IssueVote(ProjectBaseModel):
    """Public-deployment up/down vote attached by a user to an :class:`Issue`."""

    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="votes")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="votes")
    # Valid: -1 = DOWNVOTE | 1 = UPVOTE.
    vote = models.IntegerField(choices=((-1, "DOWNVOTE"), (1, "UPVOTE")), default=1)

    class Meta:
        """Django model metadata for :class:`IssueVote` (table ``issue_votes``)."""

        unique_together = ["issue", "actor", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "actor"],
                condition=models.Q(deleted_at__isnull=True),
                name="issue_vote_unique_issue_actor_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Vote"
        verbose_name_plural = "Issue Votes"
        db_table = "issue_votes"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the issue name + voter email for admin/debug rendering."""
        return f"{self.issue.name} {self.actor.email}"


class IssueVersion(ProjectBaseModel):
    r"""Point-in-time snapshot of an :class:`Issue` with denormalized field state.

    Foreign-key references are flattened to bare UUIDs and many-to-many
    memberships (assignees, labels, modules) to ``ArrayField``\s, so the row
    is self-contained and survives downstream deletions. Captured by
    :meth:`log_issue_version` from view-layer hooks at significant change
    points.
    """

    PRIORITY_CHOICES = (
        ("urgent", "Urgent"),
        ("high", "High"),
        ("medium", "Medium"),
        ("low", "Low"),
        ("none", "None"),
    )

    parent = models.UUIDField(blank=True, null=True)
    state = models.UUIDField(blank=True, null=True)
    estimate_point = models.UUIDField(blank=True, null=True)
    name = models.CharField(max_length=255, verbose_name="Issue Name")
    # Valid: PRIORITY_CHOICES — "urgent" | "high" | "medium" | "low" | "none" (mirrors Issue.priority at snapshot time).
    priority = models.CharField(
        max_length=30,
        choices=PRIORITY_CHOICES,
        verbose_name="Issue Priority",
        default="none",
    )
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    assignees = ArrayField(models.UUIDField(), blank=True, default=list)
    sequence_id = models.IntegerField(default=1, verbose_name="Issue Sequence ID")
    labels = ArrayField(models.UUIDField(), blank=True, default=list)
    sort_order = models.FloatField(default=65535)
    completed_at = models.DateTimeField(null=True)
    archived_at = models.DateField(null=True)
    is_draft = models.BooleanField(default=False)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)
    type = models.UUIDField(blank=True, null=True)
    cycle = models.UUIDField(null=True, blank=True)
    modules = ArrayField(models.UUIDField(), blank=True, default=list)
    # INTENT UNCLEAR: snapshot of Issue.properties at version time; shape varies per view/version.
    properties = models.JSONField(default=dict)  # issue properties
    # INTENT UNCLEAR: snapshot of Issue meta payload at version time; shape varies per workflow.
    meta = models.JSONField(default=dict)  # issue meta
    last_saved_at = models.DateTimeField(default=timezone.now)

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="versions")
    activity = models.ForeignKey(
        "db.IssueActivity",
        on_delete=models.SET_NULL,
        null=True,
        related_name="versions",
    )
    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="issue_versions",
    )

    class Meta:
        """Django model metadata for :class:`IssueVersion` (table ``issue_versions``)."""

        verbose_name = "Issue Version"
        verbose_name_plural = "Issue Versions"
        db_table = "issue_versions"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the issue name + project name for admin/debug rendering."""
        return f"{self.name} <{self.project.name}>"

    @classmethod
    def log_issue_version(cls, issue, user):
        """Snapshot the current state of ``issue`` into a new :class:`IssueVersion` row.

        Resolves :class:`Module`, :class:`CycleIssue`, :class:`IssueAssignee`,
        and :class:`IssueLabel` lazily via :func:`apps.get_model` to avoid
        circular imports, then captures the issue's denormalized
        scalar fields plus its m2m memberships (assignees, labels, modules)
        and the attached cycle id. Returns ``True`` on success and ``False``
        on any exception (the exception is logged but not raised).
        """
        try:
            Module = apps.get_model("db.Module")
            CycleIssue = apps.get_model("db.CycleIssue")
            IssueAssignee = apps.get_model("db.IssueAssignee")
            IssueLabel = apps.get_model("db.IssueLabel")

            cycle_issue = CycleIssue.objects.filter(issue=issue).first()

            cls.objects.create(
                issue=issue,
                parent=issue.parent_id,
                state=issue.state_id,
                estimate_point=issue.estimate_point_id,
                name=issue.name,
                priority=issue.priority,
                start_date=issue.start_date,
                target_date=issue.target_date,
                assignees=list(IssueAssignee.objects.filter(issue=issue).values_list("assignee_id", flat=True)),
                sequence_id=issue.sequence_id,
                labels=list(IssueLabel.objects.filter(issue=issue).values_list("label_id", flat=True)),
                sort_order=issue.sort_order,
                completed_at=issue.completed_at,
                archived_at=issue.archived_at,
                is_draft=issue.is_draft,
                external_source=issue.external_source,
                external_id=issue.external_id,
                type=issue.type_id,
                cycle=cycle_issue.cycle_id if cycle_issue else None,
                modules=list(Module.objects.filter(issue=issue).values_list("id", flat=True)),
                properties={},
                meta={},
                last_saved_at=timezone.now(),
                owned_by=user,
            )
            return True
        except Exception as e:
            log_exception(e)
            return False


class IssueDescriptionVersion(ProjectBaseModel):
    """Point-in-time snapshot of an :class:`Issue` description tri-state for version history.

    Captures all four representations (``binary`` Y.js CRDT, ``html``,
    ``stripped``, ``json`` ProseMirror) so a prior version can be restored
    without consulting the live issue.
    """

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="description_versions")
    description_binary = models.BinaryField(null=True)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_stripped = models.TextField(blank=True, null=True)
    # Shape: ProseMirror JSON document tree (TipTap-compatible) at snapshot time.
    description_json = models.JSONField(default=dict, blank=True)
    last_saved_at = models.DateTimeField(default=timezone.now)
    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="issue_description_versions",
    )

    class Meta:
        """Django model metadata for :class:`IssueDescriptionVersion` (table ``issue_description_versions``)."""

        verbose_name = "Issue Description Version"
        verbose_name_plural = "Issue Description Versions"
        db_table = "issue_description_versions"

    @classmethod
    def log_issue_description_version(cls, issue, user):
        """Snapshot the current description tri-state of ``issue`` into a new :class:`IssueDescriptionVersion` row.

        Captures all four description representations (``binary`` Y.js CRDT,
        ``html``, ``stripped``, ``json`` ProseMirror) so a prior version can
        be restored without consulting the live issue. Returns ``True`` on
        success and ``False`` on any exception (logged but not raised).
        """
        try:
            cls.objects.create(
                workspace_id=issue.workspace_id,
                project_id=issue.project_id,
                created_by_id=issue.created_by_id,
                updated_by_id=issue.updated_by_id,
                owned_by_id=user,
                last_saved_at=timezone.now(),
                issue_id=issue.id,
                description_binary=issue.description_binary,
                description_html=issue.description_html,
                description_stripped=issue.description_stripped,
                description_json=issue.description_json,
            )
            return True
        except Exception as e:
            log_exception(e)
            return False
