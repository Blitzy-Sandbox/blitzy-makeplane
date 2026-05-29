# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL pattern detection and component-extraction helpers.

Provides:
  - :data:`URL_PATTERN`        — compiled regex that matches HTTP(S) URLs in
    free text (used to reject URLs in user-controlled name/slug input and
    to flag/extract links in comment and description bodies).
  - :func:`contains_url`       — True if a text body contains at least one URL.
  - :func:`is_valid_url`       — True if a URL string has a parseable scheme
    and netloc.
  - :func:`get_url_components` — parse a URL into its
    ``scheme``/``netloc``/``path``/``params``/``query``/``fragment`` parts.
  - :func:`normalize_url_path` — collapse duplicate slashes in a URL path.

This module performs URL parsing and matching only; it deliberately does
not implement any security predicate. Related modules:
  - :mod:`plane.utils.path_validator` — open-redirect protection (validates
    that a post-login ``next`` URL points to a permitted host/path).
  - :mod:`plane.utils.ip_address` — SSRF protection (resolves a URL's host
    to an IP and enforces a public-address allowlist).

Consumers within :mod:`plane` include the workspace and user serializers
(:func:`contains_url` to reject URLs embedded in display-name and slug
fields), the settings module (:func:`is_valid_url` for boot-time validation
of configured URLs), and the S3 copy background task
(:func:`normalize_url_path` to canonicalize object paths).
"""

# Python imports
import re
from typing import Optional
from urllib.parse import urlparse, urlunparse

# Regex matching HTTP(S) URLs in free text for auto-linking and extraction.
# Compiled regex pattern for better performance and ReDoS protection
# Using atomic groups and length limits to prevent excessive backtracking
URL_PATTERN = re.compile(
    r"(?i)"  # Case insensitive
    r"(?:"  # Non-capturing group for alternatives
    r"https?://[^\s]+"  # http:// or https:// followed by non-whitespace
    r"|"
    r"www\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*"  # noqa: E501
    r"|"
    r"(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,6}"  # noqa: E501
    r"|"
    r"(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)"  # noqa: E501
    r")"
)


def contains_url(value: str) -> bool:
    """
    Check if the value contains a URL.

    This function is protected against ReDoS attacks by:
    1. Using a pre-compiled regex pattern
    2. Limiting input length to prevent excessive processing
    3. Using atomic groups and specific quantifiers to avoid backtracking

    Args:
        value (str): The input string to check for URLs

    Returns:
        bool: True if the string contains a URL, False otherwise
    """
    # Prevent ReDoS by limiting input length
    if len(value) > 1000:  # Reasonable limit for URL detection
        return False

    # Additional safety: truncate very long lines that might contain URLs
    lines = value.split("\n")
    for line in lines:
        if len(line) > 500:  # Process only reasonable length lines
            line = line[:500]
        if URL_PATTERN.search(line):
            return True

    return False


def is_valid_url(url: str) -> bool:
    """
    Validate whether the given string is a well-formed URL.

    Uses :func:`urllib.parse.urlparse`; a URL is considered well-formed if
    it has both a scheme and a netloc. This is a structural check only and
    does NOT enforce SSRF or host-allowlist policies — see
    :mod:`plane.utils.ip_address` for those predicates.

    Args:
        url (str): The URL string to validate.

    Returns:
        bool: True if the URL is valid, False otherwise.

    Example:
        >>> is_valid_url("https://example.com")
        True
        >>> is_valid_url("not a url")
        False
    """
    try:
        result = urlparse(url)
        # A valid URL should have at least scheme and netloc
        return all([result.scheme, result.netloc])
    except TypeError:
        return False


def get_url_components(url: str) -> Optional[dict]:
    """
    Parse the URL and return its components if valid.

    Returns a dict with keys ``scheme``, ``netloc``, ``path``, ``params``,
    ``query``, and ``fragment``. Returns ``None`` when :func:`is_valid_url`
    rejects the input, sparing callers from handling :exc:`ValueError`.

    Args:
        url (str): The URL string to parse.

    Returns:
        Optional[dict]: A dictionary with URL components if valid, None otherwise.

    Example:
        >>> get_url_components("https://example.com/path?query=1")
        {
        'scheme': 'https', 'netloc': 'example.com',
        'path': '/path', 'params': '',
        'query': 'query=1', 'fragment': ''}
    """
    if not is_valid_url(url):
        return None
    result = urlparse(url)
    return {
        "scheme": result.scheme,
        "netloc": result.netloc,
        "path": result.path,
        "params": result.params,
        "query": result.query,
        "fragment": result.fragment,
    }


def normalize_url_path(url: str) -> str:
    """
    Collapse duplicate slashes in the path component of a URL.

    Replaces runs of consecutive slashes in the URL's path with a single
    slash while preserving the protocol, domain, query parameters, and
    fragment unchanged.

    Args:
        url (str): The input URL string to normalize.

    Returns:
        str: The normalized URL with redundant slashes in the path removed.

    Example:
        >>> normalize_url_path('https://example.com//foo///bar//baz?x=1#frag')
        'https://example.com/foo/bar/baz?x=1#frag'
    """
    parts = urlparse(url)
    # Normalize the path
    normalized_path = re.sub(r"/+", "/", parts.path)
    # Reconstruct the URL
    return urlunparse(parts._replace(path=normalized_path))
