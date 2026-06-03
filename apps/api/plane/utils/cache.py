# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""HTTP response caching decorators backed by Django's cache framework.

Provides :func:`cache_response` (read-side memoization) and
:func:`invalidate_cache` / :func:`invalidate_cache_directly` (write-side
invalidation) for DRF view methods.

Cache backend: Django cache framework configured against Redis (see
``plane.settings.redis``). Redis is caching and session storage ONLY;
background task queueing uses Celery brokered by RabbitMQ -- never
enqueue work via ``cache.set``.

Cache key composition: the requested path (or a caller-supplied
``path``) is concatenated with the authenticated user's ID using a
``:`` separator when ``user=True``, producing a stable per-user key
suitable for Redis.

Default TTL: 60 minutes (``timeout=60 * 60``).

Consumers: read-side endpoints in ``plane.app.views.*`` wrap their
``list``/``retrieve`` methods with :func:`cache_response`; mutating
endpoints (POST/PATCH/DELETE) wrap with :func:`invalidate_cache` so
the next read recomputes.
"""

# Python imports
from functools import wraps

# Django imports
from django.conf import settings
from django.core.cache import cache

# Third party imports
from rest_framework.response import Response


def generate_cache_key(custom_path, auth_header=None):
    """Compose a deterministic cache key from a path and optional auth identifier.

    Returns ``"{custom_path}:{auth_header}"`` when ``auth_header`` is
    provided, or ``custom_path`` alone otherwise. Callers typically pass
    the authenticated user's ID as ``auth_header`` so each user receives
    a distinct, user-scoped cache entry.
    """
    if auth_header:
        key_data = f"{custom_path}:{auth_header}"
    else:
        key_data = custom_path
    return key_data


def cache_response(timeout=60 * 60, path=None, user=True):
    """Memoize a DRF view method's response in Redis for ``timeout`` seconds.

    Wraps the inner view method so the first call within the TTL computes
    and caches its :class:`~rest_framework.response.Response`; subsequent
    calls return the cached payload. Pass ``user=False`` for endpoints
    whose response is identical across users (the user ID is omitted from
    the cache key); pass ``path`` to use a fixed key instead of
    ``request.get_full_path()``. Caching is suppressed when
    ``settings.DEBUG`` is true or the response status is not 200.
    """

    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(instance, request, *args, **kwargs):
            # Function to generate cache key
            auth_header = None if request.user.is_anonymous else str(request.user.id) if user else None
            custom_path = path if path is not None else request.get_full_path()
            key = generate_cache_key(custom_path, auth_header)
            cached_result = cache.get(key)

            if cached_result is not None:
                return Response(cached_result["data"], status=cached_result["status"])
            response = view_func(instance, request, *args, **kwargs)
            if response.status_code == 200 and not settings.DEBUG:
                cache.set(
                    key,
                    {"data": response.data, "status": response.status_code},
                    timeout,
                )

            return response

        return _wrapped_view

    return decorator


def invalidate_cache_directly(path=None, url_params=False, user=True, request=None, multiple=False):
    """Delete the cached entry (or all matching entries when ``multiple=True``) for the given path.

    Reconstructs the same key :func:`cache_response` would compute (using
    ``path`` or ``request.get_full_path()`` and the authenticated user's
    ID when ``user=True``). When ``url_params=True`` and ``path`` is
    provided, ``:name`` placeholders in ``path`` are substituted from the
    request's resolver kwargs before key generation. With
    ``multiple=True``, every Redis key matching ``*<key>*`` is removed
    via ``cache.delete_many`` (requires the ``django-redis`` backend for
    ``cache.keys`` pattern support).
    """
    if url_params and path:
        path_with_values = path
        # Assuming `kwargs` could be passed directly if needed, otherwise, skip this part
        for key, value in request.resolver_match.kwargs.items():
            path_with_values = path_with_values.replace(f":{key}", str(value))
        custom_path = path_with_values
    else:
        custom_path = path if path is not None else request.get_full_path()
    auth_header = None if request and request.user.is_anonymous else str(request.user.id) if user else None
    key = generate_cache_key(custom_path, auth_header)

    if multiple:
        cache.delete_many(keys=cache.keys(f"*{key}*"))
    else:
        cache.delete(key)


def invalidate_cache(path=None, url_params=False, user=True, multiple=False):
    """Invalidate matching cached response(s) before the wrapped mutating view method runs.

    Decorator counterpart to :func:`invalidate_cache_directly`; arguments
    are forwarded verbatim. Use ``multiple=True`` to invalidate every
    URL-parameter permutation under a path so the next read recomputes
    from the database.
    """

    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(instance, request, *args, **kwargs):
            # invalidate the cache
            invalidate_cache_directly(
                path=path,
                url_params=url_params,
                user=user,
                request=request,
                multiple=multiple,
            )
            return view_func(instance, request, *args, **kwargs)

        return _wrapped_view

    return decorator
