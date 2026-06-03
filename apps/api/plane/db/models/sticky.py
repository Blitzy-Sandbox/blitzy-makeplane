# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database model for user-owned workspace sticky notes.

:class:`Sticky` carries rich-text content in the same four-representation
shape used by :class:`Description` (JSON + HTML + stripped + Y.js binary), is
owned by a single user, and surfaces on the workspace home dashboard.
"""

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .base import BaseModel

# Third party imports
from plane.utils.html_processor import strip_tags


class Sticky(BaseModel):
    """User-owned workspace sticky note with rich-text content and visual styling.

    Stores the description in the same four-way representation as
    :class:`Description` (JSON / HTML / stripped / Y.js binary) and supports
    per-sticky color and background-color overrides for the workspace home
    widget.
    """

    name = models.TextField(null=True, blank=True)

    # Shape: ProseMirror JSON document tree (TipTap-compatible) for editor hydration.
    description = models.JSONField(blank=True, default=dict)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_stripped = models.TextField(blank=True, null=True)
    description_binary = models.BinaryField(null=True)

    # INTENT UNCLEAR: sticky logo/icon metadata consumed by the home widget; shape varies per surface.
    logo_props = models.JSONField(default=dict)
    color = models.CharField(max_length=255, blank=True, null=True)
    background_color = models.CharField(max_length=255, blank=True, null=True)

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="stickies")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="stickies")
    sort_order = models.FloatField(default=65535)

    class Meta:
        """Django model metadata pinning verbose names, table name, and default ordering."""

        verbose_name = "Sticky"
        verbose_name_plural = "Stickies"
        db_table = "stickies"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        """Recompute stripped text from HTML and allocate next ``sort_order`` slot when inserting.

        Stripped text is kept in lockstep with ``description_html`` on every save;
        new stickies are appended after the workspace's existing maximum
        ``sort_order`` (slot increments of 10000).
        """
        # Strip the html tags using html parser
        self.description_stripped = (
            None
            if (self.description_html == "" or self.description_html is None)
            else strip_tags(self.description_html)
        )
        if self._state.adding:
            # Get the maximum sequence value from the database
            last_id = Sticky.objects.filter(workspace=self.workspace).aggregate(largest=models.Max("sort_order"))[
                "largest"
            ]
            # if last_id is not None
            if last_id is not None:
                self.sort_order = last_id + 10000

        super(Sticky, self).save(*args, **kwargs)

    def __str__(self):
        """Return the sticky's name for admin/debug rendering."""
        return str(self.name)
