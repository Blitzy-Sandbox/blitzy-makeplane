# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""HTTP endpoints for project-scoped estimation systems (estimates + estimate points).

Implements three DRF endpoint classes under
``/api/workspaces/<slug>/projects/<project_id>/`` that together cover the
full lifecycle of a project's estimation scale:

* :class:`ProjectEstimatePointEndpoint` -- read the points of the
  project's currently-active :class:`~plane.db.models.Estimate`, if any.
* :class:`BulkEstimatePointEndpoint` -- list / create / retrieve /
  partial-update / destroy an :class:`~plane.db.models.Estimate` together
  with its :class:`~plane.db.models.EstimatePoint` children in a single
  request payload.
* :class:`EstimatePointEndpoint` -- create, update, and delete a single
  :class:`~plane.db.models.EstimatePoint`; deletion can optionally
  reassign issues that reference the removed point to a different point
  before the row is dropped.

Data model contract (see :mod:`plane.db.models.estimate`):

* A project owns zero or one ACTIVE :class:`~plane.db.models.Estimate`
  via ``Project.estimate`` (FK ``on_delete=SET_NULL`` -- deleting the
  estimate nulls the project's reference but does not block the delete).
* An estimate owns N :class:`~plane.db.models.EstimatePoint` rows via
  ``Estimate.points`` (FK ``on_delete=CASCADE`` -- deleting the estimate
  cascades to its points).
* Issues reference a point via ``Issue.estimate_point`` (FK
  ``on_delete=SET_NULL`` -- deleting a point nulls the issue's point
  reference; activity rows recording the change are emitted by
  :func:`plane.bgtasks.issue_activities_task.issue_activity` Celery task,
  enqueued via RabbitMQ per architectural context).
"""

import random
import string
import json

# Django imports
from django.utils import timezone

# Third party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from ..base import BaseViewSet, BaseAPIView
from plane.app.permissions import ProjectEntityPermission, allow_permission, ROLE
from plane.db.models import Project, Estimate, EstimatePoint, Issue
from plane.app.serializers import (
    EstimateSerializer,
    EstimatePointSerializer,
    EstimateReadSerializer,
)
from plane.utils.cache import invalidate_cache
from plane.bgtasks.issue_activities_task import issue_activity


def generate_random_name(length=10):
    """Return a random lowercase-ASCII string of length ``length``.

    Used as a fallback estimate name when the client omits ``name``.
    """
    letters = string.ascii_lowercase
    return "".join(random.choice(letters) for i in range(length))


class ProjectEstimatePointEndpoint(BaseAPIView):
    """Read-only endpoint returning the active estimate points for a project.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/project-estimates/

    Request body:
        None (GET only).

    Response shape (GET):
        ``EstimatePointSerializer(many=True).data`` -- the list of points
        belonging to ``project.estimate`` if the project has an active
        estimate, otherwise an empty list ``[]`` with HTTP 200.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER])`` on
        :meth:`get` -- only admins and members of the project may read
        the estimate points (guests are denied).

    Queryset filter logic:
        Loads ``Project`` by ``workspace__slug`` + ``pk=project_id``. If
        ``project.estimate_id`` is non-null, filters
        :class:`~plane.db.models.EstimatePoint` by ``estimate_id``,
        ``project_id``, and ``workspace__slug``. Otherwise returns ``[]``
        without raising.

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Serializer: :class:`plane.app.serializers.EstimatePointSerializer`
          (``apps/api/plane/app/serializers/estimate.py``)
        * Models: :class:`plane.db.models.Project`,
          :class:`plane.db.models.EstimatePoint`
          (``apps/api/plane/db/models/``)
        * URL: ``apps/api/plane/app/urls/estimate.py``
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id):
        """Return the points of the project's active estimate, or ``[]`` if the project has no active estimate."""
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        if project.estimate_id is not None:
            estimate_points = EstimatePoint.objects.filter(
                estimate_id=project.estimate_id,
                project_id=project_id,
                workspace__slug=slug,
            )
            serializer = EstimatePointSerializer(estimate_points, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response([], status=status.HTTP_200_OK)


class BulkEstimatePointEndpoint(BaseViewSet):
    """Estimate + estimate-points batched CRUD endpoint scoped to a project.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/estimates/                      -> list
        POST   /api/workspaces/<slug>/projects/<project_id>/estimates/                      -> create
        GET    /api/workspaces/<slug>/projects/<project_id>/estimates/<estimate_id>/        -> retrieve
        PATCH  /api/workspaces/<slug>/projects/<project_id>/estimates/<estimate_id>/        -> partial_update
        DELETE /api/workspaces/<slug>/projects/<project_id>/estimates/<estimate_id>/        -> destroy

    Request body (POST):
        estimate (dict, required): Nested estimate payload.
            name (str, optional): Estimate name; defaults to a random
                10-char lowercase token from :func:`generate_random_name`.
            type (str, optional): One of ``"categories"`` or ``"points"``
                (see :class:`plane.db.models.estimate.EstimateType`);
                defaults to ``"categories"``.
            last_used (bool, optional): Marks the estimate as the most
                recently selected; defaults to ``False``.
        estimate_points (list[dict], optional): Forwarded as a list payload
            to :class:`EstimatePointSerializer` for validation. Each item:
            key (int, optional): Position key (>= 0); defaults to ``0``.
            value (str, optional): Display value (max 20 chars per the
                serializer's ``validate``); defaults to ``""``.
            description (str, optional): Free-form description; defaults
                to ``""``.

    Request body (PATCH):
        estimate (dict, optional): If present, ``name`` and ``type`` of
            the existing estimate are updated in place (other fields are
            ignored).
        estimate_points (list[dict], required, non-empty): Each item must
            have an ``id`` matching an existing
            :class:`~plane.db.models.EstimatePoint` row scoped to this
            estimate; only rows whose ``id`` appears in the payload are
            updated (their ``value`` and ``key`` are replaced). Points
            NOT in the payload are left untouched -- this endpoint does
            NOT delete missing points or create new ones; use
            :class:`EstimatePointEndpoint` for those operations.

    Response shape:
        - list      -> ``EstimateReadSerializer(many=True).data`` (nested points)
        - create    -> ``EstimateReadSerializer(estimate).data`` (nested points)
        - retrieve  -> ``EstimateReadSerializer(estimate).data``
        - partial_update -> ``EstimateReadSerializer(estimate).data``
        - destroy   -> HTTP 204 with empty body

    Permissions:
        permission_classes = [ProjectEntityPermission]
            -- declared on the class attribute (see
            ``apps/api/plane/app/views/estimate/base.py``). Workspace +
            project membership required; SAFE_METHODS require any active
            member, write methods require ADMIN or MEMBER role. See
            :class:`plane.app.permissions.project.ProjectEntityPermission`.

    Queryset filter logic:
        ``model = Estimate`` and every method filters by
        ``workspace__slug=slug`` + ``project_id=project_id`` (plus
        ``pk=estimate_id`` for detail routes). The ``list`` method
        additionally ``prefetch_related("points")`` +
        ``select_related("workspace", "project")`` to avoid N+1 reads.

    Side effects:
        ``create``, ``partial_update``, and ``destroy`` are wrapped in
        ``@invalidate_cache(path="/api/workspaces/:slug/estimates/",
        url_params=True, user=False)``, which invalidates the
        workspace-scoped estimates cache after each write. Cache backend:
        Redis (caching only -- task queueing uses RabbitMQ via Celery per
        architectural context).

    Cascade semantics on ``destroy``:
        - ``Estimate.points`` FK is ``on_delete=CASCADE`` -- deleting the
          estimate cascades to every :class:`EstimatePoint` it owns.
        - ``Project.estimate`` FK is ``on_delete=SET_NULL`` -- the parent
          project's ``estimate_id`` is set to ``NULL``.
        - ``Issue.estimate_point`` FK is ``on_delete=SET_NULL`` -- issues
          that referenced any of the cascaded points have their
          ``estimate_point_id`` set to ``NULL``. NO ``issue_activity``
          rows are emitted by this cascade path (only the
          :class:`EstimatePointEndpoint.destroy` per-point path emits
          activity events).

    Cross-references:
        * Permission: :class:`plane.app.permissions.project.ProjectEntityPermission`
          (``apps/api/plane/app/permissions/project.py``)
        * Serializers: :class:`plane.app.serializers.EstimateSerializer`,
          :class:`plane.app.serializers.EstimatePointSerializer`,
          :class:`plane.app.serializers.EstimateReadSerializer`
          (``apps/api/plane/app/serializers/estimate.py``)
        * Models: :class:`plane.db.models.Estimate`,
          :class:`plane.db.models.EstimatePoint`,
          :class:`plane.db.models.Project`,
          :class:`plane.db.models.Issue`
          (``apps/api/plane/db/models/``)
        * Cache invalidation: :func:`plane.utils.cache.invalidate_cache`
          (``apps/api/plane/utils/cache.py``)
        * URL: ``apps/api/plane/app/urls/estimate.py``
    """

    permission_classes = [ProjectEntityPermission]
    model = Estimate
    serializer_class = EstimateSerializer

    def list(self, request, slug, project_id):
        """Return every estimate for the workspace+project with its points pre-joined via ``prefetch_related``."""
        estimates = (
            Estimate.objects.filter(workspace__slug=slug, project_id=project_id)
            .prefetch_related("points")
            .select_related("workspace", "project")
        )
        serializer = EstimateReadSerializer(estimates, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @invalidate_cache(path="/api/workspaces/:slug/estimates/", url_params=True, user=False)
    def create(self, request, slug, project_id):
        """Create an :class:`Estimate` plus its initial :class:`EstimatePoint` children in one request.

        Defaults applied when the client omits values: ``name`` falls back
        to :func:`generate_random_name`, ``type`` to ``"categories"``,
        ``last_used`` to ``False``. The point list is validated through
        :class:`EstimatePointSerializer` (which rejects ``value`` longer
        than 20 chars). Points are inserted via ``bulk_create`` with
        ``batch_size=10`` and ``ignore_conflicts=True`` -- duplicate keys
        within the batch are silently dropped rather than rolled back.
        """
        estimate = request.data.get("estimate")
        estimate_name = estimate.get("name", generate_random_name())
        estimate_type = estimate.get("type", "categories")
        last_used = estimate.get("last_used", False)
        estimate = Estimate.objects.create(
            name=estimate_name,
            project_id=project_id,
            last_used=last_used,
            type=estimate_type,
        )

        estimate_points = request.data.get("estimate_points", [])

        serializer = EstimatePointSerializer(data=request.data.get("estimate_points"), many=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        estimate_points = EstimatePoint.objects.bulk_create(
            [
                EstimatePoint(
                    estimate=estimate,
                    key=estimate_point.get("key", 0),
                    value=estimate_point.get("value", ""),
                    description=estimate_point.get("description", ""),
                    project_id=project_id,
                    workspace_id=estimate.workspace_id,
                    created_by=request.user,
                    updated_by=request.user,
                )
                for estimate_point in estimate_points
            ],
            batch_size=10,
            ignore_conflicts=True,
        )

        serializer = EstimateReadSerializer(estimate)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def retrieve(self, request, slug, project_id, estimate_id):
        """Return a single estimate scoped to the workspace + project.

        Output includes nested points via :class:`EstimateReadSerializer`.
        """
        estimate = Estimate.objects.get(pk=estimate_id, workspace__slug=slug, project_id=project_id)
        serializer = EstimateReadSerializer(estimate)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @invalidate_cache(path="/api/workspaces/:slug/estimates/", url_params=True, user=False)
    def partial_update(self, request, slug, project_id, estimate_id):
        """Update the estimate's ``name``/``type`` and bulk-update the supplied points by id.

        Returns HTTP 400 when ``estimate_points`` is empty or missing.
        Only points whose ``id`` matches an incoming payload entry are
        updated (their ``value`` and ``key`` are replaced via
        ``bulk_update``); points NOT in the payload are NOT deleted and
        new points are NOT created here -- those operations live on
        :class:`EstimatePointEndpoint`.
        """
        if not len(request.data.get("estimate_points", [])):
            return Response(
                {"error": "Estimate points are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        estimate = Estimate.objects.get(pk=estimate_id, workspace__slug=slug, project_id=project_id)

        if request.data.get("estimate"):
            estimate.name = request.data.get("estimate").get("name", estimate.name)
            estimate.type = request.data.get("estimate").get("type", estimate.type)
            estimate.save()

        estimate_points_data = request.data.get("estimate_points", [])

        estimate_points = EstimatePoint.objects.filter(
            pk__in=[estimate_point.get("id") for estimate_point in estimate_points_data],
            workspace__slug=slug,
            project_id=project_id,
            estimate_id=estimate_id,
        )

        updated_estimate_points = []
        for estimate_point in estimate_points:
            # Find the data for that estimate point
            estimate_point_data = [point for point in estimate_points_data if point.get("id") == str(estimate_point.id)]
            if len(estimate_point_data):
                estimate_point.value = estimate_point_data[0].get("value", estimate_point.value)
                estimate_point.key = estimate_point_data[0].get("key", estimate_point.key)
                updated_estimate_points.append(estimate_point)

        EstimatePoint.objects.bulk_update(updated_estimate_points, ["key", "value"], batch_size=10)

        estimate_serializer = EstimateReadSerializer(estimate)
        return Response(estimate_serializer.data, status=status.HTTP_200_OK)

    @invalidate_cache(path="/api/workspaces/:slug/estimates/", url_params=True, user=False)
    def destroy(self, request, slug, project_id, estimate_id):
        """Delete the estimate (returns HTTP 204).

        Cascades to its points and nulls the parent project's ``estimate_id``.
        """
        estimate = Estimate.objects.get(pk=estimate_id, workspace__slug=slug, project_id=project_id)
        estimate.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EstimatePointEndpoint(BaseViewSet):
    """Single-row CRUD endpoint for an :class:`EstimatePoint` belonging to a project's estimate.

    HTTP methods + URL patterns:
        POST   /api/workspaces/<slug>/projects/<project_id>/estimates/<estimate_id>/estimate-points/
            -> create
        PATCH  /api/workspaces/<slug>/projects/<project_id>/estimates/<estimate_id>/estimate-points/<estimate_point_id>/
            -> partial_update
        DELETE /api/workspaces/<slug>/projects/<project_id>/estimates/<estimate_id>/estimate-points/<estimate_point_id>/
            -> destroy

    Request body (POST):
        key (int, required): Position key (>= 0).
        value (str, required): Display value (max 20 chars per the
            serializer's ``validate``).

    Request body (PATCH):
        Any partial subset accepted by
        :class:`EstimatePointSerializer` (e.g. ``key``, ``value``,
        ``description``).

    Request body (DELETE):
        new_estimate_id (UUID, optional): If provided, every
            :class:`Issue` currently referencing the point being deleted
            has its ``estimate_point_id`` reassigned to this id BEFORE
            the point is dropped. If omitted, the FK constraint
            (``Issue.estimate_point`` is ``on_delete=SET_NULL``) sets the
            affected issues' ``estimate_point_id`` to ``NULL`` as a
            side-effect of the delete.

    Response shape:
        - create         -> ``EstimatePointSerializer(estimate_point).data``
        - partial_update -> ``EstimatePointSerializer(estimate_point).data``
        - destroy        -> ``EstimatePointSerializer(updated_estimate_points, many=True).data``
                            (the renumbered tail of the points list)

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER])`` on every method
        -- only admins and members of the project may mutate points
        (``ProjectEntityPermission`` inherited via :class:`BaseViewSet`
        defaults applies the workspace+project membership check before
        the decorator).

    Side effects:
        :meth:`destroy` emits one
        :func:`plane.bgtasks.issue_activities_task.issue_activity` Celery
        task per affected :class:`Issue` (delivered through RabbitMQ per
        architectural context) recording the
        ``"issue.activity.updated"`` change in ``estimate_point``.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id, estimate_id):
        """Create a single :class:`EstimatePoint` under the estimate scope.

        Requires both ``key`` and ``value`` or returns HTTP 400.
        """
        #  TODO: add a key validation if the same key already exists
        if not request.data.get("key") or not request.data.get("value"):
            return Response(
                {"error": "Key and value are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        key = request.data.get("key", 0)
        value = request.data.get("value", "")
        estimate_point = EstimatePoint.objects.create(
            estimate_id=estimate_id, project_id=project_id, key=key, value=value
        )
        serializer = EstimatePointSerializer(estimate_point).data
        return Response(serializer, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def partial_update(self, request, slug, project_id, estimate_id, estimate_point_id):
        """Update one :class:`EstimatePoint` from a partial payload.

        Loads the point scoped to ``workspace__slug + project_id +
        estimate_id + pk``.
        """
        #  TODO: add a key validation if the same key already exists
        estimate_point = EstimatePoint.objects.get(
            pk=estimate_point_id,
            estimate_id=estimate_id,
            project_id=project_id,
            workspace__slug=slug,
        )
        serializer = EstimatePointSerializer(estimate_point, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, estimate_id, estimate_point_id):
        """Delete an :class:`EstimatePoint` and renumber the trailing points so ``key`` stays contiguous.

        Behaviour:
        1. If the body contains ``new_estimate_id``, every issue
           currently referencing the point being removed is reassigned
           via ``issues.update(estimate_point_id=new_estimate_id)`` and
           an :func:`issue_activity` Celery task is enqueued per issue.
           NOTE: the ``issues.update`` call is currently executed INSIDE
           the per-issue ``for`` loop, so it runs once per affected issue
           (functionally correct but redundant); preserved as-is per the
           no-refactoring boundary.
        2. If ``new_estimate_id`` is absent, issue-activity tasks are
           still emitted (recording the transition to ``None``) but the
           FK ``on_delete=SET_NULL`` on
           :attr:`Issue.estimate_point` is what actually clears the
           reference when the point is deleted.
        3. All remaining points whose ``key`` is greater than the removed
           point's ``key`` are decremented by 1 via ``bulk_update`` so
           the surviving keys stay contiguous.
        4. Finally the target row is deleted.

        Idempotency: NOT idempotent -- a duplicate call after the point
        has been deleted will raise (``old_estimate_point.delete()``
        called on a now-``None`` queryset result).
        """
        new_estimate_id = request.data.get("new_estimate_id", None)
        estimate_points = EstimatePoint.objects.filter(
            estimate_id=estimate_id, project_id=project_id, workspace__slug=slug
        )
        # update all the issues with the new estimate
        if new_estimate_id:
            issues = Issue.objects.filter(
                project_id=project_id,
                workspace__slug=slug,
                estimate_point_id=estimate_point_id,
            )
            for issue in issues:
                issue_activity.delay(
                    type="issue.activity.updated",
                    requested_data=json.dumps({"estimate_point": (str(new_estimate_id) if new_estimate_id else None)}),
                    actor_id=str(request.user.id),
                    issue_id=issue.id,
                    project_id=str(project_id),
                    current_instance=json.dumps(
                        {"estimate_point": (str(issue.estimate_point_id) if issue.estimate_point_id else None)}
                    ),
                    epoch=int(timezone.now().timestamp()),
                )
                issues.update(estimate_point_id=new_estimate_id)
        else:
            issues = Issue.objects.filter(
                project_id=project_id,
                workspace__slug=slug,
                estimate_point_id=estimate_point_id,
            )
            for issue in issues:
                issue_activity.delay(
                    type="issue.activity.updated",
                    requested_data=json.dumps({"estimate_point": None}),
                    actor_id=str(request.user.id),
                    issue_id=issue.id,
                    project_id=str(project_id),
                    current_instance=json.dumps(
                        {"estimate_point": (str(issue.estimate_point_id) if issue.estimate_point_id else None)}
                    ),
                    epoch=int(timezone.now().timestamp()),
                )

        # delete the estimate point
        old_estimate_point = EstimatePoint.objects.filter(pk=estimate_point_id).first()

        # rearrange the estimate points
        updated_estimate_points = []
        for estimate_point in estimate_points:
            if estimate_point.key > old_estimate_point.key:
                estimate_point.key -= 1
                updated_estimate_points.append(estimate_point)

        EstimatePoint.objects.bulk_update(updated_estimate_points, ["key"], batch_size=10)

        old_estimate_point.delete()

        return Response(
            EstimatePointSerializer(updated_estimate_points, many=True).data,
            status=status.HTTP_200_OK,
        )
