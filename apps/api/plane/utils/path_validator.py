# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Path and redirect validators (path-traversal + open-redirect defense).

Three threat models are covered by this module:

1. Filename sanitization (:func:`sanitize_filename`) -- strip directory
   separators, null bytes, and reserved characters from user-uploaded
   filenames before persisting to object storage.
2. Suspicious pattern detection (:func:`_contains_suspicious_patterns`)
   -- detect encoded path-traversal and scheme-coercion sequences
   (``..``, ``%2e%2e``, ``javascript:``, ``data:``, ``<script``, ...)
   anywhere in user-supplied input.
3. Open-redirect protection (:func:`validate_next_path` /
   :func:`get_safe_redirect_url`) -- validate ``next=`` query parameters
   against the configured allowed-hosts list before issuing a redirect.

Allowed-host source (:func:`get_allowed_hosts`): the configured
``WEB_URL`` (with ``APP_BASE_URL`` as the fallback) plus
``ADMIN_BASE_URL`` and ``SPACE_BASE_URL`` -- each parsed down to just
the netloc component for use with Django's
``url_has_allowed_host_and_scheme``.

Consumers: ``plane.authentication.*`` login/signup flows,
``plane.app.views.user.*`` settings endpoints, and file-upload endpoints
that persist user-supplied filenames.
"""

# Django imports
from django.utils.http import url_has_allowed_host_and_scheme
from django.conf import settings

# Python imports
import os
from urllib.parse import urlparse


def sanitize_filename(filename):
    """Strip directory separators, null bytes, and reserved characters from a filename.

    Used before persisting user-uploaded filenames to S3/MinIO/local
    storage to defend against path-traversal via crafted filenames.
    Returns ``None`` for empty or non-string input so callers can detect
    that no valid filename was supplied.
    """
    if not filename or not isinstance(filename, str):
        return None

    # Strip null bytes
    filename = filename.replace("\x00", "")

    # Normalize backslashes so os.path.basename handles Windows-style paths on POSIX
    filename = filename.replace("\\", "/")

    # Take only the basename to remove any directory components
    filename = os.path.basename(filename)

    # Remove any remaining path traversal sequences
    filename = filename.replace("..", "")

    # Strip whitespace before removing leading dots so " .env" is caught
    filename = filename.strip()

    # Remove leading dots (hidden files)
    filename = filename.lstrip(".")

    # Strip any remaining whitespace
    filename = filename.strip()

    if not filename:
        return None

    return filename


def _contains_suspicious_patterns(path: str) -> bool:
    """Return True if ``path`` contains a path-traversal or dangerous-scheme pattern.

    Scans ``path`` (case-insensitively) against an allowlist-style block
    list covering URL-encoded traversal (``%2e%2e``, ``%2f%2f``,
    ``%5c%5c``), unsafe URI schemes (``javascript:``, ``data:``,
    ``vbscript:``, ``file:``, ``ftp:``), and HTML-injection markers
    (``<script``, ``<iframe``, ``onload=``, ...).
    """
    suspicious_patterns = [
        r"javascript:",  # JavaScript injection
        r"data:",  # Data URLs
        r"vbscript:",  # VBScript injection
        r"file:",  # File protocol
        r"ftp:",  # FTP protocol
        r"%2e%2e",  # URL encoded path traversal
        r"%2f%2f",  # URL encoded double slash
        r"%5c%5c",  # URL encoded backslashes
        r"<script",  # Script tags
        r"<iframe",  # Iframe tags
        r"<object",  # Object tags
        r"<embed",  # Embed tags
        r"<form",  # Form tags
        r"onload=",  # Event handlers
        r"onerror=",  # Event handlers
        r"onclick=",  # Event handlers
    ]

    path_lower = path.lower()
    for pattern in suspicious_patterns:
        if pattern in path_lower:
            return True

    return False


def get_allowed_hosts() -> list[str]:
    """Return the list of netlocs that are safe redirect targets.

    Derived from the configured ``WEB_URL`` (with ``APP_BASE_URL`` as the
    fallback), ``ADMIN_BASE_URL``, and ``SPACE_BASE_URL`` settings -- each
    parsed down to just the host component for use with Django's
    ``url_has_allowed_host_and_scheme``.
    """
    base_origin = settings.WEB_URL or settings.APP_BASE_URL

    allowed_hosts = []
    if base_origin:
        host = urlparse(base_origin).netloc
        allowed_hosts.append(host)
    if settings.ADMIN_BASE_URL:
        # Get only the host
        host = urlparse(settings.ADMIN_BASE_URL).netloc
        allowed_hosts.append(host)
    if settings.SPACE_BASE_URL:
        # Get only the host
        host = urlparse(settings.SPACE_BASE_URL).netloc
        allowed_hosts.append(host)
    return allowed_hosts


def validate_next_path(next_path: str) -> str:
    """Return ``next_path`` if it passes redirect-safety checks, else an empty string.

    Rejects empty / non-string input, inputs longer than 500 characters,
    absolute URLs (any scheme or netloc -- only the path component
    survives), inputs that do not start with ``/``, parent-directory
    traversal sequences (``..``), and inputs flagged by
    :func:`_contains_suspicious_patterns`. Backslashes are stripped
    before parsing because browsers interpret them as forward slashes.
    """
    # Browsers interpret backslashes as forward slashes. Remove all backslashes.
    if not next_path or not isinstance(next_path, str):
        return ""

    # Limit input length to prevent DoS attacks
    if len(next_path) > 500:
        return ""

    next_path = next_path.replace("\\", "")
    parsed_url = urlparse(next_path)

    # Block absolute URLs or anything with scheme/netloc
    if parsed_url.scheme or parsed_url.netloc:
        next_path = parsed_url.path  # Extract only the path component

    # Must start with a forward slash and not be empty
    if not next_path or not next_path.startswith("/"):
        return ""

    # Prevent path traversal
    if ".." in next_path:
        return ""

    # Additional security checks
    if _contains_suspicious_patterns(next_path):
        return ""

    return next_path


def get_safe_redirect_url(base_url: str, next_path: str = "", params: dict = {}) -> str:
    """Build a safe redirect URL combining ``base_url`` with a validated ``next_path``.

    Used after login/signup to honor the user's intended landing page
    while defending against open-redirect abuse. The ``next_path`` is
    sanitized via :func:`validate_next_path` and the assembled URL is
    verified against :func:`get_allowed_hosts` using Django's
    ``url_has_allowed_host_and_scheme``; if the final URL fails that
    check, the function falls back to ``base_url`` with only the extra
    ``params`` appended.
    """
    from urllib.parse import urlencode

    # Validate the next path
    validated_path = validate_next_path(next_path)

    # Add the next path to the parameters
    base_url = base_url.rstrip("/")

    # Prepare the query parameters
    query_parts = []
    encoded_params = ""

    # Add the next path to the parameters
    if validated_path:
        query_parts.append(f"next_path={validated_path}")

    # Add additional parameters
    if params:
        encoded_params = urlencode(params)
        query_parts.append(encoded_params)

    # Construct the url query string
    if query_parts:
        query_string = "&".join(query_parts)
        url = f"{base_url}/?{query_string}"
    else:
        url = base_url

    # Check if the URL is allowed
    if url_has_allowed_host_and_scheme(url, allowed_hosts=get_allowed_hosts()):
        return url

    # Return the base URL if the URL is not allowed
    return base_url + (f"?{encoded_params}" if encoded_params else "")
