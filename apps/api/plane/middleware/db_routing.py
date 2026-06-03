# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database routing middleware for read-replica selection.

Decides per request whether ORM queries should be routed to the
PostgreSQL read replica or the primary database. Routing is controlled
by HTTP method and by the optional ``use_read_replica`` attribute on
the resolved view function/class. The middleware writes per-request
state into the thread/async-local context provided by
``plane.utils.core.request_scope``; the router
(``plane.utils.core.dbrouters.ReadReplicaRouter``) reads that state to
pick a database alias.

MIDDLEWARE position:
    Conditionally appended at the END of MIDDLEWARE in
    ``apps/api/plane/settings/common.py`` when a read replica is
    configured (see the ``DATABASE_ROUTERS`` setup block). Because it
    is the innermost middleware, ``process_view`` runs after URL
    resolution and the resolved view callable is available.

Cross-references:
    - ``ReadReplicaControlMixin``
      (``apps/api/plane/utils/core/mixins/view.py``) — the mixin used by
      ``BaseViewSet`` / ``BaseAPIView``
      (``apps/api/plane/app/views/base.py``) to expose
      ``use_read_replica`` on the view class.
"""

import logging
from typing import Callable, Optional

from django.http import HttpRequest, HttpResponse

from plane.utils.core import (
    set_use_read_replica,
    clear_read_replica_context,
)

logger = logging.getLogger("plane.api")


class ReadReplicaRoutingMiddleware:
    """Route read-only requests to the PostgreSQL read replica.

    Per-request routing rules:

    * Non-read methods (POST / PUT / PATCH / DELETE) — always primary.
    * Read methods (GET / HEAD / OPTIONS):
        - View exposes ``use_read_replica = True`` — read replica.
        - View exposes ``use_read_replica = False`` — primary.
        - View does NOT expose ``use_read_replica`` — primary
          (safe default; explicit opt-in is required).

    The middleware supports Django CBVs (via ``view_func.view_class``),
    DRF ``APIView`` / ``ViewSet`` wrappers (via ``view_func.cls``), and
    function-based views (attribute directly on ``view_func``).

    Reads:
        - ``request.method``, ``request.path``
        - ``view_func.use_read_replica`` /
          ``view_func.view_class.use_read_replica`` /
          ``view_func.cls.use_read_replica``

    Writes:
        - Per-request thread/async-local flag via
          ``set_use_read_replica`` (consumed by
          ``ReadReplicaRouter.db_for_read``).
        - Always clears the flag in ``__call__``'s ``finally`` block
          and in ``process_exception`` to prevent context leakage
          between requests.

    MIDDLEWARE position:
        Appended LAST in MIDDLEWARE when ``DATABASE_ROUTERS`` is
        configured (innermost). This positioning is required so
        ``process_view`` sees the resolved view callable after Django
        URL resolution.

    Exceptions:
        Catches no exceptions; only cleans up routing context in
        ``process_exception`` and re-raises by returning ``None``.
    """

    # HTTP methods that are considered read-only by default
    READ_ONLY_METHODS = {"GET", "HEAD", "OPTIONS"}

    def __init__(self, get_response):
        """Store the next middleware/view callable in the chain.

        Args:
            get_response: The next callable in Django's middleware
                chain, supplied at startup.
        """
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        """Apply write-path routing and guarantee context cleanup.

        For write methods (POST / PUT / PATCH / DELETE) the read-replica
        flag is set to ``False`` immediately so any pre-view ORM work
        also hits the primary. Read methods are resolved later in
        ``process_view`` once Django has identified the view callable.
        The ``try/finally`` guarantees the per-request flag is cleared
        after every response, even if the view raises.

        Args:
            request: The incoming Django ``HttpRequest``.

        Returns:
            The ``HttpResponse`` produced by the next middleware/view.
        """
        # For non-read operations, set primary database immediately
        if request.method not in self.READ_ONLY_METHODS:
            set_use_read_replica(False)
            logger.debug(f"Routing {request.method} {request.path} to primary database")

        try:
            # Process the request through the middleware chain
            response = self.get_response(request)
            return response
        finally:
            # Always clean up context, even if an exception occurs
            # This prevents context leakage between requests
            clear_read_replica_context()

    def process_view(
        self,
        request: HttpRequest,
        view_func: Callable,
        view_args: tuple,
        view_kwargs: dict,
    ) -> None:
        """Resolve read-replica routing for read methods only.

        Read URL resolution happens in this Django middleware hook
        because the resolved view callable is available, avoiding
        duplicate URL-resolution work in ``__call__``. Write methods
        are handled earlier in ``__call__``; this hook is a no-op for
        them.

        Args:
            request: The HTTP request being processed.
            view_func: The view function/callable Django will invoke.
            view_args: Positional arguments destined for the view.
            view_kwargs: Keyword arguments destined for the view.

        Returns:
            ``None`` — signal Django to continue with normal view
            dispatch.
        """
        # Only process read operations (write operations already handled in __call__)
        if request.method in self.READ_ONLY_METHODS:
            use_replica = self._should_use_read_replica(view_func)
            set_use_read_replica(use_replica)

            db_type = "read replica" if use_replica else "primary database"
            logger.debug(f"Routing {request.method} {request.path} to {db_type}")

        # Return None to continue normal request processing
        return None

    def _should_use_read_replica(self, view_func: Callable) -> bool:
        """Decide whether ``view_func`` opts in to the read replica.

        Defaults to ``False`` (primary database) when no
        ``use_read_replica`` attribute is found, requiring explicit
        opt-in. The lookup honors function-based views, Django CBVs,
        and DRF view wrappers (see ``_get_use_replica_attribute``).

        Args:
            view_func: The view callable Django will dispatch to.

        Returns:
            ``True`` if the view opted in to replica reads; ``False``
            otherwise.
        """
        use_replica_attr = self._get_use_replica_attribute(view_func)

        # Default to primary database for GET requests if no explicit setting
        # This ensures only views that explicitly opt-in use read replicas
        if use_replica_attr is None:
            return False

        return bool(use_replica_attr)

    def _get_use_replica_attribute(self, view_func: Callable) -> Optional[bool]:
        """Extract the ``use_read_replica`` attribute from a view.

        Resolves the attribute across three view-wrapper styles in
        order: function-based view, Django CBV
        (``view_func.view_class``), DRF view (``view_func.cls``).
        Returns ``None`` when the attribute is absent on every style.

        Args:
            view_func: The view callable to inspect.

        Returns:
            The boolean value of ``use_read_replica`` if present, else
            ``None``.
        """
        # Return None if view_func is None to prevent AttributeError
        if view_func is None:
            return None

        # Check function-based view attribute
        use_replica = getattr(view_func, "use_read_replica", None)
        if use_replica is not None:
            return use_replica

        # Check Django CBV wrapper
        if hasattr(view_func, "view_class"):
            use_replica = getattr(view_func.view_class, "use_read_replica", None)
            if use_replica is not None:
                return use_replica

        # Check DRF wrapper (APIView / ViewSet)
        if hasattr(view_func, "cls"):
            use_replica = getattr(view_func.cls, "use_read_replica", None)
            if use_replica is not None:
                return use_replica

        return None

    def process_exception(self, request: HttpRequest, exception: Exception) -> None:
        """Clear read-replica context when the view raises.

        Provides a safety net in addition to the ``try/finally`` block
        in ``__call__`` so the per-request flag never leaks into the
        next request. Returns ``None`` so the exception continues to
        propagate to the next handler.

        Args:
            request: The HTTP request that failed.
            exception: The exception raised during view execution.

        Returns:
            ``None`` — do not handle the exception.
        """
        # Clean up context on exception as a safety measure
        # The try/finally in __call__ should handle most cases, but this
        # provides extra protection specifically for view exceptions
        clear_read_replica_context()
        logger.debug(f"Cleaned up read replica context due to exception: {type(exception).__name__}")

        # Return None to let the exception continue propagating
        return None
