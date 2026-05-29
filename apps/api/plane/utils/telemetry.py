# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""OpenTelemetry tracer bootstrap for the Plane API.

Configures the OTLP exporter targeting ``https://telemetry.plane.so`` (the
Plane-hosted anonymized telemetry collector) and registers Django request
auto-instrumentation. Two entrypoints:

  - :func:`init_tracer`     -- call once at process startup
    (``plane.wsgi`` / ``plane.asgi``).
  - :func:`shutdown_tracer` -- call on graceful shutdown to flush pending spans.

This anonymized OpenTelemetry pipeline is distinct from the in-app
event-tracking pipeline (:mod:`plane.bgtasks.event_tracking_task`), which
queues events to Celery via RabbitMQ; Redis remains caching/session only
(per AAP architectural context).
"""

# Python imports
import os
import atexit

# Third party imports
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.django import DjangoInstrumentor

# Global variable to track initialization
_TRACER_PROVIDER = None


def init_tracer():
    """Initialize OpenTelemetry with the OTLP exporter and Django auto-instrumentation.

    Idempotent -- calling twice is harmless and returns the previously
    configured provider. Invoked from ``plane.wsgi`` and ``plane.asgi`` at
    process startup. Anonymized spans are batched and exported via OTLP to
    the endpoint resolved from the ``OTLP_ENDPOINT`` environment variable,
    defaulting to ``https://telemetry.plane.so`` (the Plane-hosted
    telemetry collector). The service name reported on each span resolves
    from ``SERVICE_NAME`` (default ``plane-ce-api``).

    Side effects:
        * Installs a global :class:`opentelemetry.sdk.trace.TracerProvider`.
        * Wires a :class:`BatchSpanProcessor` around an
          :class:`OTLPSpanExporter` (gRPC transport).
        * Activates :class:`DjangoInstrumentor` so Django request/response
          spans (and downstream DB queries via instrumented ORMs, when
          present) are emitted automatically.
        * Registers :func:`shutdown_tracer` via :func:`atexit.register` to
          flush pending spans on interpreter exit.

    Returns:
        The configured :class:`TracerProvider` instance (the global one).
    """
    global _TRACER_PROVIDER

    # If already initialized, return existing provider
    if _TRACER_PROVIDER is not None:
        return _TRACER_PROVIDER

    # Configure the tracer provider
    service_name = os.environ.get("SERVICE_NAME", "plane-ce-api")
    resource = Resource.create({"service.name": service_name})
    tracer_provider = TracerProvider(resource=resource)

    # Set as global tracer provider
    trace.set_tracer_provider(tracer_provider)

    # Configure the OTLP exporter
    otel_endpoint = os.environ.get("OTLP_ENDPOINT", "https://telemetry.plane.so")
    otlp_exporter = OTLPSpanExporter(endpoint=otel_endpoint)
    span_processor = BatchSpanProcessor(otlp_exporter)
    tracer_provider.add_span_processor(span_processor)

    # Initialize Django instrumentation
    DjangoInstrumentor().instrument()

    # Store provider globally
    _TRACER_PROVIDER = tracer_provider

    # Register shutdown handler
    atexit.register(shutdown_tracer)

    return tracer_provider


def shutdown_tracer():
    """Flush pending spans and shut down the OpenTelemetry tracer provider.

    Invoked on graceful process shutdown (via :func:`atexit.register` from
    :func:`init_tracer`) to ensure no spans are dropped from the
    :class:`BatchSpanProcessor`'s queue. Idempotent -- safe to call when
    the tracer was never initialized or has already been shut down; in
    either case the global provider reference is cleared.
    """
    global _TRACER_PROVIDER

    if _TRACER_PROVIDER is not None:
        if hasattr(_TRACER_PROVIDER, "shutdown"):
            _TRACER_PROVIDER.shutdown()
        _TRACER_PROVIDER = None
