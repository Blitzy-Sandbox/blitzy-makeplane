# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared DRF view infrastructure for the Plane web-client API.

Defines the three classes every other view module in ``plane.app.views``
builds on:

* :class:`TimezoneMixin` -- activates the requesting user's IANA timezone
  on every request so timezone-aware datetimes render in the user's local
  zone.
* :class:`BaseViewSet` -- the default ``ModelViewSet`` base for
  resource-oriented endpoints under ``/api/workspaces/<slug>/...``.
  Composes ``TimezoneMixin``, ``ReadReplicaControlMixin``, DRF's
  ``ModelViewSet``, and ``BasePaginator`` to provide session authentication,
  ``IsAuthenticated`` defaults, ``DjangoFilterBackend`` + ``SearchFilter``,
  consistent exception translation, and read-replica routing.
* :class:`BaseAPIView` -- the equivalent base for non-ViewSet
  ``APIView`` subclasses (e.g., :class:`plane.app.views.api.ApiTokenEndpoint`).

Architectural notes:

* Startup order: the ``migrator`` container runs Django migrations before
  these views are importable, so ``ProjectMember`` / ``WorkspaceMember``
  schema queries inside ``handle_exception`` are safe at module load time.
* Authentication: session-cookie based via
  :class:`plane.authentication.session.BaseSessionAuthentication`.
  Personal API tokens (for the web client) are handled out-of-band by
  :class:`plane.app.views.api.ApiTokenEndpoint`.
* Read replicas: opt-in per view via ``use_read_replica = True`` -- the
  mixin routes ``GET`` requests through the read replica while writes
  always hit the primary.
* Exception translation: ``IntegrityError``, ``ValidationError``,
  ``ObjectDoesNotExist``, and ``KeyError`` are mapped to canonical 4xx
  JSON responses; everything else falls through to ``log_exception`` and
  HTTP 500.
"""

# Python imports
import traceback

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
from plane.authentication.session import BaseSessionAuthentication
from plane.utils.exception_logger import log_exception
from plane.utils.paginator import BasePaginator
from plane.utils.core.mixins import ReadReplicaControlMixin


class TimezoneMixin:
    """Activate the requesting user's timezone for every DRF request.

    Reads ``request.user.user_timezone`` (an IANA zone name such as
    ``"America/Los_Angeles"``) and calls ``django.utils.timezone.activate``
    so timezone-aware datetimes are formatted in the user's local zone
    throughout the request. Anonymous requests fall back to
    ``timezone.deactivate()`` (UTC).

    Composed FIRST in the MRO of :class:`BaseViewSet` and
    :class:`BaseAPIView` so this hook runs before the inherited DRF
    ``initial`` does any timezone-sensitive work.
    """

    def initial(self, request, *args, **kwargs):
        """Activate the user's IANA timezone before the DRF view runs (or deactivate for anonymous requests)."""
        super().initial(request, *args, **kwargs)
        if request.user.is_authenticated:
            timezone.activate(zoneinfo.ZoneInfo(request.user.user_timezone))
        else:
            timezone.deactivate()


class BaseViewSet(TimezoneMixin, ReadReplicaControlMixin, ModelViewSet, BasePaginator):
    """Default DRF ``ModelViewSet`` base for Plane resource-oriented endpoints.

    Composition (MRO order is intentional):

    * :class:`TimezoneMixin` -- activates ``request.user.user_timezone`` on
      every request.
    * :class:`plane.utils.core.mixins.ReadReplicaControlMixin` -- routes
      ``GET`` requests through the read replica when ``use_read_replica =
      True`` is set on the subclass.
    * :class:`rest_framework.viewsets.ModelViewSet` -- provides the
      standard ``list`` / ``create`` / ``retrieve`` / ``update`` /
      ``partial_update`` / ``destroy`` methods.
    * :class:`plane.utils.paginator.BasePaginator` -- provides pagination
      helpers consumed by ``list`` overrides.

    Defaults applied by this base (subclasses MAY override):

    * ``permission_classes = [IsAuthenticated]``
    * ``filter_backends = (DjangoFilterBackend, SearchFilter)``
    * ``authentication_classes = [BaseSessionAuthentication]``
    * ``filterset_fields = []``, ``search_fields = []``,
      ``use_read_replica = False``
    * ``model = None`` -- subclasses set this to drive the default
      ``get_queryset``.

    Exception translation (``handle_exception``):

    * ``IntegrityError`` -> 400 ``{"error": "The payload is not valid"}``
    * ``ValidationError`` -> 400 ``{"error": "Please provide valid detail"}``
    * ``ObjectDoesNotExist`` -> 404 ``{"error": "The required object does not exist."}``
    * ``KeyError`` -> 400 ``{"error": "The required key does not exist."}``
    * everything else -> ``log_exception`` + 500 ``{"error": "Something went wrong please try again later"}``

    Convenience properties (read from ``self.kwargs`` and ``request.GET``):

    * ``workspace_slug`` -- ``kwargs["slug"]`` from the URL.
    * ``project_id`` -- ``kwargs["project_id"]`` from the URL, with a
      special case that maps ``kwargs["pk"]`` to ``project_id`` when the
      resolved URL name is ``"project"``.
    * ``fields`` -- the ``?fields=a,b,c`` query string as a list.
    * ``expand`` -- the ``?expand=a,b,c`` query string as a list.
    """

    model = None

    permission_classes = [IsAuthenticated]

    filter_backends = (DjangoFilterBackend, SearchFilter)

    authentication_classes = [BaseSessionAuthentication]

    filterset_fields = []

    search_fields = []

    use_read_replica = False

    def get_queryset(self):
        """Return ``self.model.objects.all()``.

        Subclasses typically override this to apply workspace and project
        filters.
        """
        try:
            return self.model.objects.all()
        except Exception as e:
            log_exception(e)
            raise APIException("Please check the view", status.HTTP_400_BAD_REQUEST)

    def handle_exception(self, exc):
        """Translate well-known database / parsing exceptions to canonical 4xx JSON responses.

        Re-delegates first to the DRF ``handle_exception`` super-method. If
        that itself raises, the inner ``except Exception`` branch maps
        ``IntegrityError`` / ``ValidationError`` / ``ObjectDoesNotExist`` /
        ``KeyError`` to fixed 4xx responses and falls through to
        ``log_exception`` + 500 for anything else. When ``settings.DEBUG``
        is set, the full traceback is printed to stdout.
        """
        try:
            response = super().handle_exception(exc)
            return response
        except Exception as e:
            (print(e, traceback.format_exc()) if settings.DEBUG else print("Server Error"))
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
        """Delegate to the parent ``dispatch`` and emit a DEBUG-mode query-count log line.

        Wraps ``super().dispatch(...)`` in a try/except so any exception
        raised below the DRF stack is funnelled through
        :meth:`handle_exception` instead of bubbling out of the view.
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
        """Return the URL kwarg ``slug`` (the workspace slug), or ``None`` if absent."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Return the URL kwarg ``project_id``, or fall back to ``pk`` when the resolved URL name is ``project``."""
        project_id = self.kwargs.get("project_id", None)
        if project_id:
            return project_id

        if resolve(self.request.path_info).url_name == "project":
            return self.kwargs.get("pk", None)

    @property
    def fields(self):
        """Return the ``?fields=a,b,c`` query string parsed into a list, or ``None`` if not supplied."""
        fields = [field for field in self.request.GET.get("fields", "").split(",") if field]
        return fields if fields else None

    @property
    def expand(self):
        """Return the ``?expand=a,b,c`` query string parsed into a list, or ``None`` if not supplied."""
        expand = [expand for expand in self.request.GET.get("expand", "").split(",") if expand]
        return expand if expand else None


class BaseAPIView(TimezoneMixin, ReadReplicaControlMixin, APIView, BasePaginator):
    """Default DRF ``APIView`` base for Plane non-ViewSet endpoints.

    Mirror of :class:`BaseViewSet` for endpoints that do not fit the
    ``ModelViewSet`` CRUD shape (single-purpose POST handlers, status
    aggregators, action endpoints) by composing
    :class:`TimezoneMixin` + :class:`ReadReplicaControlMixin` +
    :class:`rest_framework.views.APIView` + :class:`BasePaginator`.
    Inherits the same defaults as :class:`BaseViewSet`
    (``IsAuthenticated``, ``BaseSessionAuthentication``,
    ``DjangoFilterBackend`` + ``SearchFilter``, ``use_read_replica =
    False``) and the same exception-translation table on
    :meth:`handle_exception`.

    The ``filter_queryset`` helper is exposed so subclasses can apply the
    declared filter backends on demand (``APIView`` does not call this
    automatically the way ``ModelViewSet`` does).
    """

    permission_classes = [IsAuthenticated]

    filter_backends = (DjangoFilterBackend, SearchFilter)

    authentication_classes = [BaseSessionAuthentication]

    filterset_fields = []

    search_fields = []

    use_read_replica = False

    def filter_queryset(self, queryset):
        """Apply every configured ``filter_backends`` instance to ``queryset`` and return the filtered result."""
        for backend in list(self.filter_backends):
            queryset = backend().filter_queryset(self.request, queryset, self)
        return queryset

    def handle_exception(self, exc):
        """Translate well-known database / parsing exceptions to canonical 4xx JSON responses.

        Mirrors :meth:`BaseViewSet.handle_exception` (same isinstance
        branches and payloads) but without the DEBUG-mode traceback print
        on the first branch.
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
        """Delegate to the parent ``dispatch`` and emit a DEBUG-mode query-count log line.

        Mirrors :meth:`BaseViewSet.dispatch`.
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
        """Return the URL kwarg ``slug`` (the workspace slug), or ``None`` if absent."""
        return self.kwargs.get("slug", None)

    @property
    def project_id(self):
        """Return the URL kwarg ``project_id``, or ``None`` if absent.

        No resolve fallback unlike :class:`BaseViewSet`.
        """
        return self.kwargs.get("project_id", None)

    @property
    def fields(self):
        """Return the ``?fields=a,b,c`` query string parsed into a list, or ``None`` if not supplied."""
        fields = [field for field in self.request.GET.get("fields", "").split(",") if field]
        return fields if fields else None

    @property
    def expand(self):
        """Return the ``?expand=a,b,c`` query string parsed into a list, or ``None`` if not supplied."""
        expand = [expand for expand in self.request.GET.get("expand", "").split(",") if expand]
        return expand if expand else None
