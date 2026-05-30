# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Request logging middleware for the Plane API.

Defines two project-level Django middleware classes:

* ``RequestLoggerMiddleware`` — emits a structured ``plane.api.request``
  log entry for every non-health-check HTTP request, capturing method,
  path, status, duration, client IP, user agent, and authenticated user.
* ``APITokenLogMiddleware`` — captures full request/response metadata for
  traffic carrying the ``X-Api-Key`` header and dispatches persistence to
  the ``process_logs`` Celery task (Celery via RabbitMQ; Redis is used
  for caching/session only, never for the task queue).

Both middlewares are registered in
``apps/api/plane/settings/common.py`` MIDDLEWARE: ``APITokenLogMiddleware``
sits at position 12 and ``RequestLoggerMiddleware`` at position 13 — i.e.
the two innermost project middlewares, immediately surrounding the view.
This placement ensures both have access to the final response status and
that ``APITokenLogMiddleware.__call__`` reads ``request.body`` BEFORE
the view consumes the stream.
"""

# Python imports
import logging
import time

# Django imports
from django.http import HttpRequest
from django.utils import timezone

# Third party imports
from rest_framework.request import Request

# Module imports
from plane.utils.ip_address import get_client_ip
from plane.utils.exception_logger import log_exception
from plane.bgtasks.logger_task import process_logs

api_logger = logging.getLogger("plane.api.request")


class RequestLoggerMiddleware:
    """Emit structured access logs for every Plane API request.

    The middleware wraps each request, captures wall-clock duration,
    and after the view returns emits an ``INFO`` record on the
    ``plane.api.request`` logger with structured ``extra`` fields:
    ``path``, ``method``, ``status_code``, ``duration_ms``,
    ``remote_addr``, ``user_agent``, ``user_id``. The log destination
    is whatever handler is bound to ``plane.api.request`` (stdout by
    default; consumed by the structured JSON log handler).

    Reads:
        - ``request.path``, ``request.method``, ``request.user``,
          ``request.META['HTTP_USER_AGENT']``
        - ``response.status_code``

    Writes:
        - One log entry per non-health-check request (root path
          ``GET /`` is suppressed to avoid health-check noise).

    MIDDLEWARE position:
        Position 13 (innermost project middleware before the view) in
        ``apps/api/plane/settings/common.py``. Runs last on request,
        first on response, so it observes the final status code.

    Exceptions:
        Does not catch view exceptions. If the view raises, the log
        entry for that request is skipped because ``get_response``
        re-raises before ``api_logger.info`` is reached.
    """

    def __init__(self, get_response):
        """Store the next middleware/view callable in the chain.

        Args:
            get_response: The next callable in the middleware chain,
                supplied by Django at startup.
        """
        self.get_response = get_response

    def _should_log_route(self, request: Request | HttpRequest) -> bool:
        """Return ``True`` when the request should be logged.

        Suppresses logging for the root health-check route
        (``GET /``) to keep operational logs clean; all other routes
        are logged.
        """
        # Don't log health checks
        if request.path == "/" and request.method == "GET":
            return False
        return True

    def __call__(self, request):
        """Process the request and emit one structured access log.

        Times the request, defers to the next middleware/view via
        ``self.get_response``, then on the response path emits an
        ``INFO`` ``plane.api.request`` log entry with status, latency,
        client IP, user agent, and user id (when authenticated). The
        log is skipped for the health-check route (see
        ``_should_log_route``).
        """
        # get the start time
        start_time = time.time()

        # Get the response
        response = self.get_response(request)

        # calculate the duration
        duration = time.time() - start_time

        # Check if logging is required
        log_true = self._should_log_route(request=request)

        # If logging is not required, return the response
        if not log_true:
            return response

        user_id = (
            request.user.id if getattr(request, "user") and getattr(request.user, "is_authenticated", False) else None
        )

        user_agent = request.META.get("HTTP_USER_AGENT", "")

        # Log the request information
        api_logger.info(
            f"{request.method} {request.get_full_path()} {response.status_code}",
            extra={
                "path": request.path,
                "method": request.method,
                "status_code": response.status_code,
                "duration_ms": int(duration * 1000),
                "remote_addr": get_client_ip(request),
                "user_agent": user_agent,
                "user_id": user_id,
            },
        )

        # return the response
        return response


class APITokenLogMiddleware:
    """Audit-log requests that carry an ``X-Api-Key`` header.

    Captures full request/response metadata for traffic authenticated
    via Plane's external API tokens and persists the audit record
    asynchronously via the ``process_logs`` Celery task. The task is
    queued through RabbitMQ (Celery broker) — Redis is used for
    caching and sessions only, never for task queueing. The persisted
    record lands in the ``APIActivityLog`` Postgres table when MongoDB
    is not configured, and in the MongoDB ``api_activity`` collection
    when it is (see ``plane.bgtasks.logger_task.process_logs``).

    Reads:
        - ``request.body`` (eagerly, BEFORE the view consumes it),
          ``request.headers['X-Api-Key']``, ``request.path``,
          ``request.method``, ``request.META['QUERY_STRING']``,
          ``request.META['HTTP_USER_AGENT']``, ``request.user``
        - ``response.content``, ``response.status_code``

    Writes:
        - Enqueues a ``process_logs.delay(...)`` Celery task carrying
          a sanitized log payload (Celery via RabbitMQ). No database
          writes occur on the request thread; persistence is
          off-loaded so request latency is unaffected.

    MIDDLEWARE position:
        Position 12 in ``apps/api/plane/settings/common.py``, directly
        before ``RequestLoggerMiddleware`` (innermost). Reads
        ``request.body`` at the start of ``__call__`` so the body is
        captured BEFORE the wrapped view consumes the request stream.

    Exceptions:
        All exceptions raised during log preparation are caught and
        routed through ``log_exception``; they NEVER propagate into
        the response path, guaranteeing logging cannot break a
        request.
    """

    def __init__(self, get_response):
        """Store the next middleware/view callable in the chain.

        Args:
            get_response: The next callable in the middleware chain.
        """
        self.get_response = get_response

    def __call__(self, request):
        """Capture ``request.body`` early, then audit-log on response.

        Reads ``request.body`` BEFORE forwarding to the next callable
        to ensure the bytes are captured before the view consumes the
        stream (Django request streams are read-once). After the
        response is produced, ``process_request`` is invoked
        unconditionally — it short-circuits when no ``X-Api-Key`` is
        present.
        """
        request_body = request.body
        response = self.get_response(request)
        self.process_request(request, response, request_body)
        return response

    def _safe_decode_body(self, content):
        """Decode request/response body bytes for log persistence.

        Returns ``None`` for empty or missing content, the literal
        string ``"[Binary Content]"`` when known binary file signatures
        (PNG / JPEG / PDF) are detected, ``"[Could not decode content]"``
        when UTF-8 decoding fails, and the decoded UTF-8 string
        otherwise.
        """
        # If the content is None, return None
        if content is None:
            return None

        # If the content is an empty bytes object, return None
        if content == b"":
            return None

        # Check if content is binary by looking for common binary file signatures
        if content.startswith(b"\x89PNG") or content.startswith(b"\xff\xd8\xff") or content.startswith(b"%PDF"):
            return "[Binary Content]"

        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return "[Could not decode content]"

    def process_request(self, request, response, request_body):
        """Build an audit log payload and enqueue it via Celery.

        Short-circuits when the request has no ``X-Api-Key`` header.
        Otherwise assembles a Postgres-shaped payload (``log_data``)
        and a MongoDB-shaped payload (``mongo_log``) that includes
        ``created_at`` / ``updated_at`` / ``created_by`` / ``updated_by``
        attribution fields. Both payloads are forwarded to the
        ``process_logs`` Celery task via ``.delay(...)`` (Celery broker:
        RabbitMQ). Exceptions are swallowed via ``log_exception`` so
        the request path is never interrupted by logging failures.
        """
        api_key_header = "X-Api-Key"
        api_key = request.headers.get(api_key_header)

        # If the API key is not present, return
        if not api_key:
            return

        try:
            log_data = {
                "token_identifier": api_key,
                "path": request.path,
                "method": request.method,
                "query_params": request.META.get("QUERY_STRING", ""),
                "headers": str(request.headers),
                "body": self._safe_decode_body(request_body) if request_body else None,
                "response_body": self._safe_decode_body(response.content) if response.content else None,
                "response_code": response.status_code,
                "ip_address": get_client_ip(request=request),
                "user_agent": request.META.get("HTTP_USER_AGENT", None),
            }
            user_id = (
                str(request.user.id)
                if getattr(request, "user") and getattr(request.user, "is_authenticated", False)
                else None
            )
            # Additional fields for MongoDB
            mongo_log = {
                **log_data,
                "created_at": timezone.now(),
                "updated_at": timezone.now(),
                "created_by": user_id,
                "updated_by": user_id,
            }

            process_logs.delay(log_data=log_data, mongo_log=mongo_log)

        except Exception as e:
            log_exception(e)

        return None
