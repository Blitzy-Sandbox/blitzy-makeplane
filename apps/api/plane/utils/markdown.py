# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared :class:`mistune.Markdown` parser instance.

Mistune ``Markdown`` is thread-safe for read-only use and instantiation has
non-trivial overhead, so a single module-level singleton is reused across
the codebase rather than constructing per-call.

Consumers: notification email templates, page export pipeline, comment
rendering preview.
"""

import mistune

markdown = mistune.Markdown()
