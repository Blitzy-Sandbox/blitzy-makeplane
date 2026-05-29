# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Lightweight HTML tag stripping for plain-text extraction.

Distinct from :mod:`plane.utils.content_validator` (which sanitizes
user-submitted HTML for safe storage/rendering): this module strips ALL tags
to yield plain text, used for search snippet generation and plain-text
excerpts in notifications.

Implementation: subclasses Python's built-in :class:`html.parser.HTMLParser`
and accumulates text via ``handle_data`` so the parser handles malformed
markup gracefully without dragging in a heavier dependency.
"""

from io import StringIO
from html.parser import HTMLParser


class MLStripper(HTMLParser):
    """``HTMLParser`` subclass that accumulates only text content, discarding all tags.

    Used by :func:`strip_tags` to produce plain text from arbitrary HTML.
    Not intended for sanitization (which is what :mod:`plane.utils.content_validator`
    is for); only for text extraction.
    """

    def __init__(self):
        """Initialize an empty in-memory text buffer and enable character-reference conversion."""
        super().__init__()
        self.reset()
        self.strict = False
        self.convert_charrefs = True
        self.text = StringIO()

    def handle_data(self, d):
        """Append a raw text chunk emitted by the parser to the accumulated buffer."""
        self.text.write(d)

    def get_data(self):
        """Return the full accumulated text content collected during parsing."""
        return self.text.getvalue()


def strip_tags(html):
    """Return the visible text content of an HTML string with all tags removed."""
    s = MLStripper()
    s.feed(html)
    return s.get_data()
