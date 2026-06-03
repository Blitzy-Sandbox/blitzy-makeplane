# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Host/origin and client-IP resolution for Plane authentication redirects.

Centralizes two request-adjacent helpers used by the authentication views to
build correct redirect targets and capture session-device metadata:

  * :func:`base_host` derives the absolute base URL for the *app*, *admin*,
    or *space* surface so that post-auth redirects route to the correct
    frontend. Source-of-truth values come from the Django ``settings``
    module: ``WEB_URL``, ``APP_BASE_URL``, ``ADMIN_BASE_URL``,
    ``ADMIN_BASE_PATH``, ``SPACE_BASE_URL``, and ``SPACE_BASE_PATH``.
  * :func:`user_ip` wraps :func:`plane.utils.ip_address.get_client_ip` so
    auth-flow callers have a single import surface for IP capture.

The module performs no I/O and has no side effects; values are derived
purely from the request and the runtime ``settings`` overlay.
"""

# Django imports
from django.conf import settings
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
    """Return the absolute base origin to use when redirecting after auth.

    Selects between the app, admin, and space surfaces based on the
    *mutually-exclusive* context flags so that post-authentication redirects
    land on the correct frontend. The resolution order is fixed and the
    function normalizes admin/space base paths to ensure a leading and
    trailing slash:

      1. If ``is_admin`` is truthy, return ``settings.ADMIN_BASE_URL`` (or
         the default base origin when unset) concatenated with
         ``settings.ADMIN_BASE_PATH`` (defaulting to ``"/god-mode/"``).
      2. Else if ``is_space`` is truthy, return ``settings.SPACE_BASE_URL``
         (or the default base origin) concatenated with
         ``settings.SPACE_BASE_PATH`` (defaulting to ``"/spaces/"``).
      3. Else if ``is_app`` is truthy, return ``settings.APP_BASE_URL`` (or
         the default base origin) with no path suffix.
      4. Otherwise return the default base origin
         (``settings.WEB_URL or settings.APP_BASE_URL``).

    The flags are expected to be set by the caller in a mutually-exclusive
    fashion; if more than one is truthy, admin wins over space, and space
    wins over app, mirroring the source ordering.

    Args:
        request: The DRF or Django request that initiated the auth flow.
            Currently used only to thread context (not inspected) so callers
            in both DRF and plain-Django paths can share this helper.
        is_admin (bool): Route to the admin (``god-mode``) surface.
        is_space (bool): Route to the public-space surface.
        is_app (bool): Route to the main app surface explicitly (otherwise
            the default base origin is returned).

    Returns:
        str: The absolute base origin URL, ending in a single trailing
        slash when an admin/space base path is appended.
    """
    # Calculate the base origin from request
    base_origin = settings.WEB_URL or settings.APP_BASE_URL

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
    """Return the client IP for ``request`` via :func:`plane.utils.ip_address.get_client_ip`."""
    return get_client_ip(request=request)
