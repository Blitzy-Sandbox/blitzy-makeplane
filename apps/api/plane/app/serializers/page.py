# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for pages, page detail/version snapshots, and binary content updates.

Page bodies are persisted in parallel representations (Y.js CRDT binary,
HTML, and ProseMirror JSON). The live collaboration server (``apps/live``)
is the authoritative writer of the binary state; the HTTP API exposes all
three encodings and routes write traffic through
:class:`PageBinaryUpdateSerializer`, which validates and sanitizes the
inbound payload before persisting it.

Cross-reference: technical specification §5.2.5.4 real-time collaboration
sequence; :mod:`plane.db.models.page`; :mod:`plane.utils.content_validator`.
"""

# Third party imports
from rest_framework import serializers
import base64

# Module imports
from .base import BaseSerializer
from plane.utils.content_validator import (
    validate_binary_data,
    validate_html_content,
)
from plane.db.models import (
    Page,
    PageLabel,
    Label,
    ProjectPage,
    Project,
    PageVersion,
)


class PageSerializer(BaseSerializer):
    """Read/write serializer for :class:`~plane.db.models.Page`.

    Handles the many-to-many label and project linkage through the
    :class:`~plane.db.models.PageLabel` and
    :class:`~plane.db.models.ProjectPage` join tables. ``labels`` is
    write-only (the inbound payload accepts :class:`~plane.db.models.Label`
    primary keys but the rendered response exposes ``label_ids`` instead);
    ``project_ids`` is similarly an inbound-only UUID list. ``workspace``
    and ``owned_by`` are read-only and derived server-side from the request
    context. ``is_favorite`` is a per-user computed boolean annotated by the
    view's queryset.
    """

    is_favorite = serializers.BooleanField(read_only=True)
    labels = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=Label.objects.all()),
        write_only=True,
        required=False,
    )
    # Many to many
    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    project_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    class Meta:
        """Bind :class:`PageSerializer` to :class:`~plane.db.models.Page`."""

        model = Page
        fields = [
            "id",
            "name",
            "owned_by",
            "access",
            "color",
            "labels",
            "parent",
            "is_favorite",
            "is_locked",
            "archived_at",
            "workspace",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "view_props",
            "logo_props",
            "label_ids",
            "project_ids",
        ]
        read_only_fields = ["workspace", "owned_by"]

    def create(self, validated_data):
        """Create the page, link it to its project, and attach the supplied labels.

        Creates the :class:`~plane.db.models.Page` row using the
        ``description_*`` bodies supplied via serializer context, then
        creates the matching :class:`~plane.db.models.ProjectPage` join row
        and bulk-creates the supplied :class:`~plane.db.models.PageLabel`
        rows in a single batched query.
        """
        labels = validated_data.pop("labels", None)
        project_id = self.context["project_id"]
        owned_by_id = self.context["owned_by_id"]
        description_json = self.context["description_json"]
        description_binary = self.context["description_binary"]
        description_html = self.context["description_html"]

        # Get the workspace id from the project
        project = Project.objects.get(pk=project_id)

        # Create the page
        page = Page.objects.create(
            **validated_data,
            description_json=description_json,
            description_binary=description_binary,
            description_html=description_html,
            owned_by_id=owned_by_id,
            workspace_id=project.workspace_id,
        )

        # Create the project page
        ProjectPage.objects.create(
            workspace_id=page.workspace_id,
            project_id=project_id,
            page_id=page.id,
            created_by_id=page.created_by_id,
            updated_by_id=page.updated_by_id,
        )

        # Create page labels
        if labels is not None:
            PageLabel.objects.bulk_create(
                [
                    PageLabel(
                        label=label,
                        page=page,
                        workspace_id=page.workspace_id,
                        created_by_id=page.created_by_id,
                        updated_by_id=page.updated_by_id,
                    )
                    for label in labels
                ],
                batch_size=10,
            )
        return page

    def update(self, instance, validated_data):
        """Re-sync page labels and delegate other field updates to the parent.

        When ``labels`` is present, the existing
        :class:`~plane.db.models.PageLabel` rows for the page are deleted
        and re-created from the supplied set; remaining fields are forwarded
        to :meth:`rest_framework.serializers.ModelSerializer.update`.
        """
        labels = validated_data.pop("labels", None)
        if labels is not None:
            PageLabel.objects.filter(page=instance).delete()
            PageLabel.objects.bulk_create(
                [
                    PageLabel(
                        label=label,
                        page=instance,
                        workspace_id=instance.workspace_id,
                        created_by_id=instance.created_by_id,
                        updated_by_id=instance.updated_by_id,
                    )
                    for label in labels
                ],
                batch_size=10,
            )

        return super().update(instance, validated_data)


class PageDetailSerializer(PageSerializer):
    """Detail-view extension of :class:`PageSerializer` that inlines the rendered body.

    Adds ``description_html`` -- the server-rendered HTML representation of
    the page body -- so a single GET response can power the full read view
    without a follow-up call to the binary/HTML download endpoint.
    """

    description_html = serializers.CharField()

    class Meta(PageSerializer.Meta):
        """Inherit :class:`PageSerializer.Meta` and append ``description_html``."""

        fields = PageSerializer.Meta.fields + ["description_html"]


class PageVersionSerializer(BaseSerializer):
    """Read serializer for :class:`~plane.db.models.PageVersion` history rows.

    Returns only the metadata for a historical snapshot (timestamps, owner,
    audit fields) so the version-history list can be rendered without
    transferring the full description payload for every entry.
    """

    class Meta:
        """Bind :class:`PageVersionSerializer` to :class:`~plane.db.models.PageVersion`."""

        model = PageVersion
        fields = [
            "id",
            "workspace",
            "page",
            "last_saved_at",
            "owned_by",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = ["workspace", "page"]


class PageVersionDetailSerializer(BaseSerializer):
    """Read serializer for :class:`~plane.db.models.PageVersion` snapshots with full content.

    Includes the full description payloads -- ``description_binary``,
    ``description_html`` and ``description_json`` -- needed to restore or
    diff a historical snapshot against the current page body.
    """

    class Meta:
        """Bind :class:`PageVersionDetailSerializer` to :class:`~plane.db.models.PageVersion`."""

        model = PageVersion
        fields = [
            "id",
            "workspace",
            "page",
            "last_saved_at",
            "description_binary",
            "description_html",
            "description_json",
            "owned_by",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = ["workspace", "page"]


class PageBinaryUpdateSerializer(serializers.Serializer):
    """Validate-and-persist serializer for the binary/HTML/JSON description payload of a page.

    This is a plain :class:`rest_framework.serializers.Serializer` rather
    than a ``ModelSerializer`` because each request may carry any non-empty
    subset of the three description encodings; :meth:`update` writes only
    the fields actually supplied and leaves the others untouched.
    """

    description_binary = serializers.CharField(required=False, allow_blank=True)
    description_html = serializers.CharField(required=False, allow_blank=True)
    description_json = serializers.JSONField(required=False, allow_null=True)

    def validate_description_binary(self, value):
        """Decode the base64-encoded Y.js binary state and reject malformed or unsafe payloads."""
        if not value:
            return value

        try:
            # Decode the base64 data
            binary_data = base64.b64decode(value)

            # Validate the binary data
            is_valid, error_message = validate_binary_data(binary_data)
            if not is_valid:
                raise serializers.ValidationError(f"Invalid binary data: {error_message}")

            return binary_data
        except Exception as e:
            if isinstance(e, serializers.ValidationError):
                raise
            raise serializers.ValidationError("Failed to decode base64 data")

    def validate_description_html(self, value):
        """Run the HTML through the content sanitizer and reject markup that fails security checks."""
        if not value:
            return value

        # Use the validation function from utils
        is_valid, error_message, sanitized_html = validate_html_content(value)
        if not is_valid:
            raise serializers.ValidationError(error_message)

        # Return sanitized HTML if available, otherwise return original
        return sanitized_html if sanitized_html is not None else value

    def update(self, instance, validated_data):
        """Persist whichever of ``description_binary``/``description_html``/``description_json`` are present."""
        if "description_binary" in validated_data:
            instance.description_binary = validated_data.get("description_binary")

        if "description_html" in validated_data:
            instance.description_html = validated_data.get("description_html")

        if "description_json" in validated_data:
            instance.description_json = validated_data.get("description_json")

        instance.save()
        return instance
