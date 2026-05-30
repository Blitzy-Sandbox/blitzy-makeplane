# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database model for the polymorphic file-asset surface backing every uploaded artifact.

:class:`FileAsset` holds one row per uploaded file (user avatar / cover,
workspace logo, project cover, issue attachment, issue / comment / page /
draft-issue description embedded image), discriminated by ``entity_type``
and routed to S3/MinIO via Django's storages backend. ``storage_metadata``
is populated asynchronously by ``bgtasks.storage_metadata_task`` after the
presigned upload completes.

Cross-reference: technical specification §5.2.9 Presigned Upload Sequence.
"""

# Python imports
from uuid import uuid4

# Django import
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

# Module import
from plane.utils.path_validator import sanitize_filename

from .base import BaseModel


def get_upload_path(instance, filename):
    """Build the storage-backend upload path for a :class:`FileAsset` instance.

    Sanitises ``filename`` (falling back to a hex UUID), then prefixes with
    the workspace UUID when the asset is workspace-scoped, or ``user-``
    when it is not yet tied to a workspace (e.g., the first avatar upload
    during signup).
    """
    filename = sanitize_filename(filename) or uuid4().hex
    if instance.workspace_id is not None:
        return f"{instance.workspace.id}/{uuid4().hex}-{filename}"
    return f"user-{uuid4().hex}-{filename}"


def file_size(value):
    """Validate that an uploaded file does not exceed ``settings.FILE_SIZE_LIMIT``.

    Raises:
        django.core.exceptions.ValidationError: if the uploaded file exceeds
            the configured size cap (5 MB on cloud deployments).
    """
    if value.size > settings.FILE_SIZE_LIMIT:
        raise ValidationError("File too large. Size should not exceed 5 MB.")


class FileAsset(BaseModel):
    """Polymorphic file-asset record backing every uploaded artifact in Plane.

    Discriminated by ``entity_type`` (see :class:`EntityTypeContext`) and the
    matching nullable FK column (``user``, ``workspace``, ``project``,
    ``issue``, ``comment``, ``page``, ``draft_issue``). ``is_uploaded``
    flips ``True`` only after the presigned upload completes; ``storage_metadata``
    is populated asynchronously by ``bgtasks.storage_metadata_task``.
    """

    class EntityTypeContext(models.TextChoices):
        """Canonical list of valid ``FileAsset.entity_type`` values used by views and serializers."""

        ISSUE_ATTACHMENT = "ISSUE_ATTACHMENT"
        ISSUE_DESCRIPTION = "ISSUE_DESCRIPTION"
        COMMENT_DESCRIPTION = "COMMENT_DESCRIPTION"
        PAGE_DESCRIPTION = "PAGE_DESCRIPTION"
        USER_COVER = "USER_COVER"
        USER_AVATAR = "USER_AVATAR"
        WORKSPACE_LOGO = "WORKSPACE_LOGO"
        PROJECT_COVER = "PROJECT_COVER"
        DRAFT_ISSUE_ATTACHMENT = "DRAFT_ISSUE_ATTACHMENT"
        DRAFT_ISSUE_DESCRIPTION = "DRAFT_ISSUE_DESCRIPTION"

    # INTENT UNCLEAR: per-asset client-supplied attributes (e.g., width/height, alt text); shape varies per entity_type.
    attributes = models.JSONField(default=dict)
    asset = models.FileField(upload_to=get_upload_path, max_length=800)
    user = models.ForeignKey("db.User", on_delete=models.CASCADE, null=True, related_name="assets")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, null=True, related_name="assets")
    draft_issue = models.ForeignKey("db.DraftIssue", on_delete=models.CASCADE, null=True, related_name="assets")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, null=True, related_name="assets")
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, null=True, related_name="assets")
    comment = models.ForeignKey("db.IssueComment", on_delete=models.CASCADE, null=True, related_name="assets")
    page = models.ForeignKey("db.Page", on_delete=models.CASCADE, null=True, related_name="assets")
    # Valid values: EntityTypeContext — "ISSUE_ATTACHMENT" | "ISSUE_DESCRIPTION" | "COMMENT_DESCRIPTION" |
    # "PAGE_DESCRIPTION" | "USER_COVER" | "USER_AVATAR" | "WORKSPACE_LOGO" | "PROJECT_COVER" |
    # "DRAFT_ISSUE_ATTACHMENT" | "DRAFT_ISSUE_DESCRIPTION". Declared as free-text CharField
    # (no choices=) so the enum exists for validation in serializers, not at the DB layer.
    entity_type = models.CharField(max_length=255, null=True, blank=True)
    entity_identifier = models.CharField(max_length=255, null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    external_id = models.CharField(max_length=255, null=True, blank=True)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    size = models.FloatField(default=0)
    is_uploaded = models.BooleanField(default=False)
    # Shape: opaque storage-backend metadata (size, content-type, ETag, etc.) populated by
    # bgtasks.storage_metadata_task after the presigned upload completes.
    storage_metadata = models.JSONField(default=dict, null=True, blank=True)

    class Meta:
        """Django model metadata: ``file_assets`` table, indexed by entity discriminators for hot lookups."""

        verbose_name = "File Asset"
        verbose_name_plural = "File Assets"
        db_table = "file_assets"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["entity_type"], name="asset_entity_type_idx"),
            models.Index(fields=["entity_identifier"], name="asset_entity_identifier_idx"),
            models.Index(fields=["entity_type", "entity_identifier"], name="asset_entity_idx"),
            models.Index(fields=["asset"], name="asset_asset_idx"),
        ]

    def __str__(self):
        """Return the storage path of the asset for admin/debug rendering."""
        return str(self.asset)

    @property
    def asset_url(self):
        """Return the API URL path for fetching this asset, routed by ``entity_type``.

        Each entity type has a dedicated retrieval endpoint in
        ``apps/api/plane/app/views/asset/``:
        - Workspace/user/project visual assets resolve to a static-style URL.
        - Issue attachments resolve to the workspace+project+issue-scoped URL.
        - Description-embedded assets resolve to the workspace+project-scoped URL.
        Returns ``None`` if ``entity_type`` is unrecognised.
        """
        if (
            self.entity_type == self.EntityTypeContext.WORKSPACE_LOGO
            or self.entity_type == self.EntityTypeContext.USER_AVATAR
            or self.entity_type == self.EntityTypeContext.USER_COVER
            or self.entity_type == self.EntityTypeContext.PROJECT_COVER
        ):
            return f"/api/assets/v2/static/{self.id}/"

        if self.entity_type == self.EntityTypeContext.ISSUE_ATTACHMENT:
            return f"/api/assets/v2/workspaces/{self.workspace.slug}/projects/{self.project_id}/issues/{self.issue_id}/attachments/{self.id}/"  # noqa: E501

        if self.entity_type in [
            self.EntityTypeContext.ISSUE_DESCRIPTION,
            self.EntityTypeContext.COMMENT_DESCRIPTION,
            self.EntityTypeContext.PAGE_DESCRIPTION,
            self.EntityTypeContext.DRAFT_ISSUE_DESCRIPTION,
        ]:
            return f"/api/assets/v2/workspaces/{self.workspace.slug}/projects/{self.project_id}/{self.id}/"

        return None
