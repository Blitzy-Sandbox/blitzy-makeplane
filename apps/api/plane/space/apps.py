# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django ``AppConfig`` for the ``plane.space`` application.

The space app exposes the anonymous public read surface for published project
boards (deploy boards), mounted under ``api/public/`` by the root URLconf
(see ``apps/api/plane/urls.py``). This ``AppConfig`` only registers the app's
canonical dotted name with the Django app registry; it does NOT install
signal handlers or define a ``ready()`` hook, so no schema-dependent boot
logic runs from this module and the app does not participate in the migrator
startup ordering contract.
"""

from django.apps import AppConfig


class SpaceConfig(AppConfig):
    """Application configuration for the public space (``api/public/``) surface.

    Sets the canonical app dotted-path to ``plane.space`` so Django's app
    registry resolves ORM models, signal targets, and URL namespace lookups
    correctly. No ``ready()`` hook is defined, meaning there are no signal
    connections or boot-time wiring originating from this class.
    """

    name = "plane.space"
