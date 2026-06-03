# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for workspace wiki/documentation pages with version history.

:class:`Page` is the rich-text page (workspace-scoped, optionally shared with
multiple projects via :class:`ProjectPage`) carrying a four-way body
representation (binary Y.js CRDT / HTML / ProseMirror JSON / stripped plain
text); :class:`PageLog` is the append-only mention / back-link / embed log;
:class:`PageVersion` snapshots the body at a point in time for version-history
rendering.

Cross-reference: technical specification §5.2.5.4 real-time collaboration
sequence; the Y.js binary representation is authoritative for ``apps/live``.
"""

import uuid

from django.conf import settings
from django.utils import timezone

# Django imports
from django.db import models

# Module imports
from plane.utils.html_processor import strip_tags

from .base import BaseModel


def get_view_props():
    """Return the default ``Page.view_props`` dict (full-width layout disabled)."""
    return {"full_width": False}


class Page(BaseModel):
    """Workspace-scoped rich-text page with collaborative tri-state body and project sharing.

    The body is persisted in four parallel representations: Y.js CRDT binary
    (authoritative for ``apps/live``), HTML (REST-writable), ProseMirror JSON
    (editor hydration), and stripped plain text (search). ``access`` controls
    public/private visibility; ``parent`` enables nested page hierarchies;
    ``projects`` (through :class:`ProjectPage`) allows sharing one page across
    multiple projects.
    """

    PRIVATE_ACCESS = 1
    PUBLIC_ACCESS = 0
    DEFAULT_SORT_ORDER = 65535

    ACCESS_CHOICES = ((PRIVATE_ACCESS, "Private"), (PUBLIC_ACCESS, "Public"))

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="pages")
    name = models.TextField(blank=True)
    # Shape: ProseMirror JSON document tree (TipTap-compatible) for editor hydration.
    description_json = models.JSONField(default=dict, blank=True)
    description_binary = models.BinaryField(null=True)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_stripped = models.TextField(blank=True, null=True)
    owned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="pages")
    # Valid: 0 = Public | 1 = Private (mirrors the ACCESS_CHOICES tuple defined above).
    access = models.PositiveSmallIntegerField(choices=((0, "Public"), (1, "Private")), default=0)
    color = models.CharField(max_length=255, blank=True)
    labels = models.ManyToManyField("db.Label", blank=True, related_name="pages", through="db.PageLabel")
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="child_page",
    )
    archived_at = models.DateField(null=True)
    is_locked = models.BooleanField(default=False)
    # Shape: see get_view_props (e.g., {"full_width": bool}).
    view_props = models.JSONField(default=get_view_props)
    # INTENT UNCLEAR: page logo/icon metadata consumed by the page dropdown; shape varies per surface.
    logo_props = models.JSONField(default=dict)
    is_global = models.BooleanField(default=False)
    projects = models.ManyToManyField("db.Project", related_name="pages", through="db.ProjectPage")
    moved_to_page = models.UUIDField(null=True, blank=True)
    moved_to_project = models.UUIDField(null=True, blank=True)
    sort_order = models.FloatField(default=DEFAULT_SORT_ORDER)

    external_id = models.CharField(max_length=255, null=True, blank=True)
    external_source = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        """Django model metadata: ``pages`` table, newest-first ordering."""

        verbose_name = "Page"
        verbose_name_plural = "Pages"
        db_table = "pages"
        ordering = ("-created_at",)

    def __str__(self):
        """Return owner email and page name."""
        return f"{self.owned_by.email} <{self.name}>"

    def save(self, *args, **kwargs):
        """Recompute ``description_stripped`` from ``description_html`` on every save.

        Stripped text is kept in lockstep with HTML so search and unread-summary
        renderers do not have to parse markup at read time.
        """
        # Strip the html tags using html parser
        self.description_stripped = (
            None
            if (self.description_html == "" or self.description_html is None)
            else strip_tags(self.description_html)
        )
        super(Page, self).save(*args, **kwargs)


class PageLog(BaseModel):
    """Append-only transaction log of mentions, back-links, and embeds inside a :class:`Page`.

    Each row records one inline reference inside the page body (e.g., a mention
    of an issue, cycle, module, user, or another page). ``transaction`` is a
    client-generated UUID that the editor uses to deduplicate updates.
    """

    TYPE_CHOICES = (
        ("to_do", "To Do"),
        ("issue", "issue"),
        ("image", "Image"),
        ("video", "Video"),
        ("file", "File"),
        ("link", "Link"),
        ("cycle", "Cycle"),
        ("module", "Module"),
        ("back_link", "Back Link"),
        ("forward_link", "Forward Link"),
        ("page_mention", "Page Mention"),
        ("user_mention", "User Mention"),
    )
    transaction = models.UUIDField(default=uuid.uuid4)
    page = models.ForeignKey(Page, related_name="page_log", on_delete=models.CASCADE)
    entity_identifier = models.UUIDField(null=True, blank=True)
    # Valid: one of TYPE_CHOICES (e.g. "to_do" | "issue" | "image" | "video" | "file" |
    # "link" | "cycle" | "module" | "back_link" | "forward_link" | "page_mention" | "user_mention").
    entity_name = models.CharField(max_length=30, verbose_name="Transaction Type")
    entity_type = models.CharField(max_length=30, verbose_name="Entity Type", null=True, blank=True)
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workspace_page_log")

    class Meta:
        """Django model metadata: ``page_logs`` table with (page, transaction) uniqueness and entity indexes."""

        unique_together = ["page", "transaction"]
        verbose_name = "Page Log"
        verbose_name_plural = "Page Logs"
        db_table = "page_logs"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["entity_type"], name="pagelog_entity_type_idx"),
            models.Index(fields=["entity_identifier"], name="pagelog_entity_id_idx"),
            models.Index(fields=["entity_name"], name="pagelog_entity_name_idx"),
            models.Index(fields=["entity_type", "entity_identifier"], name="pagelog_type_id_idx"),
            models.Index(fields=["entity_name", "entity_identifier"], name="pagelog_name_id_idx"),
        ]

    def __str__(self):
        """Return the page name + entity name for admin/debug rendering."""
        return f"{self.page.name} {self.entity_name}"


class PageLabel(BaseModel):
    """Many-to-many join binding a :class:`Page` to a :class:`Label`."""

    label = models.ForeignKey("db.Label", on_delete=models.CASCADE, related_name="page_labels")
    page = models.ForeignKey("db.Page", on_delete=models.CASCADE, related_name="page_labels")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workspace_page_label")

    class Meta:
        """Django model metadata: ``page_labels`` join table, newest-first ordering."""

        verbose_name = "Page Label"
        verbose_name_plural = "Page Labels"
        db_table = "page_labels"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the page name + label name for admin/debug rendering."""
        return f"{self.page.name} {self.label.name}"


class ProjectPage(BaseModel):
    """Many-to-many join binding a :class:`Page` to a :class:`Project` for cross-project sharing."""

    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="project_pages")
    page = models.ForeignKey("db.Page", on_delete=models.CASCADE, related_name="project_pages")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="project_pages")

    class Meta:
        """Django model metadata: ``project_pages`` join table with soft-delete-aware uniqueness on (project, page)."""

        unique_together = ["project", "page", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "page"],
                condition=models.Q(deleted_at__isnull=True),
                name="project_page_unique_project_page_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Page"
        verbose_name_plural = "Project Pages"
        db_table = "project_pages"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the project name + page name for admin/debug rendering."""
        return f"{self.project.name} {self.page.name}"


class PageVersion(BaseModel):
    """Point-in-time snapshot of a :class:`Page` body for version-history rendering.

    Captures the same four-way body shape as :class:`Page` (binary / HTML /
    JSON / stripped) plus a ``sub_pages_data`` map of any nested pages that
    existed under the parent at snapshot time.
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="page_versions")
    page = models.ForeignKey("db.Page", on_delete=models.CASCADE, related_name="page_versions")
    last_saved_at = models.DateTimeField(default=timezone.now)
    owned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="page_versions")
    description_binary = models.BinaryField(null=True)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_stripped = models.TextField(blank=True, null=True)
    # Shape: ProseMirror JSON document tree (TipTap-compatible) for editor hydration of this snapshot.
    description_json = models.JSONField(default=dict, blank=True)
    # INTENT UNCLEAR: snapshot of nested-page metadata at version creation time; shape varies per version.
    sub_pages_data = models.JSONField(default=dict, blank=True)

    class Meta:
        """Django model metadata: ``page_versions`` table, newest-first ordering."""

        verbose_name = "Page Version"
        verbose_name_plural = "Page Versions"
        db_table = "page_versions"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        """Recompute ``description_stripped`` from ``description_html`` on every write.

        Mirrors the behaviour of :meth:`Page.save` so the snapshot's plain-text
        projection stays in lockstep with the stored HTML body.
        """
        # Strip the html tags using html parser
        self.description_stripped = (
            None
            if (self.description_html == "" or self.description_html is None)
            else strip_tags(self.description_html)
        )
        super(PageVersion, self).save(*args, **kwargs)
