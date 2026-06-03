# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""drf-spectacular preprocessing hooks for schema endpoint shaping.

Two hooks compose the Plane schema generation pipeline:

  - :func:`preprocess_filter_api_v1_paths` -- narrows the endpoint set to only
    ``/api/v1/`` paths and removes PUT methods + paths containing ``"server"``.
    Registered in ``apps/api/plane/settings/openapi.py`` under
    ``SPECTACULAR_SETTINGS["PREPROCESSING_HOOKS"]`` so drf-spectacular invokes
    it once per schema generation before any path is documented.
  - :func:`generate_operation_summary` -- builds a human-readable operation
    summary string (e.g., ``"Archive Cycle"``, ``"Retrieve Issues"``) from
    the HTTP method, URL path, and OpenAPI tag. NOT registered as a
    drf-spectacular hook automatically; consumers call it directly when
    populating ``operation_summary`` overrides.

The schema endpoints (``/api/schema/``, ``/api/schema/swagger-ui/``,
``/api/schema/redoc/``) are mounted only when
``settings.ENABLE_DRF_SPECTACULAR`` is truthy (see the
``if settings.ENABLE_DRF_SPECTACULAR:`` block in :mod:`plane.urls`), so
these hooks run only at schema generation time -- not on every HTTP
request.

These functions perform NO I/O and have NO side effects; they pure-function
transform the in-memory schema representation.
"""


def preprocess_filter_api_v1_paths(endpoints):
    """Filter the drf-spectacular endpoint list to only ``/api/v1/`` non-PUT paths.

    Registered in ``apps/api/plane/settings/openapi.py`` under
    ``SPECTACULAR_SETTINGS["PREPROCESSING_HOOKS"]`` so drf-spectacular calls
    it once per schema generation before any endpoint is converted to an
    OpenAPI Operation.

    Three filters apply:
      - Path MUST start with ``/api/v1/`` (excludes legacy ``/api/`` and
        internal ``/api/v2/`` paths).
      - HTTP method MUST NOT be ``PUT`` (Plane uses ``PATCH`` exclusively).
      - Path MUST NOT contain the substring ``"server"`` (excludes
        instance-management endpoints from the public surface).

    Args:
        endpoints: Iterable of ``(path, path_regex, method, callback)``
            tuples supplied by drf-spectacular.

    Returns:
        list: Filtered ``(path, path_regex, method, callback)`` tuples.
    """
    filtered = []
    for path, path_regex, method, callback in endpoints:
        # Only include paths that start with /api/v1/ and exclude PUT methods
        if path.startswith("/api/v1/") and method.upper() != "PUT" and "server" not in path.lower():
            filtered.append((path, path_regex, method, callback))
    return filtered


def generate_operation_summary(method, path, tag):
    """Generate a human-readable OpenAPI ``summary`` string from method, path, and tag.

    Resolution order:
      1. Special cases bound to path substrings:
         - ``"archive"`` + ``POST``   -> ``"Archive <singularized tag>"``.
         - ``"archive"`` + ``DELETE`` -> ``"Unarchive <singularized tag>"``.
         - ``"transfer"`` (any method) -> ``"Transfer <singularized tag>"``.
      2. Default mapping by HTTP method, using the last non-parameter
         path segment (title-cased) as the resource name:
         - ``GET``    -> ``"Retrieve <resource>"``.
         - ``POST``   -> ``"Create <resource>"``.
         - ``PATCH``  -> ``"Update <resource>"``.
         - ``DELETE`` -> ``"Delete <resource>"``.
      3. Fallback: ``"<METHOD> <resource>"`` for any unmapped method.

    The path segment extraction skips parameter segments (``{id}``, ``{slug}``)
    so the resource name is always a stable identifier.

    Args:
        method: HTTP method string (``"GET"``, ``"POST"``, ``"PATCH"``,
            ``"DELETE"``).
        path: Full URL pattern from drf-spectacular (e.g.,
            ``"/api/v1/workspaces/{slug}/projects/{project_id}/cycles/"``).
        tag: OpenAPI tag for the operation (e.g., ``"Cycles"``).

    Returns:
        str: Human-readable summary string suitable for the OpenAPI
        ``operation.summary`` field.
    """
    # Extract the main resource from the path
    path_parts = [part for part in path.split("/") if part and not part.startswith("{")]

    if len(path_parts) > 0:
        resource = path_parts[-1].replace("-", " ").title()
    else:
        resource = tag

    # Generate summary based on method
    method_summaries = {
        "GET": f"Retrieve {resource}",
        "POST": f"Create {resource}",
        "PATCH": f"Update {resource}",
        "DELETE": f"Delete {resource}",
    }

    # Handle specific cases
    if "archive" in path.lower():
        if method == "POST":
            return f"Archive {tag.rstrip('s')}"
        elif method == "DELETE":
            return f"Unarchive {tag.rstrip('s')}"

    if "transfer" in path.lower():
        return f"Transfer {tag.rstrip('s')}"

    return method_summaries.get(method, f"{method} {resource}")
