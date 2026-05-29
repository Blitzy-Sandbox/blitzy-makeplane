# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Reserved workspace slug list.

Enumerates slug strings that CANNOT be registered as a workspace slug
because they would collide with frontend routes, API namespaces, or
reserved keywords in the URL space. Workspace creation rejects any slug
matching :data:`RESTRICTED_WORKSPACE_SLUGS`.

Three categories of restriction are covered:

  1. Frontend route collisions (``api``, ``404``, ``accounts``,
     ``god-mode``, ``installations``, ``magic-sign-in``, ``onboarding``, ...).
  2. API namespace collisions (``api-v2``, ``instances``, ``monitoring``, ...).
  3. Reserved keywords (``admin``, ``assets``, ``auth``, ``create-workspace``,
     ``error``, ``god``, ...).

Consumers: the workspace creation serializer and the workspace slug-change
endpoint in ``plane.app.views.workspace.*``.

Backwards compatibility: additions are safe; removals risk creating
user-workspace slugs that would shadow routes — prefer to leave entries in
this list even when the underlying route is removed.
"""

RESTRICTED_WORKSPACE_SLUGS = [
    "404",
    "accounts",
    "api",
    "create-workspace",
    "god-mode",
    "installations",
    "invitations",
    "onboarding",
    "profile",
    "spaces",
    "workspace-invitations",
    "password",
    "flags",
    "monitor",
    "monitoring",
    "ingest",
    "plane-pro",
    "plane-ultimate",
    "enterprise",
    "plane-enterprise",
    "disco",
    "silo",
    "chat",
    "calendar",
    "drive",
    "channels",
    "upgrade",
    "billing",
    "sign-in",
    "sign-up",
    "signin",
    "signup",
    "config",
    "live",
    "admin",
    "m",
    "import",
    "importers",
    "integrations",
    "integration",
    "configuration",
    "initiatives",
    "initiative",
    "config",
    "workflow",
    "workflows",
    "epics",
    "epic",
    "story",
    "mobile",
    "dashboard",
    "desktop",
    "onload",
    "real-time",
    "one",
    "pages",
    "mobile",
    "business",
    "pro",
    "settings",
    "monitor",
    "license",
    "licenses",
    "instances",
    "instance",
]
