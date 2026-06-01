# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django app package marker for the ``plane.analytics`` app.

Declares the ``plane.analytics`` Python package so Django can load its
``AppConfig`` (see ``apps.py``), which is registered in ``INSTALLED_APPS``
at ``plane.settings.common``. The package itself exposes no runtime
symbols; analytics endpoints and aggregation logic live under
``plane.app.views.analytic`` and are routed via ``plane.app.urls.analytic``.
"""
