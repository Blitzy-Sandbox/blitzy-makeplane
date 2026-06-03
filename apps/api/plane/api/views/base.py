# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Foundational view classes for the external ``/api/v1/`` API.

This module defines the shared mixins and base classes every endpoint in
``plane.api.views`` inherits from:

- :class:`TimezoneMixin` -- activates the requesting user's timezone for
  the duration of a request so timezone-aware ORM expressions render in
  the caller's locale.
- :class:`BaseAPIView` -- the standard ``APIView`` base for non-ViewSet
  endpoints. Wires in API-key authentication, ``IsAuthenticated``,
  ``ApiKeyRateThrottle``, the read-replica control mixin, a uniform
  exception handler that maps Django/DRF errors to JSON responses, and
  helper properties for URL kwargs and query parameters.
- :class:`BaseViewSet` -- the ``ModelViewSet`` analogue with the same
  authentication / throttle / read-replica wiring.

Every endpoint authenticates via the ``X-Api-Key`` header (see
:class:`plane.api.middleware.api_authentication.APIKeyAuthentication`).
The matching :class:`~plane.db.models.APIToken` row must be
``is_active=True`` and either unexpired or with no expiry configured.

Startup contract:
    These classes are imported at Django startup. The ``migrator``
    container runs Django migrations before this module is imported,
    so by the time these classes resolve their ``GenericAPIView`` and
    ``ModelViewSet`` parents the database schema is guaranteed to be
    up-to-date. The :class:`~plane.db.models.APIToken` table that
    authentication queries against is therefore present before the
    first request is served.
"""

# Python imports
import zoneinfo
import logging

# Django imports
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import IntegrityError
from django.urls import resolve
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from rest_framework.exceptions import APIException
from rest_framework.generics import GenericAPIView

# Module imports
from plane.db.models.api import APIToken
from plane.api.middleware.api_authentication import APIKeyAuthentication
from plane.api.rate_limit import ApiKeyRateThrottle, ServiceTokenRateThrottle
from plane.utils.exception_logger import log_exception
from plane.utils.paginator import BasePaginator
from plane.utils.core.mixins import ReadReplicaControlMixin


logger = logging.getLogger("plane.api")


class TimezoneMixin:
    """Activate the requesting user's timezone for the request lifecycle.

    Applied first in the MRO so that any timezone-aware ORM expressions
    (e.g. ``timezone.now()`` substituted with the user's tz) inside the
    handler render in the caller's locale. Falls back to
    ``timezone.deactivate()`` -- i.e. the project default tz -- for
    anonymous requests or any request whose user has no
    ``user_timezone`` configured.
    """

    def initial(self, request, *args, **kwargs):
        """Activate ``request.user.user_timezone`` before the handler runs.

        Called by DRF's request lifecycle just after authentication and
        permission checks; the activation is a no-op for anonymous
        requests, in which case the project-default timezone applies.
        """
        super().initial(request, *args, **kwargs)
        if request.user.is_authenticated:
            timezone.activate(zoneinfo.ZoneInfo(request.user.user_timezone))
        else:
            timezone.deactivate()


class BaseAPIView(TimezoneMixin, GenericAPIView, ReadReplicaControlMixin, BasePaginator):
    """Standard ``APIView`` base for ``/api/v1/`` endpoints.

    MRO: ``TimezoneMixin`` -> ``GenericAPIView`` -> ``ReadReplicaControlMixin``
    -> ``BasePaginator``.

    Default class attributes:
        authentication_classes = ``[APIKeyAuthentication]``
            Validates the ``X-Api-Key`` header against an active,
            non-expired :class:`~plane.db.models.APIToken` row. See
            :mod:`plane.api.middleware.api_authentication`.
        permission_classes = ``[IsAuthenticated]``
            Subclasses typically narrow this to a more specific class
            from :mod:`plane.app.permissions` (for example
            ``ProjectBasePermission`` or ``WorkSpaceAdminPermission``).
        use_read_replica = ``False``
            Subclasses set this to ``True`` for read-heavy endpoints so
            queries are dispatched to the read replica via
            :class:`plane.middleware.db_routing.ReadReplicaRoutingMiddleware`.
            ``False`` is the safe default because ViewSets that read-
            and-write in the same request cannot tolerate replication
            lag.

    Throttling:
        :meth:`get_throttles` selects ``ServiceTokenRateThrottle``
        (300 req/min) when the resolved ``APIToken`` row has
        ``is_service=True``; otherwise ``ApiKeyRateThrottle``
        (60 req/min) applies. See :mod:`plane.api.rate_limit`.

    Filter pipeline:
        :meth:`filter_queryset` walks ``self.filter_backends`` and
        applies each backend in registration order. Typical backends
        configured on subclasses are ``DjangoFilterBackend``,
        ``SearchFilter``, and ``OrderingFilter``.

    Exception handling:
        :meth:`handle_exception` maps the common Django/DRF errors to
        uniform JSON responses (see the method's docstring for the
        mapping table). Unmatched exceptions return ``HTTP 500`` with
        a generic error payload to avoid leaking internal state; the
        underlying exception is forwarded to
        :func:`plane.utils.exception_logger.log_exception`.

    Helper properties:
        :attr:`workspace_slug`, :attr:`project_id`, :attr:`fields`, and
        :attr:`expand` provide ergonomic access to URL kwargs and query
        parameters frequently used by subclass handlers.

    Response finalization:
        :meth:`finalize_response` augments the outgoing response with
        ``X-RateLimit-Remaining`` and ``X-RateLimit-Reset`` headers --
        read from ``request.META`` where the throttle classes stamp
        them -- so API clients can self-throttle.
    """

    authentication_classes = [APIKeyAuthentication]

    permission_classes = [IsAuthenticated]

    use_read_replica = False

    def filter_queryset(self, queryset):
        """Apply each registered ``filter_backend`` to ``queryset`` in order.

        Mirrors the standard :class:`~rest_framework.generics.GenericAPIView`
        filter pipeline so that the backends declared on the subclass
        (typically ``DjangoFilterBackend``, ``SearchFilter``, and
        ``OrderingFilter``) run before the handler executes.
        """
        for backend in list(self.filter_backends):
            queryset = backend().filter_queryset(self.request, queryset, self)
        return queryset

    def get_throttles(self):
        """Pick a per-request throttle based on the calling API token kind.

        Resolves the request's ``X-Api-Key`` header to its
        :class:`~plane.db.models.APIToken` row: service tokens
        (``is_service=True``) bypass the standard quota and use
        :class:`~plane.api.rate_limit.ServiceTokenRateThrottle`
        (300 req/min); every other token uses
        :class:`~plane.api.rate_limit.ApiKeyRateThrottle`
        (60 req/min). The lookup runs once per request because the same
        endpoint may be invoked by either kind of token.
        """
        throttle_classes = []
        api_key = self.request.headers.get("X-Api-Key")

        if api_key:
            service_token = APIToken.objects.filter(token=api_key, is_service=True).first()

            if service_token:
                throttle_classes.append(ServiceTokenRateThrottle())
                return throttle_classes

        throttle_classes.append(ApiKeyRateThrottle())

        return throttle_classes

    def handle_exception(self, exc):
        """Translate Django/DRF errors into uniform JSON responses.

        Mapping:

        =========================  =====  ============================================
        Exception class            HTTP   Response body
        =========================  =====  ============================================
        ``IntegrityError``         400    ``{"error": "The payload is not valid"}``
        ``ValidationError``        400    ``{"error": "Please provide valid detail"}``
        ``ObjectDoesNotExist``     404    ``{"error": "The requested resource does
                                          not exist."}``
        ``KeyError``               400    ``{"error": "The required key does not
                                          exist."}``
        anything else              500    ``{"error": "Something went wrong please
                                          try again later"}``
        =========================  =====  ============================================

        The generic ``500`` fallback avoids leaking exception detail to
        API clients; the original exception is forwarded to
        :func:`plane.utils.exception_logger.log_exception` for
        observability. The first ``try`` block delegates to DRF's own
        ``handle_exception`` so authentication, permission, and
        ``rest_framework.exceptions.APIException`` subclasses retain
        their standard rendering; only exceptions that escape DRF's
        handler are remapped here.
        """
        try:
            response = super().handle_exception(exc)
            return response
        except Exception as e:
            if isinstance(e, IntegrityError):
                return Response(
                    {"error": "The payload is not valid"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if isinstance(e, ValidationError):
                return Response(
                    {"error": "Please provide valid detail"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if isinstance(e, ObjectDoesNotExist):
                return Response(
                    {"error": "The requested resource does not exist."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if isinstance(e, KeyError):
                return Response(
                    {"error": "The required key does not exist."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            log_exception(e)
            return Response(
                {"error": "Something went wrong please try again later"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def dispatch(self, request, *args, **kwargs):
        """Run the DRF request lifecycle and emit a debug query summary.

        Delegates to ``super().dispatch`` for the standard DRF flow and,
        when ``settings.DEBUG`` is true, prints ``request.method``, the
        full URL, and the count of executed SQL queries to aid local
        development. Any exception raised by the super-call is routed
        through :meth:`handle_exception`.
        """
        try:
            response = super().dispatch(request, *args, **kwargs)
            if settings.DEBUG:
                from django.db import connection

                print(f"{request.method} - {request.get_full_path()} of Queries: {len(connection.queries)}")
            return response
        except Exception as exc:
            response = self.handle_exception(exc)
            return exc

    def finalize_response(self, request, response, *args, **kwargs):
        """Augment the response with rate-limit headers.

        Reads the current throttle bucket state from ``request.META``
        (stamped by the throttle classes in :mod:`plane.api.rate_limit`)
        and attaches ``X-RateLimit-Remaining`` and ``X-RateLimit-Reset``
        headers so API clients can self-throttle without making a probe
        request. Delegates to ``super().finalize_response`` for the
        standard DRF renderer/parser pipeline.
        """
        # Call super to get the default response
        response = super().finalize_response(request, response, *args, **kwargs)

        # Add custom headers if they exist in the request META
        ratelimit_remaining = request.META.get("X-RateLimit-Remaining")
        if ratelimit_remaining is not None:
            response["X-RateLimit-Remaining"] = ratelimit_remaining

        ratelimit_reset = request.META.get("X-RateLimit-Reset")
        if ratelimit_reset is not None:
            response["X-RateLimit-Reset"] = ratelimit_reset

        return response

    @property
    def workspace_slug(self):
        """Return the workspace slug from the URL kwargs (``self.kwargs["slug"]``)."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Return the project UUID for the current request.

        Resolves to ``self.kwargs["project_id"]`` when present;
        otherwise, on the project-detail endpoint (URL name
        ``"project"``), falls back to ``self.kwargs["pk"]`` so handlers
        on that endpoint can share the same property accessor.
        """
        project_id = self.kwargs.get("project_id", None)
        if project_id:
            return project_id

        if resolve(self.request.path_info).url_name == "project":
            return self.kwargs.get("pk", None)

    @property
    def fields(self):
        """Return the parsed ``?fields=`` query parameter as a list.

        Used by sparse-fieldset-aware serializers (see
        :func:`plane.utils.openapi.create_paginated_response` consumers)
        to limit the response payload to the named fields. Returns
        ``None`` when the parameter is absent or empty so callers can
        distinguish "no filter" from "explicit empty filter".
        """
        fields = [field for field in self.request.GET.get("fields", "").split(",") if field]
        return fields if fields else None

    @property
    def expand(self):
        """Return the parsed ``?expand=`` query parameter as a list.

        Used by serializers that support nested expansion of foreign-key
        and many-to-many relations. Returns ``None`` when the parameter
        is absent or empty so callers can distinguish "no expansion"
        from "explicit empty expansion".
        """
        expand = [expand for expand in self.request.GET.get("expand", "").split(",") if expand]
        return expand if expand else None


class BaseViewSet(TimezoneMixin, ReadReplicaControlMixin, ModelViewSet, BasePaginator):
    """Standard ``ModelViewSet`` base for ``/api/v1/`` endpoints.

    MRO: ``TimezoneMixin`` -> ``ReadReplicaControlMixin`` -> ``ModelViewSet``
    -> ``BasePaginator``.

    Wires in the same defaults as :class:`BaseAPIView`:
        - ``authentication_classes = [APIKeyAuthentication]``
        - ``permission_classes     = [IsAuthenticated]``
        - ``use_read_replica       = False``

    Subclasses also declare ``model`` (the ORM model handled by the
    ViewSet) so the default :meth:`get_queryset` returns
    ``model.objects.all()``; subclasses typically override
    :meth:`get_queryset` to add per-request workspace/project filtering.

    Used by DRF-router-mounted endpoints such as
    :class:`plane.api.views.invite.WorkspaceInvitationsViewset` and
    :class:`plane.api.views.sticky.StickyViewSet` where the conventional
    ``list`` / ``create`` / ``retrieve`` / ``update`` / ``partial_update`` /
    ``destroy`` action methods supplied by ``ModelViewSet`` apply.

    :meth:`handle_exception` mirrors :meth:`BaseAPIView.handle_exception`
    but additionally emits structured ``logger.warning`` / ``logger.error``
    records with stable ``error_code`` values
    (``VALIDATION_ERROR``, ``OBJECT_DOES_NOT_EXIST``, ``KEY_ERROR``) so
    downstream log aggregators can route ViewSet failures distinctly
    from generic ``APIView`` failures. Helper properties
    (:attr:`workspace_slug`, :attr:`project_id`, :attr:`fields`,
    :attr:`expand`) behave identically to their :class:`BaseAPIView`
    counterparts.
    """

    model = None

    authentication_classes = [APIKeyAuthentication]
    permission_classes = [
        IsAuthenticated,
    ]
    use_read_replica = False

    def get_queryset(self):
        """Return the default queryset for this ViewSet's :attr:`model`.

        Subclasses typically override this to add per-request filtering
        (by workspace, project, user, etc.). The bare implementation
        guards against a missing or invalid ``model`` attribute by
        catching the underlying ORM exception, forwarding it to
        :func:`plane.utils.exception_logger.log_exception`, and
        re-raising as :class:`~rest_framework.exceptions.APIException`
        so the failure surfaces as a structured ``HTTP 400`` rather
        than an uncaught traceback.
        """
        try:
            return self.model.objects.all()
        except Exception as e:
            log_exception(e)
            raise APIException("Please check the view", status.HTTP_400_BAD_REQUEST)

    def handle_exception(self, exc):
        """Translate Django/DRF errors into uniform JSON responses with structured logging.

        Mapping:

        =========================  =====  ============================================
        Exception class            HTTP   Response body
        =========================  =====  ============================================
        ``IntegrityError``         400    ``{"error": "The payload is not valid"}``
        ``ValidationError``        400    ``{"error": "Please provide valid detail"}``
        ``ObjectDoesNotExist``     404    ``{"error": "The required object does
                                          not exist."}``
        ``KeyError``               400    ``{"error": "The required key does not
                                          exist."}``
        anything else              500    ``{"error": "Something went wrong please
                                          try again later"}``
        =========================  =====  ============================================

        Differs from :meth:`BaseAPIView.handle_exception` only by
        emitting structured ``logger.warning`` / ``logger.error``
        records with stable ``error_code`` values
        (``VALIDATION_ERROR``, ``OBJECT_DOES_NOT_EXIST``, ``KEY_ERROR``)
        so log aggregators can route ViewSet failures distinctly. The
        generic ``500`` fallback still avoids leaking exception detail
        to API clients; the original exception is forwarded to
        :func:`plane.utils.exception_logger.log_exception`.
        """
        try:
            response = super().handle_exception(exc)
            return response
        except Exception as e:
            if isinstance(e, IntegrityError):
                log_exception(e)
                return Response(
                    {"error": "The payload is not valid"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if isinstance(e, ValidationError):
                logger.warning(
                    "Validation Error",
                    extra={
                        "error_code": "VALIDATION_ERROR",
                        "error_message": str(e),
                    },
                )
                return Response(
                    {"error": "Please provide valid detail"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if isinstance(e, ObjectDoesNotExist):
                logger.warning(
                    "Object Does Not Exist",
                    extra={
                        "error_code": "OBJECT_DOES_NOT_EXIST",
                        "error_message": str(e),
                    },
                )
                return Response(
                    {"error": "The required object does not exist."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if isinstance(e, KeyError):
                logger.error(
                    "Key Error",
                    extra={
                        "error_code": "KEY_ERROR",
                        "error_message": str(e),
                    },
                )
                return Response(
                    {"error": "The required key does not exist."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            log_exception(e)
            return Response(
                {"error": "Something went wrong please try again later"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def dispatch(self, request, *args, **kwargs):
        """Run the DRF ViewSet request lifecycle and emit a debug query summary.

        Mirrors :meth:`BaseAPIView.dispatch` -- delegates to
        ``super().dispatch`` and, when ``settings.DEBUG`` is true,
        prints ``request.method``, the full URL, and the count of
        executed SQL queries for local development. Exceptions raised
        by the super-call are routed through :meth:`handle_exception`
        and the resulting response is returned to the client.
        """
        try:
            response = super().dispatch(request, *args, **kwargs)

            if settings.DEBUG:
                from django.db import connection

                print(f"{request.method} - {request.get_full_path()} of Queries: {len(connection.queries)}")

            return response
        except Exception as exc:
            response = self.handle_exception(exc)
            return response

    @property
    def workspace_slug(self):
        """Return the workspace slug from the URL kwargs (``self.kwargs["slug"]``)."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Return the project UUID for the current request.

        Resolves to ``self.kwargs["project_id"]`` when present;
        otherwise, on the project-detail endpoint (URL name
        ``"project"``), falls back to ``self.kwargs["pk"]`` so handlers
        on that endpoint can share the same property accessor.
        """
        project_id = self.kwargs.get("project_id", None)
        if project_id:
            return project_id

        if resolve(self.request.path_info).url_name == "project":
            return self.kwargs.get("pk", None)

    @property
    def fields(self):
        """Return the parsed ``?fields=`` query parameter as a list.

        Used by sparse-fieldset-aware serializers to limit the response
        payload to the named fields. Returns ``None`` when the
        parameter is absent or empty so callers can distinguish "no
        filter" from "explicit empty filter".
        """
        fields = [field for field in self.request.GET.get("fields", "").split(",") if field]
        return fields if fields else None

    @property
    def expand(self):
        """Return the parsed ``?expand=`` query parameter as a list.

        Used by serializers that support nested expansion of foreign-key
        and many-to-many relations. Returns ``None`` when the parameter
        is absent or empty so callers can distinguish "no expansion"
        from "explicit empty expansion".
        """
        expand = [expand for expand in self.request.GET.get("expand", "").split(",") if expand]
        return expand if expand else None
