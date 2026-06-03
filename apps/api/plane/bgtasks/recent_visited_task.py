# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that upserts per-user recent-visit records for entity tracking.

Worker module for :func:`recent_visited_task`, invoked via ``.delay(...)``
from entity-detail view base classes (``apps/api/plane/app/views/project/
base.py``, ``apps/api/plane/app/views/cycle/base.py``,
``apps/api/plane/app/views/module/base.py``,
``apps/api/plane/app/views/issue/base.py``,
``apps/api/plane/app/views/page/base.py``,
``apps/api/plane/app/views/view/base.py``) when a user opens an entity
detail page. The resulting ``UserRecentVisit`` rows feed the home
dashboard's "Recents" surface and are read back by the workspace
recent-visit ViewSet at
``apps/api/plane/app/views/workspace/recent_visit.py``.

Async infrastructure: messages are queued onto **RabbitMQ** and consumed
by Celery workers (per the project-wide "Celery via RabbitMQ"
architectural rule). Redis is **not** the task broker -- it is reserved
for caching and session storage.
"""

# Python imports
from django.utils import timezone
from django.db import DatabaseError

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import UserRecentVisit, Workspace
from plane.utils.exception_logger import log_exception


@shared_task
def recent_visited_task(entity_name, entity_identifier, user_id, project_id, slug):
    """Upsert a ``UserRecentVisit`` row for the (user, entity) tuple.

    Implements a manual upsert with a soft 20-row LRU cap per
    ``(user, workspace)``: an existing row has ``visited_at`` refreshed
    in place; otherwise a new row is inserted, evicting the oldest
    ``UserRecentVisit`` for the user in the workspace (across *all*
    entity types) when twenty entries are already present.

    Trigger:
        Explicit ``recent_visited_task.delay(slug=..., entity_name=...,
        entity_identifier=..., user_id=..., project_id=...)`` from
        entity-detail view base classes when a user opens a ``project``,
        ``cycle``, ``module``, ``issue``, ``page``, or ``view``. The
        Celery message is routed via **RabbitMQ** and consumed by the
        worker pool.

    Args:
        entity_name: Entity discriminator string -- one of
            ``"project"``, ``"cycle"``, ``"module"``, ``"issue"``,
            ``"page"``, or ``"view"``.
        entity_identifier: Primary key (UUID) of the visited entity.
        user_id: Primary key of the visiting user.
        project_id: Project primary key; may be ``None`` for
            workspace-scoped entities such as workspace-level views.
        slug: Workspace slug; resolved to ``workspace_id`` via a
            ``Workspace.objects.get(slug=slug)`` lookup.

    Side effects:
        - **DB write**: refresh of ``UserRecentVisit.visited_at`` on an
          existing row via ``save(update_fields=["visited_at"])``. The
          inner save is wrapped in a ``DatabaseError`` catch that
          silently swallows transient DB unavailability.
        - **DB write**: insertion of a new ``UserRecentVisit`` row when
          no match exists, with ``created_by_id`` and ``updated_by_id``
          stamped with ``user_id``.
        - **DB delete**: when the user already holds twenty
          ``UserRecentVisit`` rows in the workspace (counted across
          *all* entity types), the oldest row (ascending
          ``created_at``) is deleted before the new insert (LRU
          eviction).
        - **No** emails. **No** webhook fan-out. **No** cache
          invalidation.

    Idempotency:
        Idempotent at the row level. Repeated invocations with the
        same arguments only refresh ``visited_at`` on the existing
        row; they never create duplicate entries for the same
        ``(user, workspace, project, entity_name, entity_identifier)``
        tuple. Safe to retry on worker failure.

    Returns:
        ``None``. All exceptions are caught and reported via
        :func:`plane.utils.exception_logger.log_exception` (best-effort
        telemetry); the task never re-raises.
    """
    try:
        workspace = Workspace.objects.get(slug=slug)
        recent_visited = UserRecentVisit.objects.filter(
            entity_name=entity_name,
            entity_identifier=entity_identifier,
            user_id=user_id,
            project_id=project_id,
            workspace_id=workspace.id,
        ).first()

        if recent_visited:
            # Check if the database is available
            try:
                recent_visited.visited_at = timezone.now()
                recent_visited.save(update_fields=["visited_at"])
            except DatabaseError:
                pass
        else:
            recent_visited_count = UserRecentVisit.objects.filter(user_id=user_id, workspace_id=workspace.id).count()
            if recent_visited_count == 20:
                recent_visited = (
                    UserRecentVisit.objects.filter(user_id=user_id, workspace_id=workspace.id)
                    .order_by("created_at")
                    .first()
                )
                recent_visited.delete()

            recent_activity = UserRecentVisit.objects.create(
                entity_name=entity_name,
                entity_identifier=entity_identifier,
                user_id=user_id,
                visited_at=timezone.now(),
                project_id=project_id,
                workspace_id=workspace.id,
            )
            recent_activity.created_by_id = user_id
            recent_activity.updated_by_id = user_id
            recent_activity.save(update_fields=["created_by_id", "updated_by_id"])

        return
    except Exception as e:
        log_exception(e)
        return
