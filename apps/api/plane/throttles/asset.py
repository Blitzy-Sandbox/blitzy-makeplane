# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF throttle classes for asset-scoped rate limiting.

Throttle state is stored in Django's default cache backend (Redis in this
deployment) — note that Redis is used here for caching only; Celery task
queueing routes through RabbitMQ, not Redis.
"""

from rest_framework.throttling import SimpleRateThrottle


class AssetRateThrottle(SimpleRateThrottle):
    """Rate-limit requests addressing a single asset by its URL ``asset_id``.

    Scope: per-asset-id (independent of user or IP). Rate: resolved from
    ``REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["asset_id"]`` in
    ``plane/settings/common.py`` (currently ``5/minute``). Throttle buckets
    are keyed ``throttle_asset_<asset_id>`` so requests targeting the same
    asset share a bucket while different assets are tracked independently.
    Requests that do not expose an ``asset_id`` URL kwarg bypass this
    throttle.

    Consumer: ``DuplicateAssetEndpoint`` in
    ``apps/api/plane/app/views/asset/v2.py``.
    """

    scope = "asset_id"

    def get_cache_key(self, request, view):
        """Return the per-asset throttle bucket key, or ``None`` to bypass.

        Reads ``asset_id`` from ``view.kwargs`` (URL routing context) and
        returns ``throttle_asset_<asset_id>``. Returning ``None`` instructs
        DRF's ``SimpleRateThrottle.allow_request`` to skip throttling —
        which is the intended behavior when the throttle is mistakenly
        applied to a view that does not capture ``asset_id`` in its URL
        pattern.
        """
        asset_id = view.kwargs.get("asset_id")
        if not asset_id:
            return None
        return f"throttle_asset_{asset_id}"
