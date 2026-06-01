# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task: crawl external URLs to enrich :class:`IssueLink` rows with title + favicon.

Trigger: explicit ``crawl_work_item_link_title.delay(id, url)`` from
``apps/api/plane/api/views/issue.py`` and
``apps/api/plane/app/views/issue/link.py`` whenever an
:class:`~plane.db.models.IssueLink` row is created with an external URL.

SSRF prevention: :func:`validate_url_ip` resolves the target host via DNS
and rejects URLs that resolve to private (RFC 1918), loopback, link-local,
or reserved IPs so the Celery worker cannot be coerced into probing the
internal network or cloud-metadata endpoints. :func:`safe_get` re-validates
every redirect hop before following it and caps the redirect chain at
``MAX_REDIRECTS`` to defeat redirect-loop SSRF gadgets.

Favicon handling: ``DEFAULT_FAVICON`` (a base64-encoded SVG link icon) is
used as a fallback when the page declares no favicon, the favicon is
unreachable, or the favicon fetch raises.

Async infrastructure: queued onto **RabbitMQ** and consumed by Celery
workers (per AAP architectural rule -- Redis is **not** the task broker;
Redis is reserved for caching and session state).
"""

# Python imports
import logging
import socket

# Third party imports
from celery import shared_task
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse, urljoin
import base64
import ipaddress
from typing import Dict, Any, Tuple
from typing import Optional
from plane.db.models import IssueLink
from plane.utils.exception_logger import log_exception

logger = logging.getLogger("plane.worker")


DEFAULT_FAVICON = "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLWxpbmstaWNvbiBsdWNpZGUtbGluayI+PHBhdGggZD0iTTEwIDEzYTUgNSAwIDAgMCA3LjU0LjU0bDMtM2E1IDUgMCAwIDAtNy4wNy03LjA3bC0xLjcyIDEuNzEiLz48cGF0aCBkPSJNMTQgMTFhNSA1IDAgMCAwLTcuNTQtLjU0bC0zIDNhNSA1IDAgMCAwIDcuMDcgNy4wN2wxLjcxLTEuNzEiLz48L3N2Zz4="  # noqa: E501


def validate_url_ip(url: str) -> None:
    """Reject ``url`` if its host resolves to a private, loopback, link-local, or reserved IP (SSRF prevention).

    Resolves the URL's host via DNS and rejects ranges that would let an
    attacker use the Celery worker as a probe against the internal network:
    private (RFC 1918), loopback (``127.0.0.0/8``, ``::1``), link-local
    (``169.254.0.0/16``), and any IPv4/IPv6 range flagged by
    :mod:`ipaddress` as reserved. Also restricts the scheme to ``http`` /
    ``https`` to block ``file://``, ``gopher://`` and similar SSRF gadgets.

    SECURITY-CRITICAL: this check must not be removed or weakened -- it is
    the only barrier preventing the worker from being coerced into probing
    cloud-metadata services (e.g. ``169.254.169.254``) or internal hosts.

    Args:
        url: The URL to validate.

    Raises:
        ValueError: If the URL has no hostname, uses a non-HTTP(S) scheme,
            cannot be resolved, or resolves to any blocked IP range.
    """
    parsed = urlparse(url)
    hostname = parsed.hostname

    if not hostname:
        raise ValueError("Invalid URL: No hostname found")

    # Only allow HTTP and HTTPS to prevent file://, gopher://, etc.
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Invalid URL scheme. Only HTTP and HTTPS are allowed")

    # Resolve hostname to IP addresses — this catches domain names that
    # point to internal IPs (e.g. attacker.com -> 169.254.169.254)

    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise ValueError("Hostname could not be resolved")

    if not addr_info:
        raise ValueError("No IP addresses found for the hostname")

    # Check every resolved IP against blocked ranges to prevent SSRF
    for addr in addr_info:
        ip = ipaddress.ip_address(addr[4][0])
        if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local:
            raise ValueError("Access to private/internal networks is not allowed")


MAX_REDIRECTS = 5


def safe_get(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 1,
) -> Tuple[requests.Response, str]:
    """
    Perform a GET request that validates every redirect hop against private IPs.

    Prevents SSRF by ensuring no redirect lands on a private/internal address:
    each ``Location`` header is resolved relative to the previous URL,
    re-validated via :func:`validate_url_ip`, and the chain is aborted after
    ``MAX_REDIRECTS`` hops.

    Args:
        url: The URL to fetch
        headers: Optional request headers
        timeout: Request timeout in seconds

    Returns:
        A tuple of (final Response object, final URL after redirects)

    Raises:
        ValueError: If any URL in the redirect chain points to a private IP
        requests.RequestException: On network errors
        RuntimeError: If max redirects exceeded
    """
    validate_url_ip(url)

    current_url = url
    response = requests.get(
        current_url, headers=headers, timeout=timeout, allow_redirects=False
    )

    redirect_count = 0
    while response.is_redirect:
        if redirect_count >= MAX_REDIRECTS:
            raise RuntimeError(f"Too many redirects for URL: {url}")
        redirect_url = response.headers.get("Location")
        if not redirect_url:
            break
        current_url = urljoin(current_url, redirect_url)
        validate_url_ip(current_url)
        redirect_count += 1
        response = requests.get(
            current_url, headers=headers, timeout=timeout, allow_redirects=False
        )

    return response, current_url


def crawl_work_item_link_title_and_favicon(url: str) -> Dict[str, Any]:
    """
    Crawls a URL to extract the title and favicon.

    Args:
        url (str): The URL to crawl

    Returns:
        str: JSON string containing title and base64-encoded favicon
    """
    try:
        # Set up headers to mimic a real browser
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"  # noqa: E501
        }

        soup = None
        title = None
        final_url = url

        try:
            response, final_url = safe_get(url, headers=headers)

            soup = BeautifulSoup(response.content, "html.parser")
            title_tag = soup.find("title")
            title = title_tag.get_text().strip() if title_tag else None

        except requests.RequestException as e:
            logger.warning(f"Failed to fetch HTML for title: {str(e)}")
        except (ValueError, RuntimeError) as e:
            logger.warning(f"URL validation failed: {str(e)}")

        # Fetch and encode favicon using final URL (after redirects) for correct relative href resolution
        favicon_base64 = fetch_and_encode_favicon(headers, soup, final_url)

        # Prepare result
        result = {
            "title": title,
            "favicon": favicon_base64["favicon_base64"],
            "url": url,
            "favicon_url": favicon_base64["favicon_url"],
        }

        return result

    except Exception as e:
        log_exception(e)
        return {
            "error": f"Unexpected error: {str(e)}",
            "title": None,
            "favicon": None,
            "url": url,
        }


def find_favicon_url(soup: Optional[BeautifulSoup], base_url: str) -> Optional[str]:
    """
    Find the favicon URL from HTML soup.

    Args:
        soup: BeautifulSoup object
        base_url: Base URL for resolving relative paths

    Returns:
        str: Absolute URL to favicon or None
    """
    if soup is not None:
        # Look for various favicon link tags
        favicon_selectors = [
            'link[rel="icon"]',
            'link[rel="shortcut icon"]',
            'link[rel="apple-touch-icon"]',
            'link[rel="apple-touch-icon-precomposed"]',
        ]

        for selector in favicon_selectors:
            favicon_tag = soup.select_one(selector)
            if favicon_tag and favicon_tag.get("href"):
                favicon_href = urljoin(base_url, favicon_tag["href"])
                validate_url_ip(favicon_href)
                return favicon_href

    # Fallback to /favicon.ico
    parsed_url = urlparse(base_url)
    fallback_url = f"{parsed_url.scheme}://{parsed_url.netloc}/favicon.ico"

    # Check if fallback exists
    try:
        validate_url_ip(fallback_url)
        response = requests.head(fallback_url, timeout=2, allow_redirects=False)

        if response.status_code == 200:
            return fallback_url
    except requests.RequestException as e:
        log_exception(e, warning=True)
        return None

    return None


def fetch_and_encode_favicon(
    headers: Dict[str, str], soup: Optional[BeautifulSoup], url: str
) -> Dict[str, Optional[str]]:
    """
    Fetch favicon and encode it as base64.

    Args:
        favicon_url: URL to the favicon
        headers: Request headers

    Returns:
        str: Base64 encoded favicon with data URI prefix or None
    """
    try:
        favicon_url = find_favicon_url(soup, url)
        if favicon_url is None:
            return {
                "favicon_url": None,
                "favicon_base64": f"data:image/svg+xml;base64,{DEFAULT_FAVICON}",
            }

        response, _ = safe_get(favicon_url, headers=headers)

        # Get content type
        content_type = response.headers.get("content-type", "image/x-icon")

        # Convert to base64
        favicon_base64 = base64.b64encode(response.content).decode("utf-8")

        # Return as data URI
        return {
            "favicon_url": favicon_url,
            "favicon_base64": f"data:{content_type};base64,{favicon_base64}",
        }

    except Exception as e:
        logger.warning(f"Failed to fetch favicon: {e}")
        return {
            "favicon_url": None,
            "favicon_base64": f"data:image/svg+xml;base64,{DEFAULT_FAVICON}",
        }


@shared_task
def crawl_work_item_link_title(id: str, url: str) -> None:
    """Crawl ``url`` for ``<title>`` + favicon and persist them on ``IssueLink(id=id).metadata``.

    Trigger:
        Explicit ``crawl_work_item_link_title.delay(id, url)`` from
        ``apps/api/plane/api/views/issue.py`` and
        ``apps/api/plane/app/views/issue/link.py`` whenever an
        :class:`~plane.db.models.IssueLink` row is created with an external
        URL. The Celery message is routed via **RabbitMQ** and consumed by
        the worker.

    Side effects:
        - DNS + SSRF check via :func:`validate_url_ip` (rejects private,
          loopback, link-local, and reserved IPs as well as non-HTTP(S)
          schemes).
        - External HTTP: :func:`safe_get` fetches the page HTML, re-validating
          every redirect hop and capping the chain at ``MAX_REDIRECTS``.
        - HTML parse (BeautifulSoup): extracts the ``<title>`` text and the
          favicon URL (``<link rel="icon">``, ``<link rel="shortcut icon">``,
          and Apple-touch variants); falls back to ``/favicon.ico``.
        - External HTTP (favicon): fetches the favicon image; falls back to
          ``DEFAULT_FAVICON`` (a base64 SVG placeholder) if the fetch fails
          or returns invalid content.
        - Base64 encoding: encodes the favicon bytes as a ``data:`` URI so
          the UI can render the icon inline without additional network
          requests.
        - DB write: stores the resulting dict
          ``{title, favicon, url, favicon_url}`` in :attr:`IssueLink.metadata`
          (a ``JSONField``) and calls ``.save()``. The dedicated
          :attr:`IssueLink.title` field is **not** overwritten by this task.
        - No emails, no webhook fan-out, no cache invalidation.

    Idempotency:
        IDEMPOTENT in result: repeated invocations on the same ``(id, url)``
        converge on the same persisted state, assuming the remote page is
        stable. Each call still issues outbound HTTP requests, so repeated
        invocations are observable by the remote host. If the ``IssueLink``
        row no longer exists the task logs a warning and returns silently,
        so stale messages on the queue do not crash the worker.

    Args:
        id: Primary key of the :class:`IssueLink` row to update.
        url: External URL to crawl.
    """
    meta_data = crawl_work_item_link_title_and_favicon(url)

    try:
        issue_link = IssueLink.objects.get(id=id)
    except IssueLink.DoesNotExist:
        logger.warning(f"IssueLink not found for the id {id} and the url {url}")
        return

    issue_link.metadata = meta_data
    issue_link.save()
