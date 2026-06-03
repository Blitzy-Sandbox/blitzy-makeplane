# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Submodule auto-import helper.

Walks every submodule under a Python package and imports it into a supplied
namespace so side-effect-registering modules — Django signal handlers
(``@receiver``), Celery task definitions (``@shared_task``), DRF routers —
are loaded at app boot rather than on first request.

Used by ``plane.bgtasks`` ``AppConfig.ready()`` to eagerly import every
``*_task.py`` module so Celery can dispatch to them.
"""

import pkgutil
import six


def import_submodules(context, root_module, path):
    """Eagerly import every submodule under ``root_module`` and bind it into ``context``.

    Used so side-effect-registering modules (signal handlers wired by
    ``@receiver``, Celery task definitions, DRF routers) are loaded at app
    boot rather than on first request.

    Args:
        context: Destination namespace (typically ``globals()``).
        root_module: Dotted import path of the parent package
            (e.g., ``"plane.bgtasks"``).
        path: Filesystem path of the parent package (``__path__``).
    """
    for loader, module_name, is_pkg in pkgutil.walk_packages(path, root_module + "."):
        # this causes a Runtime error with model conflicts
        # module = loader.find_module(module_name).load_module(module_name)
        module = __import__(module_name, globals(), locals(), ["__name__"])
        for k, v in six.iteritems(vars(module)):
            if not k.startswith("_"):
                context[k] = v
        context[module_name] = module
