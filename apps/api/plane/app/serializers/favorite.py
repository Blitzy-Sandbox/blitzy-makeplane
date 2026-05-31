# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for ``UserFavorite`` rows and the compact entity payloads attached to them.

A user favorite can target any of ``cycle``, ``issue``, ``module``, ``view``, ``page``, or
``project``, or be a ``folder`` grouping other favorites. Lightweight per-entity serializers
defined here are resolved at runtime through :func:`get_entity_model_and_serializer` using
the ``entity_type`` discriminant carried on each ``UserFavorite`` row.
"""

from rest_framework import serializers

from plane.db.models import UserFavorite, Cycle, Module, Issue, IssueView, Page, Project


class ProjectFavoriteLiteSerializer(serializers.ModelSerializer):
    """Compact ``Project`` representation embedded in user-favorite responses (id, name, logo)."""

    class Meta:
        """DRF metaclass binding ``Project`` with the lite field set used inside favorite payloads."""

        model = Project
        fields = ["id", "name", "logo_props"]


class PageFavoriteLiteSerializer(serializers.ModelSerializer):
    """Compact ``Page`` representation for favorites with a denormalized ``project_id``.

    Resolves ``project_id`` from the page's many-to-many ``projects`` relation so favorite
    consumers can build project-scoped routes without an extra round trip.
    """

    project_id = serializers.SerializerMethodField()

    class Meta:
        """DRF metaclass binding ``Page``; ``project_id`` is supplied by the ``SerializerMethodField``."""

        model = Page
        fields = ["id", "name", "logo_props", "project_id"]

    def get_project_id(self, obj):
        """Return the first associated project ID, or ``None`` if the page is not linked to any project."""
        project = obj.projects.first()  # This gets the first project related to the Page
        return project.id if project else None


class CycleFavoriteLiteSerializer(serializers.ModelSerializer):
    """Compact ``Cycle`` representation embedded in user-favorite responses."""

    class Meta:
        """DRF metaclass binding ``Cycle`` with the lite field set used inside favorite payloads."""

        model = Cycle
        fields = ["id", "name", "logo_props", "project_id"]


class ModuleFavoriteLiteSerializer(serializers.ModelSerializer):
    """Compact ``Module`` representation embedded in user-favorite responses."""

    class Meta:
        """DRF metaclass binding ``Module`` with the lite field set used inside favorite payloads."""

        model = Module
        fields = ["id", "name", "logo_props", "project_id"]


class ViewFavoriteSerializer(serializers.ModelSerializer):
    """Compact ``IssueView`` representation embedded in user-favorite responses."""

    class Meta:
        """DRF metaclass binding ``IssueView`` with the lite field set used inside favorite payloads."""

        model = IssueView
        fields = ["id", "name", "logo_props", "project_id"]


def get_entity_model_and_serializer(entity_type):
    """Return the ``(Model, Serializer)`` pair for a favorited entity of the given type.

    Maps ``cycle``/``module``/``view``/``page``/``project`` to their compact lite serializers
    and returns ``(None, None)`` for ``issue``, ``folder``, or unknown types where no compact
    serializer applies: issue favorites carry the issue UUID in ``entity_identifier`` and are
    not rendered inline, and folders are pure grouping nodes with no nested entity to serialize.
    """
    entity_map = {
        "cycle": (Cycle, CycleFavoriteLiteSerializer),
        "issue": (Issue, None),
        "module": (Module, ModuleFavoriteLiteSerializer),
        "view": (IssueView, ViewFavoriteSerializer),
        "page": (Page, PageFavoriteLiteSerializer),
        "project": (Project, ProjectFavoriteLiteSerializer),
        "folder": (None, None),
    }
    return entity_map.get(entity_type, (None, None))


class UserFavoriteSerializer(serializers.ModelSerializer):
    """Serializer for ``UserFavorite`` rows with a polymorphic compact entity payload.

    The computed ``entity_data`` field is resolved at serialization time via
    :func:`get_entity_model_and_serializer` from the row's ``entity_type``. The
    ``workspace``, ``created_by``, and ``updated_by`` fields are read-only and populated
    from URL/request context rather than the request body.
    """

    entity_data = serializers.SerializerMethodField()

    class Meta:
        """DRF metaclass binding ``UserFavorite``.

        ``workspace``/``created_by``/``updated_by`` are read-only and set from request context.
        """

        model = UserFavorite
        fields = [
            "id",
            "entity_type",
            "entity_identifier",
            "entity_data",
            "name",
            "is_folder",
            "sequence",
            "parent",
            "workspace_id",
            "project_id",
        ]
        read_only_fields = ["workspace", "created_by", "updated_by"]

    def get_entity_data(self, obj):
        """Resolve the favorited entity through the dispatch table and return its compact serialization.

        Returns ``None`` when the entity type lacks a serializer (issue, folder, unknown) or when
        the underlying entity row has been deleted — favorites can outlive their targets, so the
        ``DoesNotExist`` branch is swallowed to keep the response well-formed.
        """
        entity_type = obj.entity_type
        entity_identifier = obj.entity_identifier

        entity_model, entity_serializer = get_entity_model_and_serializer(entity_type)
        if entity_model and entity_serializer:
            try:
                entity = entity_model.objects.get(pk=entity_identifier)
                return entity_serializer(entity).data
            except entity_model.DoesNotExist:
                return None
        return None
