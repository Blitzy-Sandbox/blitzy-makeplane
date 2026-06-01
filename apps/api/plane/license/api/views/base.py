# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared timezone and base ``APIView`` for license-API JSON endpoints.

Provides the local ``BaseAPIView`` consumed by ``admin.py`` and
``configuration.py`` in this folder. ``instance.py`` and ``workspace.py``
import the application-wide ``BaseAPIView`` from ``plane.app.views``
instead — this module's class is scoped to the standalone admin console
and applies ``InstanceAdminPermission`` + ``BaseSessionAuthentication``
by default. The migrator container is responsible for creating the
underlying ``Instance``/``User`` tables before any consumer view runs.
"""

# Python imports
import zoneinfo
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import IntegrityError

# Django imports
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend

# Third part imports
from rest_framework import status
from rest_framework.filters import SearchFilter
from rest_framework.response import Response
from rest_framework.views import APIView

# Module imports
from plane.license.api.permissions import InstanceAdminPermission
from plane.authentication.session import BaseSessionAuthentication
from plane.utils.exception_logger import log_exception
from plane.utils.paginator import BasePaginator


class TimezoneMixin:
    """Activate ``request.user.user_timezone`` for the duration of the request."""

    def initial(self, request, *args, **kwargs):
        """Activate the requesting user's timezone (or deactivate for anonymous)."""
        super().initial(request, *args, **kwargs)
        if request.user.is_authenticated:
            timezone.activate(zoneinfo.ZoneInfo(request.user.user_timezone))
        else:
            timezone.deactivate()


class BaseAPIView(TimezoneMixin, APIView, BasePaginator):
    """Local base view for the license admin JSON endpoints.

    Composes ``TimezoneMixin`` + DRF ``APIView`` + ``BasePaginator`` and
    pins the following defaults that ``admin.py`` and ``configuration.py``
    rely on:

    * ``permission_classes = [InstanceAdminPermission]`` — admin gate.
    * ``authentication_classes = [BaseSessionAuthentication]`` — session
      cookie auth via ``plane.authentication.session``.
    * ``filter_backends = (DjangoFilterBackend, SearchFilter)`` for DRF
      query-param filtering, plus the ``filter_queryset`` helper.
    * Centralised ``handle_exception`` translation of ``IntegrityError``,
      ``ValidationError``, ``ObjectDoesNotExist``, and ``KeyError`` into
      400/404 JSON responses; all other exceptions are routed through
      ``log_exception`` and surfaced as 500.

    The ``dispatch`` override also prints query counts when
    ``settings.DEBUG`` is truthy.

    Notes:
        Used ONLY by ``admin.py`` and ``configuration.py`` in this
        folder. ``instance.py`` and ``workspace.py`` import the
        application-wide ``BaseAPIView`` from ``plane.app.views``
        instead — keep the two bases in sync on shared semantics
        (auth, permissions, exception translation) but do not assume
        feature parity.
    """

    permission_classes = [InstanceAdminPermission]

    filter_backends = (DjangoFilterBackend, SearchFilter)

    authentication_classes = [BaseSessionAuthentication]

    filterset_fields = []

    search_fields = []

    def filter_queryset(self, queryset):
        """Apply every backend in ``filter_backends`` to ``queryset`` and return the result."""
        for backend in list(self.filter_backends):
            queryset = backend().filter_queryset(self.request, queryset, self)
        return queryset

    def handle_exception(self, exc):
        """Handle any exception that occurs, by returning an appropriate response, or re-raising the error."""
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
        """Dispatch the request and, in ``DEBUG``, print the per-request query count."""
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
    def fields(self):
        """Return the parsed ``?fields=`` query param list, or ``None`` if absent."""
        fields = [field for field in self.request.GET.get("fields", "").split(",") if field]
        return fields if fields else None

    @property
    def expand(self):
        """Return the parsed ``?expand=`` query param list, or ``None`` if absent."""
        expand = [expand for expand in self.request.GET.get("expand", "").split(",") if expand]
        return expand if expand else None
