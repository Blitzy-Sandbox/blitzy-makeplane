# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""HTTP 413 conversion middleware for oversized request bodies.

Defines ``RequestBodySizeLimitMiddleware``, a defensive middleware
that intercepts Django's ``RequestDataTooBig`` exception (raised when
``request.body`` is accessed and the payload exceeds
``DATA_UPLOAD_MAX_MEMORY_SIZE``) and returns a structured HTTP 413
JSON response instead of Django's default 400 Bad Request.

The size limit is sourced from
``apps/api/plane/settings/common.py:DATA_UPLOAD_MAX_MEMORY_SIZE``,
which reads the ``FILE_SIZE_LIMIT`` environment variable (default
5 MiB). The middleware is registered in MIDDLEWARE at position 11,
immediately after the standard Django stack and before the API
loggers, so the early ``request.body`` access happens before any
downstream middleware/view consumes the request stream.
"""

from django.core.exceptions import RequestDataTooBig
from django.http import JsonResponse


class RequestBodySizeLimitMiddleware:
    """Convert Django's ``RequestDataTooBig`` into HTTP 413 JSON.

    By default Django raises ``RequestDataTooBig`` lazily when a view
    or downstream middleware reads ``request.body`` past
    ``DATA_UPLOAD_MAX_MEMORY_SIZE`` (sourced from the
    ``FILE_SIZE_LIMIT`` environment variable in
    ``apps/api/plane/settings/common.py``; default 5 MiB ==
    ``5_242_880`` bytes). That eventually surfaces as a 400 Bad
    Request, which is misleading for size-limit violations. This
    middleware eagerly accesses ``request.body`` so the exception is
    raised here, then catches it and returns a structured JSON 413:

        {
            "error":  "REQUEST_BODY_TOO_LARGE",
            "detail": "The size of the request body exceeds the
                       maximum allowed size."
        }

    Reads:
        - ``request.body`` (eagerly, to trigger size validation).

    Writes:
        - On overflow: a ``JsonResponse`` with status ``413`` and
          machine-readable ``error`` plus human-readable ``detail``.
        - Otherwise: forwards to the next middleware/view unchanged.

    MIDDLEWARE position:
        Position 11 in ``apps/api/plane/settings/common.py``,
        immediately before ``APITokenLogMiddleware`` and
        ``RequestLoggerMiddleware``. The early-access strategy
        depends on this placement: it must run before any other
        component that calls ``request.body``.

    Exceptions:
        Catches ``django.core.exceptions.RequestDataTooBig`` only.
        Any other exception raised when reading ``request.body`` is
        allowed to propagate to Django's standard error handler.
    """

    def __init__(self, get_response):
        """Store the next middleware/view callable in the chain.

        Args:
            get_response: The next callable in Django's middleware
                chain, supplied at startup.
        """
        self.get_response = get_response

    def __call__(self, request):
        """Eagerly access ``request.body`` and translate overflow to 413.

        Forces Django's size-limit check up front by touching
        ``request.body``; if the payload exceeds
        ``DATA_UPLOAD_MAX_MEMORY_SIZE``, returns a JSON 413
        response. Otherwise delegates to ``self.get_response`` so
        downstream middleware/view receive an untouched request.

        Returns:
            ``HttpResponse`` from the next handler on success, or a
            ``JsonResponse`` with status ``413`` when the body is
            oversized.
        """
        try:
            _ = request.body
        except RequestDataTooBig:
            return JsonResponse(
                {
                    "error": "REQUEST_BODY_TOO_LARGE",
                    "detail": "The size of the request body exceeds the maximum allowed size.",
                },
                status=413,
            )

        # If body size is OK, continue with the request
        return self.get_response(request)
