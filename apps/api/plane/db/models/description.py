# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for the rich-text description tri-state used by issues, comments, and pages.

Each :class:`Description` row carries four parallel representations of editor
content: the authoritative Y.js binary (``description_binary``) synced by
``apps/live``, the rendered HTML written by REST clients, the ProseMirror JSON
consumed by the editor on hydration, and a plain-text projection used for
search and previews. :class:`DescriptionVersion` snapshots the same tri-state
for historical version retrieval. See tech spec §5.2.5.4 (real-time
collaboration sequence) for the binary/HTML reconciliation flow.
"""

from django.db import models
from django.utils.html import strip_tags
from .workspace import WorkspaceBaseModel


class Description(WorkspaceBaseModel):
    """Authoritative rich-text content row shared by issues, comments, and pages.

    Stores four parallel representations: Y.js binary (real-time authoritative),
    HTML (REST-writable), ProseMirror JSON (editor hydration), and a plain-text
    projection for search/preview. ``description_stripped`` is recomputed from
    ``description_html`` on every save.
    """

    # Shape: ProseMirror JSON document tree (TipTap-compatible) for editor hydration.
    description_json = models.JSONField(default=dict, blank=True)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_binary = models.BinaryField(null=True)
    description_stripped = models.TextField(blank=True, null=True)

    class Meta:
        """Database table metadata for ``Description``."""

        verbose_name = "Description"
        verbose_name_plural = "Descriptions"
        db_table = "descriptions"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        """Recompute ``description_stripped`` from ``description_html`` before persisting.

        The stripped projection is used by search and preview surfaces and is
        kept in lockstep with the HTML representation on every write.
        """
        # Strip the html tags using html parser
        self.description_stripped = (
            None
            if (self.description_html == "" or self.description_html is None)
            else strip_tags(self.description_html)
        )
        super(Description, self).save(*args, **kwargs)


class DescriptionVersion(WorkspaceBaseModel):
    """Historical snapshot of a :class:`Description` row for version restore and audit."""

    description = models.ForeignKey("db.Description", on_delete=models.CASCADE, related_name="versions")
    # Shape: ProseMirror JSON document tree (TipTap-compatible) for editor hydration.
    description_json = models.JSONField(default=dict, blank=True)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_binary = models.BinaryField(null=True)
    description_stripped = models.TextField(blank=True, null=True)

    class Meta:
        """Database table metadata for ``DescriptionVersion``."""

        verbose_name = "Description Version"
        verbose_name_plural = "Description Versions"
        db_table = "description_versions"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        """Recompute ``description_stripped`` from ``description_html`` before persisting the version snapshot."""
        # Strip the html tags using html parser
        self.description_stripped = (
            None
            if (self.description_html == "" or self.description_html is None)
            else strip_tags(self.description_html)
        )
        super(DescriptionVersion, self).save(*args, **kwargs)
