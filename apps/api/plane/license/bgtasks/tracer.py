# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""OpenTelemetry tracing task for instance-wide and per-workspace metric collection.

This module exposes the ``instance_traces`` Celery shared task, which Plane's
licensing subsystem uses to emit periodic operational telemetry as OpenTelemetry
spans. The task is consumed by a Celery worker via RabbitMQ (the project's
async broker); Redis is used for caching and session only and is NOT involved
in task queueing.

Startup contract: this task reads the singleton ``Instance`` row plus the core
ORM models (``Workspace``, ``User``, ``Project``, ``Issue``, ``Module``,
``Cycle``, ``CycleIssue``, ``ModuleIssue``, ``Page``, ``WorkspaceMember``). The
``migrator`` container must apply Django migrations before any Celery worker
can execute the task safely.

Schedule and triggers:
    - Celery Beat: ``run-every-6-hours-for-instance-trace`` schedule entry in
      ``plane/celery.py`` (every 6 hours at minute 0,
      ``crontab(hour="*/6", minute=0)``).
    - Explicit: ``plane/license/management/commands/register_instance.py``
      invokes ``instance_traces.delay()`` after registering or refreshing the
      singleton ``Instance`` row.
"""

# Third party imports
from celery import shared_task
from opentelemetry import trace

# Module imports
from plane.license.models import Instance
from plane.db.models import (
    User,
    Workspace,
    Project,
    Issue,
    Module,
    Cycle,
    CycleIssue,
    ModuleIssue,
    Page,
    WorkspaceMember,
)
from plane.utils.telemetry import init_tracer, shutdown_tracer


@shared_task
def instance_traces():
    """Emit OpenTelemetry spans describing the Plane instance and each workspace tenant.

    Triggers:
        - Celery Beat: the ``run-every-6-hours-for-instance-trace`` schedule
          entry in ``plane/celery.py`` (``crontab(hour="*/6", minute=0)``)
          enqueues this task every 6 hours at minute 0 UTC.
        - Explicit: invoked via ``.delay()`` from
          ``plane/license/management/commands/register_instance.py`` after a
          successful instance registration or refresh.

    Side effects:
        - Initializes the OpenTelemetry tracer provider via
          ``plane.utils.telemetry.init_tracer`` (process-level singleton; safe
          to call repeatedly).
        - Reads the singleton ``Instance`` row via ``Instance.objects.first()``
          and returns early if no row exists or if
          ``instance.is_telemetry_enabled`` is ``False``.
        - Emits a single ``instance_details`` span with instance-wide aggregate
          counts of ``Workspace``, ``User``, ``Project``, ``Issue``,
          ``Module``, ``Cycle``, ``CycleIssue``, ``ModuleIssue``, ``Page`` and
          the ``Instance`` metadata attributes (``instance_id``,
          ``instance_name``, ``current_version``, ``latest_version``,
          ``is_telemetry_enabled``, ``is_support_required``, ``is_setup_done``,
          ``is_signup_screen_visited``, ``is_verified``, ``edition``,
          ``domain``, ``is_test``).
        - For each ``Workspace`` returned by ``Workspace.objects.all()``,
          emits a ``workspace_details`` span carrying the per-tenant filtered
          counts (``Project``, ``Issue``, ``Module``, ``Cycle``,
          ``CycleIssue``, ``ModuleIssue``, ``Page``, ``WorkspaceMember``) plus
          the ``instance_id``, ``workspace_id`` and ``workspace_slug``
          attributes.
        - Always calls ``shutdown_tracer()`` in a ``finally`` block so the
          ``BatchSpanProcessor`` flushes buffered spans to the OTLP collector
          before the task exits.
        - No DB writes, no emails, no webhooks, no cache invalidation: this
          task performs read-only ORM access plus outbound OTLP span emission.

    Idempotency:
        - Database layer: idempotent because only ``.count()`` reads are
          performed.
        - Telemetry sink: non-idempotent in span identity space because every
          invocation produces a fresh set of spans stamped with the current
          wall-clock timestamps; downstream telemetry aggregators should
          deduplicate or aggregate spans by ``instance_id`` and
          ``workspace_id`` as needed.
    """
    try:
        init_tracer()
        # Check if the instance is registered
        instance = Instance.objects.first()

        # If instance is None then return
        if instance is None:
            return

        if instance.is_telemetry_enabled:
            # Get the tracer
            tracer = trace.get_tracer(__name__)
            # Instance details
            with tracer.start_as_current_span("instance_details") as span:
                # Count of all models
                workspace_count = Workspace.objects.count()
                user_count = User.objects.count()
                project_count = Project.objects.count()
                issue_count = Issue.objects.count()
                module_count = Module.objects.count()
                cycle_count = Cycle.objects.count()
                cycle_issue_count = CycleIssue.objects.count()
                module_issue_count = ModuleIssue.objects.count()
                page_count = Page.objects.count()

                # Set span attributes
                span.set_attribute("instance_id", instance.instance_id)
                span.set_attribute("instance_name", instance.instance_name)
                span.set_attribute("current_version", instance.current_version)
                span.set_attribute("latest_version", instance.latest_version)
                span.set_attribute("is_telemetry_enabled", instance.is_telemetry_enabled)
                span.set_attribute("is_support_required", instance.is_support_required)
                span.set_attribute("is_setup_done", instance.is_setup_done)
                span.set_attribute("is_signup_screen_visited", instance.is_signup_screen_visited)
                span.set_attribute("is_verified", instance.is_verified)
                span.set_attribute("edition", instance.edition)
                span.set_attribute("domain", instance.domain)
                span.set_attribute("is_test", instance.is_test)
                span.set_attribute("user_count", user_count)
                span.set_attribute("workspace_count", workspace_count)
                span.set_attribute("project_count", project_count)
                span.set_attribute("issue_count", issue_count)
                span.set_attribute("module_count", module_count)
                span.set_attribute("cycle_count", cycle_count)
                span.set_attribute("cycle_issue_count", cycle_issue_count)
                span.set_attribute("module_issue_count", module_issue_count)
                span.set_attribute("page_count", page_count)

            # Workspace details
            for workspace in Workspace.objects.all():
                # Count of all models
                project_count = Project.objects.filter(workspace=workspace).count()
                issue_count = Issue.objects.filter(workspace=workspace).count()
                module_count = Module.objects.filter(workspace=workspace).count()
                cycle_count = Cycle.objects.filter(workspace=workspace).count()
                cycle_issue_count = CycleIssue.objects.filter(workspace=workspace).count()
                module_issue_count = ModuleIssue.objects.filter(workspace=workspace).count()
                page_count = Page.objects.filter(workspace=workspace).count()
                member_count = WorkspaceMember.objects.filter(workspace=workspace).count()

                # Set span attributes
                with tracer.start_as_current_span("workspace_details") as span:
                    span.set_attribute("instance_id", instance.instance_id)
                    span.set_attribute("workspace_id", str(workspace.id))
                    span.set_attribute("workspace_slug", workspace.slug)
                    span.set_attribute("project_count", project_count)
                    span.set_attribute("issue_count", issue_count)
                    span.set_attribute("module_count", module_count)
                    span.set_attribute("cycle_count", cycle_count)
                    span.set_attribute("cycle_issue_count", cycle_issue_count)
                    span.set_attribute("module_issue_count", module_issue_count)
                    span.set_attribute("page_count", page_count)
                    span.set_attribute("member_count", member_count)

        return
    finally:
        # Shutdown the tracer
        shutdown_tracer()
