# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Request-scoped base URL and client IP helpers.

Two helpers compose the canonical absolute URLs used throughout the backend
for email templates, OAuth redirects, webhook payload ``origin`` fields, and
notification deep-links:

  - :func:`base_host` resolves the host/origin for one of four surfaces
    (admin, space, app, or base) by combining ``settings.*_BASE_URL`` and
    ``settings.*_BASE_PATH`` values. Consumed settings: ``WEB_URL``,
    ``APP_BASE_URL``, ``ADMIN_BASE_URL``, ``ADMIN_BASE_PATH`` (default
    ``/god-mode/``), ``SPACE_BASE_URL``, ``SPACE_BASE_PATH`` (default
    ``/spaces/``).
  - :func:`user_ip` thinly delegates to
    :func:`plane.utils.ip_address.get_client_ip` so callers can read the
    originating client IP from a request without importing the IP module
    directly.

Canonical consumers: notification/email builders that assemble absolute URLs,
webhook payload ``origin`` fields, and OAuth redirect logic.
"""

# Django imports
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpRequest

# Third party imports
from rest_framework.request import Request

# Module imports
from plane.utils.ip_address import get_client_ip


def base_host(
    request: Request | HttpRequest,
    is_admin: bool = False,
    is_space: bool = False,
    is_app: bool = False,
) -> str:
    """Return the canonical host/origin URL for the requested surface.

    Resolves to the admin surface (``ADMIN_BASE_URL`` + ``ADMIN_BASE_PATH``,
    default ``/god-mode/``), the space surface (``SPACE_BASE_URL`` +
    ``SPACE_BASE_PATH``, default ``/spaces/``), the app surface
    (``APP_BASE_URL``), or the generic base origin (``WEB_URL`` or
    ``APP_BASE_URL``). Only one of ``is_admin``, ``is_space``, ``is_app``
    should be true at a time; precedence is admin > space > app > base.

    Raises:
        ImproperlyConfigured: if neither ``APP_BASE_URL`` nor ``WEB_URL`` is
            configured.
    """
    # Calculate the base origin from request
    base_origin = settings.WEB_URL or settings.APP_BASE_URL

    if not base_origin:
        raise ImproperlyConfigured("APP_BASE_URL or WEB_URL is not set")

    # Admin redirection
    if is_admin:
        admin_base_path = getattr(settings, "ADMIN_BASE_PATH", None)
        if not isinstance(admin_base_path, str):
            admin_base_path = "/god-mode/"
        if not admin_base_path.startswith("/"):
            admin_base_path = "/" + admin_base_path
        if not admin_base_path.endswith("/"):
            admin_base_path += "/"

        if settings.ADMIN_BASE_URL:
            return settings.ADMIN_BASE_URL + admin_base_path
        else:
            return base_origin + admin_base_path

    # Space redirection
    if is_space:
        space_base_path = getattr(settings, "SPACE_BASE_PATH", None)
        if not isinstance(space_base_path, str):
            space_base_path = "/spaces/"
        if not space_base_path.startswith("/"):
            space_base_path = "/" + space_base_path
        if not space_base_path.endswith("/"):
            space_base_path += "/"

        if settings.SPACE_BASE_URL:
            return settings.SPACE_BASE_URL + space_base_path
        else:
            return base_origin + space_base_path

    # App Redirection
    if is_app:
        if settings.APP_BASE_URL:
            return settings.APP_BASE_URL
        else:
            return base_origin

    return base_origin


def user_ip(request: Request | HttpRequest) -> str:
    """Return the client IP address by delegating to ``get_client_ip``."""
    return get_client_ip(request=request)
