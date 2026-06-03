# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django ``AppConfig`` for the ``plane.middleware`` package.

Registers the project-level middleware modules
(``db_routing``, ``logger``, ``request_body_size``) as a first-class
Django app so Django's app registry can resolve them by the canonical
label ``"plane.middleware"``. This module is referenced indirectly
via the ``MIDDLEWARE`` list in
``apps/api/plane/settings/common.py``; the ``AppConfig`` itself does
not perform any startup work and has no ``ready()`` hook.
"""

from django.apps import AppConfig


class Middleware(AppConfig):
    """Django ``AppConfig`` for the ``plane.middleware`` package.

    The ``name`` attribute is the canonical dotted path Django uses
    during app-registry population and ``INSTALLED_APPS`` scanning.
    No custom ``ready()`` / ``label`` / ``verbose_name`` overrides
    exist; the class exists solely to register the directory as a
    Django app so its middleware classes can be referenced by string
    in the ``MIDDLEWARE`` setting.
    """

    name = "plane.middleware"
