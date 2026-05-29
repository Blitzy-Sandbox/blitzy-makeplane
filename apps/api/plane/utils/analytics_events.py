# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Canonical event-name string constants for workspace analytics.

Used by :mod:`plane.bgtasks.event_tracking_task` to emit consistent event
names across the codebase so the analytics consumer sees a stable
vocabulary.

Events are queued to Celery (brokered by RabbitMQ per AAP §0.2.2), not via
Redis. Naming convention: ``<entity>_<verb>`` (e.g., ``workspace_created``,
``workspace_updated``) matching the user-facing action.
"""

USER_JOINED_WORKSPACE = "user_joined_workspace"
USER_INVITED_TO_WORKSPACE = "user_invited_to_workspace"
WORKSPACE_CREATED = "workspace_created"
WORKSPACE_DELETED = "workspace_deleted"
