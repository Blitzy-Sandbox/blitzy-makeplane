# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Random color hex generator for default UI element tints.

Returns ``#RRGGBB`` hex strings used as default colors for newly-created
workspace members (avatar tint), labels, cycles, and modules.
"""

import random
import string


def get_random_color() -> str:
    """Return a random ``#RRGGBB`` hex color string for default tint assignment."""
    return "#" + "".join(random.choices(string.hexdigits, k=6))
