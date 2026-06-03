# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery tasks that build and email analytics CSV reports.

Two ``@shared_task`` callables live here:

1. ``analytic_export_task`` — builds a CSV from analytics aggregations
   (uses :func:`plane.utils.analytics_plot.build_graph_plot` to compute
   the distribution rows) and ships the result via SMTP through
   :func:`send_export_email`.
2. ``export_analytics_to_csv_email`` — a reusable CSV-emailer that takes
   a pre-formed tabular payload (``data``, ``headers``, ``keys``) and
   emails it as a CSV attachment through the same SMTP path.

Trigger: ``analytic_export_task`` is invoked via explicit
``analytic_export_task.delay(...)`` from
``AnalyticExportEndpoint.post`` in
``apps/api/plane/app/views/analytic/base.py`` when a workspace member
requests an analytics export.

Supported aggregation axes (used for both the ``x_axis`` and the
optional ``segment`` parameters in the request payload):

- ``assignees__id`` (rendered as assignee display name)
- ``labels__id`` (rendered as label name)
- ``state_id`` (rendered as state name)
- ``issue_cycle__cycle_id`` (rendered as cycle name)
- ``issue_module__module_id`` (rendered as module name)

Async infrastructure: each ``@shared_task`` here is queued onto
**RabbitMQ** and consumed by Celery workers. Redis is the cache /
session store only — it is **not** the task broker for this module
(per the architectural rule documented in
``apps/api/plane/celery.py``).
"""

# Python imports
import csv
import io
import logging

# Third party imports
from celery import shared_task

# Django imports
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string
from django.db.models import Q, Case, Value, When
from django.db import models
from django.db.models.functions import Concat

# Module imports
from plane.db.models import Issue
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.analytics_plot import build_graph_plot
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception
from plane.utils.issue_filters import issue_filters
from plane.utils.csv_utils import sanitize_csv_row

row_mapping = {
    "state__name": "State",
    "state__group": "State Group",
    "labels__id": "Label",
    "assignees__id": "Assignee Name",
    "start_date": "Start Date",
    "target_date": "Due Date",
    "completed_at": "Completed At",
    "created_at": "Created At",
    "issue_count": "Issue Count",
    "priority": "Priority",
    "estimate": "Estimate",
    "issue_cycle__cycle_id": "Cycle",
    "issue_module__module_id": "Module",
}

ASSIGNEE_ID = "assignees__id"
LABEL_ID = "labels__id"
STATE_ID = "state_id"
CYCLE_ID = "issue_cycle__cycle_id"
MODULE_ID = "issue_module__module_id"


def send_export_email(email, slug, csv_buffer, rows):
    """Send the rendered CSV to ``email`` as an attachment via the instance SMTP backend."""
    subject = "Your Export is ready"
    html_content = render_to_string("emails/exports/analytics.html", {})
    text_content = generate_plain_text_from_html(html_content)

    csv_buffer.seek(0)

    (
        EMAIL_HOST,
        EMAIL_HOST_USER,
        EMAIL_HOST_PASSWORD,
        EMAIL_PORT,
        EMAIL_USE_TLS,
        EMAIL_USE_SSL,
        EMAIL_FROM,
    ) = get_email_configuration()

    connection = get_connection(
        host=EMAIL_HOST,
        port=int(EMAIL_PORT),
        username=EMAIL_HOST_USER,
        password=EMAIL_HOST_PASSWORD,
        use_tls=EMAIL_USE_TLS == "1",
        use_ssl=EMAIL_USE_SSL == "1",
    )

    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_content,
        from_email=EMAIL_FROM,
        to=[email],
        connection=connection,
    )
    msg.attach(f"{slug}-analytics.csv", csv_buffer.getvalue())
    msg.send(fail_silently=False)
    return


def get_assignee_details(slug, filters):
    """Fetch assignee details if required."""
    return (
        Issue.issue_objects.filter(
            Q(Q(assignees__avatar__isnull=False) | Q(assignees__avatar_asset__isnull=False)),
            workspace__slug=slug,
            **filters,
        )
        .annotate(
            assignees__avatar_url=Case(
                # If `avatar_asset` exists, use it to generate the asset URL
                When(
                    assignees__avatar_asset__isnull=False,
                    then=Concat(
                        Value("/api/assets/v2/static/"),
                        "assignees__avatar_asset",  # Assuming avatar_asset has an id or relevant field
                        Value("/"),
                    ),
                ),
                # If `avatar_asset` is None, fall back to using `avatar` field directly
                When(assignees__avatar_asset__isnull=True, then="assignees__avatar"),
                default=Value(None),
                output_field=models.CharField(),
            )
        )
        .distinct("assignees__id")
        .order_by("assignees__id")
        .values(
            "assignees__avatar_url",
            "assignees__display_name",
            "assignees__first_name",
            "assignees__last_name",
            "assignees__id",
        )
    )


def get_label_details(slug, filters):
    """Fetch label details if required."""
    return (
        Issue.objects.filter(
            workspace__slug=slug,
            **filters,
            labels__id__isnull=False,
            label_issue__deleted_at__isnull=True,
        )
        .distinct("labels__id")
        .order_by("labels__id")
        .values("labels__id", "labels__color", "labels__name")
    )


def get_state_details(slug, filters):
    """Fetch distinct ``(state_id, state__name, state__color)`` rows for the workspace and filter set."""
    return (
        Issue.issue_objects.filter(workspace__slug=slug, **filters)
        .distinct("state_id")
        .order_by("state_id")
        .values("state_id", "state__name", "state__color")
    )


def get_module_details(slug, filters):
    """Fetch distinct ``(module_id, module name)`` rows for the workspace and filter set."""
    return (
        Issue.issue_objects.filter(
            workspace__slug=slug,
            **filters,
            issue_module__module_id__isnull=False,
            issue_module__deleted_at__isnull=True,
        )
        .distinct("issue_module__module_id")
        .order_by("issue_module__module_id")
        .values("issue_module__module_id", "issue_module__module__name")
    )


def get_cycle_details(slug, filters):
    """Fetch distinct ``(cycle_id, cycle name)`` rows for the workspace and filter set."""
    return (
        Issue.issue_objects.filter(
            workspace__slug=slug,
            **filters,
            issue_cycle__cycle_id__isnull=False,
            issue_cycle__deleted_at__isnull=True,
        )
        .distinct("issue_cycle__cycle_id")
        .order_by("issue_cycle__cycle_id")
        .values("issue_cycle__cycle_id", "issue_cycle__cycle__name")
    )


def generate_csv_from_rows(rows):
    """Generate CSV buffer from rows."""
    csv_buffer = io.StringIO()
    writer = csv.writer(csv_buffer, delimiter=",", quoting=csv.QUOTE_ALL)
    [writer.writerow(sanitize_csv_row(row)) for row in rows]
    return csv_buffer


def generate_segmented_rows(
    distribution,
    x_axis,
    y_axis,
    segment,
    key,
    assignee_details,
    label_details,
    state_details,
    cycle_details,
    module_details,
):
    """Build CSV rows for a segmented (matrix) distribution: rows by ``x_axis``, columns by ``segment``.

    The header row holds the ``x_axis`` label, the ``y_axis`` label, and
    one column per distinct ``segment`` value. Where ``x_axis`` or
    ``segment`` is an id axis (``assignees__id``, ``labels__id``,
    ``state_id``, ``issue_cycle__cycle_id``, ``issue_module__module_id``)
    the raw id is swapped for the display name resolved from the matching
    ``*_details`` lookup table.
    """
    segment_zero = list(set(item.get("segment") for sublist in distribution.values() for item in sublist))

    segmented = segment

    row_zero = [
        row_mapping.get(x_axis, "X-Axis"),
        row_mapping.get(y_axis, "Y-Axis"),
    ] + segment_zero

    rows = []
    for item, data in distribution.items():
        generated_row = [
            item,
            sum(obj.get(key) for obj in data if obj.get(key) is not None),
        ]

        for segment in segment_zero:
            value = next((x.get(key) for x in data if x.get("segment") == segment), "0")
            generated_row.append(value)

        if x_axis == ASSIGNEE_ID:
            assignee = next(
                (user for user in assignee_details if str(user[ASSIGNEE_ID]) == str(item)),
                None,
            )
            if assignee:
                generated_row[0] = f"{assignee['assignees__first_name']} {assignee['assignees__last_name']}"

        if x_axis == LABEL_ID:
            label = next((lab for lab in label_details if str(lab[LABEL_ID]) == str(item)), None)

            if label:
                generated_row[0] = f"{label['labels__name']}"

        if x_axis == STATE_ID:
            state = next((sta for sta in state_details if str(sta[STATE_ID]) == str(item)), None)

            if state:
                generated_row[0] = f"{state['state__name']}"

        if x_axis == CYCLE_ID:
            cycle = next((cyc for cyc in cycle_details if str(cyc[CYCLE_ID]) == str(item)), None)

            if cycle:
                generated_row[0] = f"{cycle['issue_cycle__cycle__name']}"

        if x_axis == MODULE_ID:
            module = next(
                (mod for mod in module_details if str(mod[MODULE_ID]) == str(item)),
                None,
            )

            if module:
                generated_row[0] = f"{module['issue_module__module__name']}"

        rows.append(tuple(generated_row))

    if segmented == ASSIGNEE_ID:
        for index, segm in enumerate(row_zero[2:]):
            assignee = next(
                (user for user in assignee_details if str(user[ASSIGNEE_ID]) == str(segm)),
                None,
            )
            if assignee:
                row_zero[index + 2] = f"{assignee['assignees__first_name']} {assignee['assignees__last_name']}"

    if segmented == LABEL_ID:
        for index, segm in enumerate(row_zero[2:]):
            label = next((lab for lab in label_details if str(lab[LABEL_ID]) == str(segm)), None)
            if label:
                row_zero[index + 2] = label["labels__name"]

    if segmented == STATE_ID:
        for index, segm in enumerate(row_zero[2:]):
            state = next((sta for sta in state_details if str(sta[STATE_ID]) == str(segm)), None)
            if state:
                row_zero[index + 2] = state["state__name"]

    if segmented == MODULE_ID:
        for index, segm in enumerate(row_zero[2:]):
            module = next((mod for mod in label_details if str(mod[MODULE_ID]) == str(segm)), None)
            if module:
                row_zero[index + 2] = module["issue_module__module__name"]

    if segmented == CYCLE_ID:
        for index, segm in enumerate(row_zero[2:]):
            cycle = next((cyc for cyc in cycle_details if str(cyc[CYCLE_ID]) == str(segm)), None)
            if cycle:
                row_zero[index + 2] = cycle["issue_cycle__cycle__name"]

    return [tuple(row_zero)] + rows


def generate_non_segmented_rows(
    distribution,
    x_axis,
    y_axis,
    key,
    assignee_details,
    label_details,
    state_details,
    cycle_details,
    module_details,
):
    """Build CSV rows for a non-segmented distribution: a two-column ``(x_axis, y_axis)`` layout.

    Each distribution bucket becomes one row containing the ``x_axis``
    value and its single ``y_axis`` measure (``count`` when ``y_axis ==
    "issue_count"``, ``estimate`` otherwise). Where ``x_axis`` is an id
    axis the raw id is swapped for the display name resolved from the
    matching ``*_details`` lookup table.
    """
    rows = []
    for item, data in distribution.items():
        row = [item, data[0].get("count" if y_axis == "issue_count" else "estimate")]

        if x_axis == ASSIGNEE_ID:
            assignee = next(
                (user for user in assignee_details if str(user[ASSIGNEE_ID]) == str(item)),
                None,
            )
            if assignee:
                row[0] = f"{assignee['assignees__first_name']} {assignee['assignees__last_name']}"

        if x_axis == LABEL_ID:
            label = next((lab for lab in label_details if str(lab[LABEL_ID]) == str(item)), None)

            if label:
                row[0] = f"{label['labels__name']}"

        if x_axis == STATE_ID:
            state = next((sta for sta in state_details if str(sta[STATE_ID]) == str(item)), None)

            if state:
                row[0] = f"{state['state__name']}"

        if x_axis == CYCLE_ID:
            cycle = next((cyc for cyc in cycle_details if str(cyc[CYCLE_ID]) == str(item)), None)

            if cycle:
                row[0] = f"{cycle['issue_cycle__cycle__name']}"

        if x_axis == MODULE_ID:
            module = next(
                (mod for mod in module_details if str(mod[MODULE_ID]) == str(item)),
                None,
            )

            if module:
                row[0] = f"{module['issue_module__module__name']}"

        rows.append(tuple(row))

    row_zero = [row_mapping.get(x_axis, "X-Axis"), row_mapping.get(y_axis, "Y-Axis")]
    return [tuple(row_zero)] + rows


@shared_task
def analytic_export_task(email, data, slug):
    """Build an analytics CSV from the requested aggregation and email it to the user.

    Trigger:
        Explicit ``analytic_export_task.delay(email=..., data=...,
        slug=...)`` from ``AnalyticExportEndpoint.post`` in
        ``apps/api/plane/app/views/analytic/base.py`` when a workspace
        member requests an analytics export. The Celery message is
        routed via **RabbitMQ** and consumed by the worker.

    Args:
        email: Recipient address — usually ``request.user.email`` of
            the user who triggered the export.
        data: Request payload mapping. Reads ``x_axis``, ``y_axis``,
            and the optional ``segment`` keys; the remaining keys are
            forwarded to :func:`plane.utils.issue_filters.issue_filters`
            as the ``Issue`` queryset filter predicate. ``x_axis`` and
            ``segment`` must each be one of the supported axes (see
            module docstring).
        slug: Workspace slug used both to scope the ``Issue`` queryset
            (``workspace__slug=slug``) and to name the attachment
            (``<slug>-analytics.csv``).

    Side effects:
        - **DB read**: filters ``Issue.issue_objects`` by the parsed
          predicates and feeds the queryset to
          :func:`plane.utils.analytics_plot.build_graph_plot`, which
          groups by ``x_axis`` (and optionally ``segment``) to compute
          the distribution rows. Where an axis requires display labels
          (assignee name, label name, state name, cycle name, module
          name) a second distinct query is issued via the matching
          ``get_*_details`` helper.
        - **In-memory**: assembles the CSV body via
          :func:`generate_segmented_rows` (when ``segment`` is truthy)
          or :func:`generate_non_segmented_rows` (otherwise) and
          renders it through :func:`generate_csv_from_rows`.
        - **External (SMTP)**: calls :func:`send_export_email`, which
          dispatches one ``EmailMultiAlternatives`` message with the
          rendered ``<slug>-analytics.csv`` attached via the
          instance-configured SMTP backend returned by
          :func:`plane.license.utils.instance_value.get_email_configuration`.
        - **No** chained Celery task, **no** webhook fan-out, **no**
          cache invalidation, **no** DB writes.
        - Any exception is caught and forwarded to
          :func:`plane.utils.exception_logger.log_exception`; the
          requesting user does not receive a failure notification.

    Idempotency:
        NON-idempotent. Each invocation rebuilds the CSV from the
        current DB snapshot and sends a fresh outbound email; duplicate
        invocations result in duplicate emails to ``email``.
    """
    try:
        filters = issue_filters(data, "POST")
        queryset = Issue.issue_objects.filter(**filters, workspace__slug=slug)

        x_axis = data.get("x_axis", False)
        y_axis = data.get("y_axis", False)
        segment = data.get("segment", False)

        distribution = build_graph_plot(queryset, x_axis=x_axis, y_axis=y_axis, segment=segment)
        key = "count" if y_axis == "issue_count" else "estimate"

        assignee_details = (
            get_assignee_details(slug, filters) if x_axis == ASSIGNEE_ID or segment == ASSIGNEE_ID else {}
        )

        label_details = get_label_details(slug, filters) if x_axis == LABEL_ID or segment == LABEL_ID else {}

        state_details = get_state_details(slug, filters) if x_axis == STATE_ID or segment == STATE_ID else {}

        cycle_details = get_cycle_details(slug, filters) if x_axis == CYCLE_ID or segment == CYCLE_ID else {}

        module_details = get_module_details(slug, filters) if x_axis == MODULE_ID or segment == MODULE_ID else {}

        if segment:
            rows = generate_segmented_rows(
                distribution,
                x_axis,
                y_axis,
                segment,
                key,
                assignee_details,
                label_details,
                state_details,
                cycle_details,
                module_details,
            )
        else:
            rows = generate_non_segmented_rows(
                distribution,
                x_axis,
                y_axis,
                key,
                assignee_details,
                label_details,
                state_details,
                cycle_details,
                module_details,
            )

        csv_buffer = generate_csv_from_rows(rows)
        send_export_email(email, slug, csv_buffer, rows)
        logging.getLogger("plane.worker").info("Email sent successfully.")
        return
    except Exception as e:
        log_exception(e)
        return


@shared_task
def export_analytics_to_csv_email(data, headers, keys, email, slug):
    """Email a generic tabular payload to ``email`` as a CSV attachment.

    Trigger:
        Explicit ``export_analytics_to_csv_email.delay(...)``. The
        Celery message is routed via **RabbitMQ** and consumed by the
        worker.

        # INTENT UNCLEAR: defined as a public ``@shared_task`` but has
        # no callers in ``apps/api/`` at the time of writing — appears
        # to be a reusable CSV emailer kept available for analytics
        # export paths whose rows are already materialised upstream.

    Args:
        data: Iterable of dict-like rows. Each row is projected to a
            CSV row via ``item.get(key, "")`` for every key in ``keys``.
        headers: Column headers; written as the first CSV row.
        keys: Ordered keys used to project each ``data`` row into the
            CSV.
        email: Recipient address.
        slug: Workspace slug; used to name the attachment
            (``<slug>-analytics.csv``).

    Side effects:
        - **In-memory**: builds the CSV body via
          :func:`generate_csv_from_rows`.
        - **External (SMTP)**: calls :func:`send_export_email`, which
          dispatches one ``EmailMultiAlternatives`` message via the
          instance-configured SMTP backend returned by
          :func:`plane.license.utils.instance_value.get_email_configuration`.
        - **No** DB writes, **no** webhook fan-out, **no** cache
          invalidation.
        - Any exception is caught and forwarded to
          :func:`plane.utils.exception_logger.log_exception`; the
          recipient does not receive a failure notification.

    Idempotency:
        NON-idempotent. Each invocation produces one outbound email.
    """
    try:
        """
        Prepares a CSV from data and sends it as an email attachment.

        Parameters:
        - data: List of dictionaries (e.g. from .values())
        - headers: List of CSV column headers
        - keys: Keys to extract from each data item (dict)
        - email: Email address to send to
        - slug: Used for the filename
        """
        # Prepare rows: header + data rows
        rows = [headers]
        for item in data:
            row = [item.get(key, "") for key in keys]
            rows.append(row)

        # Generate CSV buffer
        csv_buffer = generate_csv_from_rows(rows)

        # Send email with CSV attachment
        send_export_email(email=email, slug=slug, csv_buffer=csv_buffer, rows=rows)
    except Exception as e:
        log_exception(e)
        return
