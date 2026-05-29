# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""SSRF-aware URL validation and client IP extraction.

:func:`validate_url` defends against Server-Side Request Forgery at egress
by resolving the URL's hostname to an IP and rejecting:

  - Private, loopback, link-local, and reserved IP ranges
    (unless explicitly allowlisted via ``allowed_ips``).
  - Hostnames not in ``allowed_hosts`` when that allowlist is non-empty.
  - URL schemes other than ``http`` and ``https``.

This protects critical egress paths -- webhook delivery (``plane.bgtasks
.webhook_task``), webhook URL registration (``plane.app.serializers
.webhook``), and outbound link enrichment (``plane.bgtasks
.work_item_link_task``) -- from being coerced into hitting internal
services (e.g., cloud metadata at ``169.254.169.254`` or internal
databases) via attacker-controlled hostnames.

:func:`get_client_ip` extracts the originating client IP from a Django
request by inspecting the first ``HTTP_X_FORWARDED_FOR`` hop (set by the
nginx/CloudFront reverse proxy) and falling back to ``REMOTE_ADDR``.
Used by audit logs (``plane.middleware.logger``), login IP tracking
(``plane.license.api.views.admin``, ``plane.authentication``), and the
:mod:`plane.utils.host` ``user_ip`` re-export.
"""

# Python imports
import ipaddress
import socket
from urllib.parse import urlparse


def validate_url(url, allowed_ips=None, allowed_hosts=None):
    """Validate that ``url`` resolves to an IP/host permitted for outbound requests.

    Defends against SSRF by resolving the URL's hostname and rejecting:

      - private, loopback, link-local, and reserved IP ranges
        (unless explicitly allowlisted via ``allowed_ips``);
      - hostnames not in ``allowed_hosts`` when that allowlist is non-empty;
      - URL schemes other than ``http`` and ``https``.

    Returns ``None`` on success; SSRF policy violations and resolution
    failures surface as :class:`ValueError` so callers can fail closed
    before any outbound request is issued. An ``allowed_hosts`` match
    short-circuits the IP resolution step entirely, intended for trusted
    internal services whose container IPs would otherwise trip the
    private-range block.

    Args:
        url: The URL to validate.
        allowed_ips: Optional iterable of :class:`ipaddress.ip_network`
            objects whose members bypass the private/loopback/reserved/
            link-local block. Typically sourced from the
            ``WEBHOOK_ALLOWED_IPS`` setting.
        allowed_hosts: Optional iterable of hostnames (compared exact,
            case-insensitive, and trailing-dot tolerant) that bypass
            IP-based blocking entirely. Typically sourced from the
            ``WEBHOOK_ALLOWED_HOSTS`` setting for trusted internal
            services (e.g., Silo) whose IPs are dynamic in containerised
            deployments.

    Raises:
        ValueError: If the URL has no hostname, uses an unsupported
            scheme, cannot be resolved, or resolves to a blocked IP.
    """
    parsed = urlparse(url)
    hostname = parsed.hostname

    if not hostname:
        raise ValueError("Invalid URL: No hostname found")

    if parsed.scheme not in ("http", "https"):
        raise ValueError("Invalid URL scheme. Only HTTP and HTTPS are allowed")

    normalized_host = hostname.rstrip(".").lower()
    if allowed_hosts and normalized_host in {
        (h or "").rstrip(".").lower() for h in allowed_hosts if h
    }:
        return

    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise ValueError("Hostname could not be resolved")

    if not addr_info:
        raise ValueError("No IP addresses found for the hostname")

    for addr in addr_info:
        ip = ipaddress.ip_address(addr[4][0])
        if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local:
            if allowed_ips and any(
                network.version == ip.version and ip in network for network in allowed_ips
            ):
                continue
            raise ValueError("Access to private/internal networks is not allowed")


def get_client_ip(request):
    """Extract the originating client IP from a Django ``request``.

    Reads the first hop of ``HTTP_X_FORWARDED_FOR`` when present (set by
    the nginx/CloudFront reverse proxy) and falls back to ``REMOTE_ADDR``.
    Returns ``None`` when neither header is populated; callers must
    tolerate missing IPs in audit/log paths.
    """
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        ip = x_forwarded_for.split(",")[0]
    else:
        ip = request.META.get("REMOTE_ADDR")
    return ip
