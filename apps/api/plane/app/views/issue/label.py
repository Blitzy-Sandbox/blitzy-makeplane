# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project-scoped label HTTP endpoints.

Exposes :class:`LabelViewSet` for full CRUD on :class:`Label` (named,
colored, optionally hierarchical labels used to tag issues) and
:class:`BulkCreateIssueLabelsEndpoint` for batch-creating labels during
data imports/migrations.

Labels are *project-scoped* (not workspace-scoped) and admin-only for
mutation; reads are permitted to any project member.

All :class:`LabelViewSet` writes invalidate the
``/api/workspaces/:slug/labels/`` cache so that any future reads of the
workspace labels listing observe the change immediately.
"""

# Python imports
import random

# Django imports
from django.db import IntegrityError

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet, BaseAPIView
from plane.app.serializers import LabelSerializer
from plane.app.permissions import allow_permission, ProjectBasePermission, ROLE
from plane.db.models import Project, Label
from plane.utils.cache import invalidate_cache


class LabelViewSet(BaseViewSet):
    """CRUD endpoint for project-scoped issue labels (named, colored, optionally hierarchical).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/issue-labels/
        POST   /api/workspaces/<slug>/projects/<project_id>/issue-labels/
        GET    /api/workspaces/<slug>/projects/<project_id>/issue-labels/<pk>/
        PATCH  /api/workspaces/<slug>/projects/<project_id>/issue-labels/<pk>/
        DELETE /api/workspaces/<slug>/projects/<project_id>/issue-labels/<pk>/

    Request body (POST / PATCH):
        Validated by :class:`plane.app.serializers.LabelSerializer`:
            * ``name`` (str, required on POST) -- label display name.
            * ``color`` (str, optional) -- ``#RRGGBB`` hex.
            * ``parent`` (UUID, optional) -- parent label for nested
              labels.
            * ``description`` (str, optional).
            * ``sort_order`` (float, optional) -- ordering within the
              project's label list.

    Response shape:
        ``LabelSerializer`` output (id, name, color, parent,
        description, sort_order, project, workspace, created_at,
        updated_at).

    Permissions:
        permission_classes = [ProjectBasePermission]
            * Reads allowed to any active project member.
            * Writes additionally gated by
              ``@allow_permission([ROLE.ADMIN])`` -- only project
              admins may create / update / delete labels.

    get_queryset filter logic:
        ``Label.objects.filter(workspace__slug=<slug>,
        project_id=<project_id>,
        project__project_projectmember__member=<request.user>)``;
        ``select_related`` project / workspace / parent; ordered by
        ``sort_order``; distinct.

    Uniqueness:
        ``(project_id, name)`` is unique. ``create`` returns HTTP 400
        ``"Label with the same name already exists in the project"`` on
        IntegrityError; ``partial_update`` pre-validates the name
        against this constraint and returns the same error code.

    Cache invalidation:
        Every write decorates with
        ``@invalidate_cache(path="/api/workspaces/:slug/labels/",
        url_params=True, user=False)`` -- ``create`` adds
        ``multiple=True`` to also invalidate paginated cache keys.
    """

    serializer_class = LabelSerializer
    model = Label
    permission_classes = [ProjectBasePermission]

    def get_queryset(self):
        """Return labels scoped to the URL's workspace + project.

        Restricted to active project members, joined to ``parent`` for
        nested labels, and ordered by ``sort_order``.
        """
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(project__project_projectmember__member=self.request.user)
            .select_related("project")
            .select_related("workspace")
            .select_related("parent")
            .distinct()
            .order_by("sort_order")
        )

    @invalidate_cache(path="/api/workspaces/:slug/labels/", url_params=True, user=False, multiple=True)
    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id):
        """Create a new label in the project.

        Returns HTTP 400 if a label with the same name already exists
        (``IntegrityError`` on the ``(project_id, name)`` unique
        constraint).
        """
        try:
            serializer = LabelSerializer(data=request.data, context={"project_id": project_id})
            if serializer.is_valid():
                serializer.save(project_id=project_id)
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response(
                {"error": "Label with the same name already exists in the project"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @invalidate_cache(path="/api/workspaces/:slug/labels/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def partial_update(self, request, *args, **kwargs):
        """Update label fields.

        Pre-validates that the new ``name`` (if provided) is unique
        within the project before delegating to the serializer.
        """
        # Check if the label name is unique within the project
        if (
            "name" in request.data
            and Label.objects.filter(project_id=kwargs["project_id"], name=request.data["name"])
            .exclude(pk=kwargs["pk"])
            .exists()
        ):
            return Response(
                {"error": "Label with the same name already exists in the project"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = LabelSerializer(
            instance=self.get_object(),
            data=request.data,
            context={"project_id": kwargs["project_id"]},
            partial=True,
        )

        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @invalidate_cache(path="/api/workspaces/:slug/labels/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def destroy(self, request, *args, **kwargs):
        """Delete the label (admin-only).

        The workspace-labels cache is invalidated as a side effect of
        the ``@invalidate_cache`` decorator.
        """
        return super().destroy(request, *args, **kwargs)


class BulkCreateIssueLabelsEndpoint(BaseAPIView):
    """Batch-create labels with randomized colors -- primary consumer is data-import / migration tooling.

    HTTP methods + URL patterns:
        POST /api/workspaces/<slug>/projects/<project_id>/bulk-create-labels/

    Request body:
        label_data (list[dict], required): each dict may carry
            ``name`` (str, default ``"Migrated"``) and
            ``description`` (str, default ``"Migrated Issue"``).

    Response shape:
        ``{"labels": [<LabelSerializer output>, ...]}`` (HTTP 201).

    Permissions:
        permission_classes -- not set on the class; inherits
        ``[IsAuthenticated]`` from :class:`BaseAPIView`.
        Per-method gate: ``@allow_permission([ROLE.ADMIN])``.

    Side effects:
        ``Label.objects.bulk_create(..., batch_size=50,
        ignore_conflicts=True)`` -- so duplicates within the batch are
        silently dropped (this is documented for the migration use
        case). Each created label is assigned a random hex color via
        ``f"#{random.randint(0, 0xFFFFFF + 1):06X}"``.

    Note:
        The default ``"Migrated"`` / ``"Migrated Issue"`` strings are
        documented hints that this endpoint is the entry point used by
        CSV-import and third-party importer flows when source labels
        are missing names.
    """

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id):
        """Bulk-create labels with random hex colors and return the created rows.

        Uses ``Label.objects.bulk_create(..., batch_size=50,
        ignore_conflicts=True)`` so duplicates within the batch are
        silently dropped.
        """
        label_data = request.data.get("label_data", [])

        project = Project.objects.get(pk=project_id)

        labels = Label.objects.bulk_create(
            [
                Label(
                    name=label.get("name", "Migrated"),
                    description=label.get("description", "Migrated Issue"),
                    color=f"#{random.randint(0, 0xFFFFFF + 1):06X}",
                    project_id=project_id,
                    workspace_id=project.workspace_id,
                    created_by=request.user,
                    updated_by=request.user,
                )
                for label in label_data
            ],
            batch_size=50,
            ignore_conflicts=True,
        )

        return Response(
            {"labels": LabelSerializer(labels, many=True).data},
            status=status.HTTP_201_CREATED,
        )
