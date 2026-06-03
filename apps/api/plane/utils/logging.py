# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Log handler combining size-based and time-based rotation triggers.

The stdlib provides :class:`logging.handlers.RotatingFileHandler` (size only)
and :class:`logging.handlers.TimedRotatingFileHandler` (time only) but not a
combined trigger. :class:`SizedTimedRotatingFileHandler` fills that gap so
the Plane API can rotate on whichever condition fires first, preventing both
the "disk fills between rotations during a traffic spike" failure mode of
pure time-based rotation and the "stale logs kept forever during quiet
periods" failure mode of pure size-based rotation.

Paired with the JSON log formatter installed by :mod:`plane.celery` and the
``LOGGING`` dictConfig in :mod:`plane.settings.common`.
"""

import logging.handlers as handlers
import time


class SizedTimedRotatingFileHandler(handlers.TimedRotatingFileHandler):
    """Log handler that rotates when EITHER a size limit OR a time interval is exceeded.

    Combines the rotation triggers of stdlib
    :class:`logging.handlers.RotatingFileHandler` (size) and
    :class:`logging.handlers.TimedRotatingFileHandler` (time). Long-running
    API services need both: time-based rotation alone can fill the disk
    during traffic spikes; size-based rotation alone can keep stale logs
    forever during quiet periods.

    Constructor arguments mirror :class:`TimedRotatingFileHandler` with the
    addition of ``maxBytes``: when the current file would exceed
    ``maxBytes`` after appending the next record, rollover is triggered
    immediately regardless of the time interval.

    Paired with the JSON log formatter installed by :mod:`plane.celery` and
    the ``LOGGING`` dictConfig in :mod:`plane.settings.common`.
    """

    def __init__(
        self,
        filename,
        maxBytes=0,
        backupCount=0,
        encoding=None,
        delay=0,
        when="h",
        interval=1,
        utc=False,
    ):
        """Initialize the handler with ``TimedRotatingFileHandler`` arguments and ``maxBytes`` size threshold."""
        handlers.TimedRotatingFileHandler.__init__(self, filename, when, interval, backupCount, encoding, delay, utc)
        self.maxBytes = maxBytes

    def shouldRollover(self, record):
        """Return a truthy value when either the size threshold or the time-interval rotation condition is met."""
        if self.stream is None:  # delay was set...
            self.stream = self._open()
        if self.maxBytes > 0:  # are we rolling over?
            msg = "%s\n" % self.format(record)
            # due to non-posix-compliant Windows feature
            self.stream.seek(0, 2)
            if self.stream.tell() + len(msg) >= self.maxBytes:
                return 1
        t = int(time.time())
        if t >= self.rolloverAt:
            return 1
        return 0
