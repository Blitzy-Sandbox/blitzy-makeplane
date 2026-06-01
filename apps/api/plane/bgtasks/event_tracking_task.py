# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that ships analytics events to PostHog with workspace grouping.

Trigger: explicit ``track_event.delay(...)`` from numerous workspace and
project view endpoints (e.g., workspace settings updates, member
invitations, workspace deletions, project creation) and from
``apps/api/plane/authentication/utils/workspace_project_join.py``.

External integration: events are POSTed to the configured PostHog
endpoint (``POSTHOG_HOST``) using ``POSTHOG_API_KEY``. This is a
**telemetry only** integration; nothing in Plane's runtime state depends
on PostHog availability -- a missing/invalid key short-circuits emission
without raising.

Async infrastructure: queued onto **RabbitMQ** and consumed by Celery
workers (per the architectural rule that RabbitMQ is the task broker;
Redis is used only for caching and session state).
"""

import logging
import os
import uuid
from typing import Dict, Any

# third party imports
from celery import shared_task
from posthog import Posthog

# module imports
from plane.license.utils.instance_value import get_configuration_value
from plane.utils.exception_logger import log_exception
from plane.db.models import Workspace
from plane.utils.analytics_events import USER_INVITED_TO_WORKSPACE, WORKSPACE_DELETED


logger = logging.getLogger("plane.worker")


def posthogConfiguration():
    """Return the active PostHog ``(API key, host)`` tuple or ``(None, None)`` when telemetry is unconfigured.

    Credentials are sourced via :func:`get_configuration_value`, which
    prefers the instance configuration stored in the database (set in
    the admin console) and falls back to the matching environment
    variables (``POSTHOG_API_KEY``, ``POSTHOG_HOST``). Returning
    ``(None, None)`` is the documented signal used by
    :func:`track_event` to suppress event emission entirely without
    raising.
    """
    POSTHOG_API_KEY, POSTHOG_HOST = get_configuration_value(
        [
            {
                "key": "POSTHOG_API_KEY",
                "default": os.environ.get("POSTHOG_API_KEY", None),
            },
            {
                "key": "POSTHOG_HOST",
                "default": os.environ.get("POSTHOG_HOST", None),
            },
        ]
    )
    if POSTHOG_API_KEY and POSTHOG_HOST:
        return POSTHOG_API_KEY, POSTHOG_HOST
    else:
        return None, None


def preprocess_data_properties(
    user_id: uuid.UUID, event_name: str, slug: str, data_properties: Dict[str, Any]
) -> Dict[str, Any]:
    """Augment ``data_properties`` with the caller's workspace role for membership-lifecycle events.

    For ``USER_INVITED_TO_WORKSPACE`` and ``WORKSPACE_DELETED`` events
    only, a ``role`` key is injected: ``"owner"`` if ``user_id``
    matches ``Workspace.owner_id`` for the workspace identified by
    ``slug``, ``"admin"`` otherwise, or ``"unknown"`` when the
    workspace cannot be found. For all other event names the mapping
    is returned unchanged. The lookup is a single
    ``Workspace.objects.get`` read; no rows are written.
    """
    if event_name == USER_INVITED_TO_WORKSPACE or event_name == WORKSPACE_DELETED:
        try:
            # Check if the current user is the workspace owner
            workspace = Workspace.objects.get(slug=slug)
            if str(workspace.owner_id) == str(user_id):
                data_properties["role"] = "owner"
            else:
                data_properties["role"] = "admin"
        except Workspace.DoesNotExist:
            logger.warning(f"Workspace {slug} does not exist while sending event {event_name} for user {user_id}")
            data_properties["role"] = "unknown"

    return data_properties


@shared_task
def track_event(user_id: uuid.UUID, event_name: str, slug: str, event_properties: Dict[str, Any]):
    """Capture a PostHog analytics event with workspace grouping.

    Trigger:
        Explicit ``track_event.delay(...)`` from workspace and project
        view endpoints (e.g., workspace settings updates, member
        invitations, workspace deletions, project creation) and from
        ``apps/api/plane/authentication/utils/workspace_project_join.py``.
        The Celery message is routed via **RabbitMQ** and consumed by
        the worker.

    Args:
        user_id: UUID of the user performing the action; serialized to
            a string and sent as PostHog ``distinct_id``.
        event_name: Symbolic event identifier (see
            ``plane.utils.analytics_events``).
        slug: Workspace slug used both for role lookup and as the
            PostHog ``"workspace"`` group key.
        event_properties: Free-form payload attached to the event; may
            be augmented by :func:`preprocess_data_properties` for
            membership-lifecycle events.

    Side effects:
        - **External call**: ``posthog.capture(distinct_id, event,
          properties, groups={"workspace": slug})`` sends one HTTP
          request to the PostHog ingestion endpoint.
        - **Special pre-processing**:
            * ``USER_INVITED_TO_WORKSPACE`` -- augments ``properties``
              with the inviter's role information before capture.
            * ``WORKSPACE_DELETED`` -- augments ``properties`` with the
              owner / admin role context before capture.
        - **No** DB writes (a read-only ``Workspace.objects.get`` may
          fire during role pre-processing). **No** emails. **No**
          webhook fan-out. **No** cache invalidation.
        - Returns silently when PostHog credentials are absent and
          returns ``False`` when ``posthog.capture`` raises.

    Idempotency:
        NON-idempotent. Each invocation produces one PostHog event;
        duplicate invocations inflate event counts in PostHog
        dashboards. PostHog can deduplicate on ``properties.uuid`` if
        set, but this task does not set such a key by default.
    """
    POSTHOG_API_KEY, POSTHOG_HOST = posthogConfiguration()

    if not (POSTHOG_API_KEY and POSTHOG_HOST):
        logger.warning("Event tracking is not configured")
        return

    try:
        # preprocess the data properties for massaging the payload
        # in the correct format for posthog
        data_properties = preprocess_data_properties(user_id, event_name, slug, event_properties)
        groups = {
            "workspace": slug,
        }
        # track the event using posthog
        posthog = Posthog(POSTHOG_API_KEY, host=POSTHOG_HOST)
        posthog.capture(distinct_id=str(user_id), event=event_name, properties=data_properties, groups=groups)
    except Exception as e:
        log_exception(e)
        return False
