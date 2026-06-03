# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Package marker for the ``plane.space`` Django application.

This module is intentionally inert: it contains no imports, no re-exports, and
no runtime side effects, so importing ``plane.space`` is side-effect-free and
the package's import boundary stays predictable.

The ``plane.space`` app owns the anonymous public read surface for published
project boards (deploy boards); the root URLconf mounts ``plane.space.urls``
under ``api/public/`` so many endpoints in this package serve unauthenticated
traffic for published space pages.
"""
