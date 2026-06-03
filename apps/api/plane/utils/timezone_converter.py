# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Timezone conversion helpers.

Plane stores all timestamps in UTC; each ``Project`` carries a string
timezone field (``Project.timezone``, e.g., ``"Asia/Kolkata"``) that is
used for display and for date-range filters that must respect
project-local-time semantics (for example, "issues completed today").

Three helpers:
  - :func:`user_timezone_converter` -- convert named datetime fields on
    every row of a queryset/result list to a user-supplied timezone.
  - :func:`convert_to_utc` -- parse a date STRING in the project's
    configured timezone and return its UTC datetime. Defaults to
    end-of-day so ``<=date`` filters are inclusive of the full local
    day; pass ``is_start_date=True`` for start-of-day semantics used
    by ``>=date`` filters.
  - :func:`convert_utc_to_project_timezone` -- convert a UTC datetime
    to the timezone configured on the named project.

Migrator startup contract: :func:`convert_to_utc` and
:func:`convert_utc_to_project_timezone` perform runtime
``Project.objects.get(...)`` lookups; the ``migrator`` container runs
Django migrations before API services start, so the ``Project`` schema
is always available at request time.

Consumers: ``plane.app.views.cycle.*``, ``plane.app.views.module.*``,
``plane.app.views.issue.*``, and any endpoint that emits dates in the
response payload.
"""

# Python imports
import pytz
from datetime import datetime, time
from datetime import timedelta

# Django imports
from django.utils import timezone

# Module imports
from plane.db.models import Project


def user_timezone_converter(queryset, datetime_fields, user_timezone):
    """Convert UTC datetime fields on a queryset's rows to ``user_timezone``.

    Mutates each row's named fields to localized timezone-aware
    datetimes in-place and returns the modified row list. Used by
    endpoints that emit user-facing timestamps formatted in the
    requester's preferred zone. Accepts either a single ``dict`` row
    or an iterable of ``dict`` rows and returns the same shape.
    """
    # Create a timezone object for the user's timezone
    user_tz = pytz.timezone(user_timezone)

    # Check if queryset is a dictionary (single item) or a list of dictionaries
    if isinstance(queryset, dict):
        queryset_values = [queryset]
    else:
        queryset_values = list(queryset)

    # Iterate over the dictionaries in the list
    for item in queryset_values:
        # Iterate over the datetime fields
        for field in datetime_fields:
            # Convert the datetime field to the user's timezone
            if field in item and item[field]:
                item[field] = item[field].astimezone(user_tz)

    # If queryset was a single item, return a single item
    if isinstance(queryset, dict):
        return queryset_values[0]
    else:
        return queryset_values


def convert_to_utc(date, project_id, is_start_date=False):
    """Parse a ``YYYY-MM-DD`` string in the project's timezone and return its UTC datetime.

    By default the time-of-day component is end-of-day so that
    ``<=date`` filters are inclusive of the entire local day. Pass
    ``is_start_date=True`` to use start-of-day semantics for ``>=date``
    filters; when the resulting localized start matches the project's
    current local date, the current UTC time is returned instead so
    that "starts today" filters do not match historical rows. The
    project's timezone string is fetched from ``Project.timezone``
    via the supplied ``project_id``.
    """
    # Retrieve the project's timezone using the project ID
    project = Project.objects.get(id=project_id)
    project_timezone = project.timezone
    if not date or not project_timezone:
        raise ValueError("Both date and timezone must be provided.")

    # Parse the string into a date object
    start_date = datetime.strptime(date, "%Y-%m-%d").date()

    # Get the project's timezone
    local_tz = pytz.timezone(project_timezone)

    # Combine the date with 12:00 AM time
    local_datetime = datetime.combine(start_date, time.min)

    # Localize the datetime to the project's timezone
    localized_datetime = local_tz.localize(local_datetime)

    # If it's an start date, add one minute
    if is_start_date:
        localized_datetime += timedelta(minutes=0, seconds=1)

        # Convert the localized datetime to UTC
        utc_datetime = localized_datetime.astimezone(pytz.utc)

        current_datetime_in_project_tz = timezone.now().astimezone(local_tz)
        current_datetime_in_utc = current_datetime_in_project_tz.astimezone(pytz.utc)

        if localized_datetime.date() == current_datetime_in_project_tz.date():
            return current_datetime_in_utc

        return utc_datetime
    else:
        # the cycle end date is the last minute of the day
        localized_datetime += timedelta(hours=23, minutes=59, seconds=0)

        # Convert the localized datetime to UTC
        utc_datetime = localized_datetime.astimezone(pytz.utc)

        # Return the UTC datetime for storage
        return utc_datetime


def convert_utc_to_project_timezone(utc_datetime, project_id):
    """Convert a UTC datetime to the timezone configured on the given project.

    Naive inputs (``tzinfo is None``) are first localized as UTC so
    that the subsequent ``astimezone`` call produces a correctly
    shifted local datetime rather than reinterpreting wall-clock time.
    """
    # Retrieve the project's timezone using the project ID
    project = Project.objects.get(id=project_id)
    project_timezone = project.timezone
    if not project_timezone:
        raise ValueError("Project timezone must be provided.")

    # Get the timezone object for the project's timezone
    local_tz = pytz.timezone(project_timezone)

    # Convert the UTC datetime to the project's local timezone
    if utc_datetime.tzinfo is None:
        # Localize UTC datetime if it's naive (i.e., without timezone info)
        utc_datetime = pytz.utc.localize(utc_datetime)

    # Convert to the project's local timezone
    local_datetime = utc_datetime.astimezone(local_tz)

    return local_datetime
