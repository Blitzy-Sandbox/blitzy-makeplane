# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Centralized exception logging helper.

Wraps the stdlib :mod:`logging` module to route exception information to the
``plane.exception`` logger with a consistent format (full traceback by
default). Centralizing the pattern ensures:

  - Consistent logger name (``plane.exception``) so log routing rules can
    match a single channel.
  - Consistent log level semantics: ERROR by default (triggers production
    alerting); pass ``warning=True`` for non-critical conditions.
  - Traceback inclusion so the JSON log formatter from :mod:`plane.celery`
    captures the full stack.

Used throughout the Plane codebase wherever a "log-and-continue" pattern is
appropriate (best-effort telemetry, optional integrations,
HTML-sanitization warnings, etc.).
"""

# Python imports
import logging
import traceback

# Django imports
from django.conf import settings


def log_exception(e, warning=False):
    """Route exception ``e`` and its traceback to the ``plane.exception`` logger.

    By default emits at ERROR level (which triggers production alerting); pass
    ``warning=True`` for non-critical conditions that should be visible in
    logs without paging on-call.

    Args:
        e: The exception instance to log.
        warning: When True, emit at WARNING level instead of ERROR.
    """
    # Log the error
    logger = logging.getLogger("plane.exception")

    if warning:
        logger.warning(str(e))
    else:
        logger.exception(e)

    if settings.DEBUG:
        logger.debug(traceback.format_exc())
    return
