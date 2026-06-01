# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared view base classes for the ``plane.space`` public API surface.

Defines three reusable bases consumed by every concrete view module in
``apps/api/plane/space/views/``:

* :class:`TimezoneMixin` -- activates :mod:`django.utils.timezone` to
  the authenticated user's ``user_timezone`` (or deactivates it for
  anonymous traffic) before each request handler runs. Mixed into both
  :class:`BaseViewSet` and :class:`BaseAPIView` so timezone-aware
  ``timezone.now()`` calls inside handlers reflect the caller's locale.
* :class:`BaseViewSet` -- DRF :class:`ModelViewSet` with a default
  ``permission_classes=[IsAuthenticated]``, the project's
  :class:`BaseSessionAuthentication`, the
  :class:`django_filters.rest_framework.DjangoFilterBackend` +
  :class:`SearchFilter` filter chain, the project's pagination helper
  (:class:`BasePaginator`), a uniform exception-to-Response mapping in
  :meth:`BaseViewSet.handle_exception`, and a DEBUG-only query-count
  log in :meth:`BaseViewSet.dispatch`.
* :class:`BaseAPIView` -- DRF :class:`APIView` counterpart with the
  same defaults, used by endpoints that don't need full
  :class:`ModelViewSet` semantics (e.g. single-method anchor lookups
  or read-only aggregations).

Module load order: this module imports DRF and authentication code at
import time, so the ``migrator`` container's Django migrations MUST
run to completion before any worker that consumes this module
(Gunicorn / Celery beat / Celery worker) starts -- startup is blocked
on the schema being up to date.
"""

# Python imports
import zoneinfo
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import IntegrityError

# Django imports
from django.urls import resolve
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend

# Third part imports
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

# Module imports
from plane.utils.exception_logger import log_exception
from plane.utils.paginator import BasePaginator
from plane.authentication.session import BaseSessionAuthentication


class TimezoneMixin:
    """Activate Django's timezone for the authenticated user before each request.

    Reads ``request.user.user_timezone`` and calls
    :func:`django.utils.timezone.activate` with the corresponding
    :class:`zoneinfo.ZoneInfo`; for anonymous traffic, deactivates
    timezone so handlers fall back to the project's
    :data:`settings.TIME_ZONE` default. Mixed into
    :class:`BaseViewSet` and :class:`BaseAPIView` so every
    ``timezone.now()`` call inside a request handler returns a
    locale-correct timestamp without each subclass having to opt in.
    """

    def initial(self, request, *args, **kwargs):
        """Activate the authenticated user's timezone (or deactivate for anonymous)."""
        super().initial(request, *args, **kwargs)
        if request.user.is_authenticated:
            timezone.activate(zoneinfo.ZoneInfo(request.user.user_timezone))
        else:
            timezone.deactivate()


class BaseViewSet(TimezoneMixin, ModelViewSet, BasePaginator):
    """Project-wide :class:`ModelViewSet` base with auth, filters, and uniform error handling.

    Class attributes (defaults; subclasses override per endpoint):
        model: target Django model class for the default
            :meth:`get_queryset` implementation; subclasses MUST set
            this when they rely on the inherited queryset behavior.
        permission_classes: ``[IsAuthenticated]`` -- every endpoint
            requires authentication unless the subclass overrides this
            (e.g. with ``[AllowAny]`` or a ``get_permissions`` override
            that returns mixed permissions per action).
        filter_backends: ``(DjangoFilterBackend, SearchFilter)`` -- the
            DRF filter chain wired into list endpoints; subclasses
            populate ``filterset_fields`` and ``search_fields`` to
            opt in.
        authentication_classes: ``[BaseSessionAuthentication]`` -- the
            project's session-cookie authentication adapter (see
            :mod:`plane.authentication.session`).
        filterset_fields / search_fields: ``[]`` -- empty by default;
            subclasses override to enable filtering / search.

    Behavior contributed by this class:
        * :meth:`get_queryset` returns ``self.model.objects.all()``
          wrapped in a try/except that converts misconfiguration into
          a 400 :class:`APIException` so a missing ``model`` doesn't
          escape as a 500.
        * :meth:`handle_exception` maps :class:`IntegrityError` /
          :class:`ValidationError` / :class:`ObjectDoesNotExist` /
          :class:`KeyError` to uniform 400/404 responses; catchalls
          are logged via
          :func:`plane.utils.exception_logger.log_exception` and
          returned as a 500 "Something went wrong please try again
          later" response.
        * :meth:`dispatch` prints a per-request SQL query count to
          stdout when ``settings.DEBUG=True`` -- useful for tracking
          N+1 regressions in local development; silent in production.
        * :attr:`workspace_slug` / :attr:`project_id` are convenience
          properties that read URL kwargs supplied by the router.
    """

    model = None

    permission_classes = [IsAuthenticated]

    filter_backends = (DjangoFilterBackend, SearchFilter)

    authentication_classes = [BaseSessionAuthentication]

    filterset_fields = []

    search_fields = []

    def get_queryset(self):
        """Return ``self.model.objects.all()`` or raise a 400 :class:`APIException`.

        Subclasses that depend on the inherited queryset MUST set
        ``model``; failure to do so is caught here and converted into
        a 400 :class:`APIException` (rather than allowing an
        ``AttributeError`` on ``None.objects`` to escape as a 500),
        so misconfiguration is surfaced at the contract boundary
        instead of leaking as a server error.
        """
        try:
            return self.model.objects.all()
        except Exception as e:
            log_exception(e)
            raise APIException("Please check the view", status.HTTP_400_BAD_REQUEST)

    def handle_exception(self, exc):
        """Map common ORM/value errors to uniform Response payloads.

        Returns 400 for :class:`IntegrityError` ("The payload is not
        valid"), :class:`ValidationError` ("Please provide valid
        detail"), and :class:`KeyError` ("The required key does not
        exist."); 404 for :class:`ObjectDoesNotExist` ("The required
        object does not exist."); and a 500 catchall ("Something went
        wrong please try again later") for everything else. Both the
        :class:`KeyError` branch and the catchall forward the
        exception to
        :func:`plane.utils.exception_logger.log_exception` so traces
        reach the configured logging / Sentry sinks.
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
                    {"error": "The required object does not exist."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if isinstance(e, KeyError):
                log_exception(e)
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
        """Run the DRF dispatch and print a DEBUG-only query count to stdout.

        The ``settings.DEBUG`` guard ensures production traffic does
        not incur the cost of reading ``connection.queries`` (which is
        only populated when ``DEBUG=True``); the print is silent in
        production. Used to catch N+1 regressions during local
        development. On the exception path the bare ``return exc`` is
        the existing observed behavior and is preserved as-is per the
        system boundary that forbids behavioral changes.
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

    @property
    def workspace_slug(self):
        """Return the ``slug`` URL kwarg supplied by the router (``None`` if absent)."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Return the ``project_id`` URL kwarg, with a fallback to ``pk`` for project-detail routes.

        The fallback activates when the resolved URL name is
        ``"project"`` -- i.e. the ProjectViewSet's own
        ``/projects/<pk>/`` detail route -- so child resources that
        look up ``project_id`` via this property continue to work
        when the parent URL exposes the identifier as ``pk`` rather
        than ``project_id``.
        """
        project_id = self.kwargs.get("project_id", None)
        if project_id:
            return project_id

        if resolve(self.request.path_info).url_name == "project":
            return self.kwargs.get("pk", None)


class BaseAPIView(TimezoneMixin, APIView, BasePaginator):
    """Project-wide :class:`APIView` base for non-CRUD endpoints.

    Shares the same default ``permission_classes``,
    ``authentication_classes``, ``filter_backends``,
    ``filterset_fields``, and ``search_fields`` defaults as
    :class:`BaseViewSet`, but inherits from :class:`APIView` (not
    :class:`ModelViewSet`) -- appropriate for endpoints that don't
    expose CRUD actions, such as single-method anchor lookups, bulk
    endpoints, or read-only aggregations.

    Behavior contributed by this class:
        * :meth:`filter_queryset` manually applies each configured
          backend's ``filter_queryset`` (mirroring what
          :class:`GenericAPIView` does automatically; replicated here
          because plain :class:`APIView` does not run filter backends
          by default).
        * :meth:`handle_exception` mirrors
          :meth:`BaseViewSet.handle_exception` (same uniform
          exception-to-Response mapping) so error handling is
          consistent across both view bases.
        * :meth:`dispatch` mirrors :meth:`BaseViewSet.dispatch`'s
          DEBUG-only query-count print.
        * :attr:`workspace_slug` / :attr:`project_id` mirror the
          :class:`BaseViewSet` properties, but :attr:`project_id`
          here does NOT include the URL-name-resolution fallback to
          ``pk`` -- only the direct ``project_id`` kwarg is read.
    """

    permission_classes = [IsAuthenticated]

    filter_backends = (DjangoFilterBackend, SearchFilter)

    filterset_fields = []

    search_fields = []

    authentication_classes = [BaseSessionAuthentication]

    def filter_queryset(self, queryset):
        """Apply every configured filter backend's ``filter_queryset`` to ``queryset``.

        :class:`APIView` (unlike :class:`GenericAPIView`) does not
        invoke filter backends automatically, so this method exists
        to give :class:`BaseAPIView` subclasses parity with
        :class:`BaseViewSet` when they need filtering on their custom
        list endpoints.
        """
        for backend in list(self.filter_backends):
            queryset = backend().filter_queryset(self.request, queryset, self)
        return queryset

    def handle_exception(self, exc):
        """Map common ORM/value errors to uniform Response payloads (parity with :class:`BaseViewSet`).

        Mirrors :meth:`BaseViewSet.handle_exception` exactly: 400 for
        :class:`IntegrityError` / :class:`ValidationError` /
        :class:`KeyError`, 404 for :class:`ObjectDoesNotExist`, and a
        500 catchall. The only observed difference is that the
        :class:`KeyError` branch here does NOT call
        :func:`plane.utils.exception_logger.log_exception` (the
        :class:`BaseViewSet` variant does) -- preserved as-is per the
        system boundary that forbids behavioral changes.
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
                    {"error": "The required object does not exist."},
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
        """Run the DRF dispatch and print a DEBUG-only query count to stdout.

        Mirrors :meth:`BaseViewSet.dispatch` -- the ``settings.DEBUG``
        guard ensures production traffic is unaffected. The bare
        ``return exc`` on the exception path is the same observed
        behavior as :meth:`BaseViewSet.dispatch` and is preserved
        as-is per the system boundary that forbids behavioral
        changes.
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

    @property
    def workspace_slug(self):
        """Return the ``slug`` URL kwarg supplied by the router (``None`` if absent)."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Return the ``project_id`` URL kwarg supplied by the router (``None`` if absent).

        Unlike :attr:`BaseViewSet.project_id`, this property does NOT
        fall back to the ``pk`` URL kwarg when the resolved URL name
        is ``"project"`` -- :class:`APIView` endpoints don't share
        the ``ProjectViewSet`` routing convention so the fallback is
        unnecessary here.
        """
        return self.kwargs.get("project_id", None)
