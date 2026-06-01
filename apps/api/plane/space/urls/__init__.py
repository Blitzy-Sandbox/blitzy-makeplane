# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL pattern aggregator for the public space API namespace.

Concatenates the route lists exported by sibling modules (``intake_urls``,
``issue_urls``, ``project_urls``, ``asset_urls``) into the single
``urlpatterns`` export that Django's URL resolver consumes for the
``plane.space`` package. The combined patterns are mounted under
``api/public/`` by the root URLconf at ``apps/api/plane/urls.py`` and
serve the anonymous public read surface for published deploy boards.
"""

from .intake import urlpatterns as intake_urls
from .issue import urlpatterns as issue_urls
from .project import urlpatterns as project_urls
from .asset import urlpatterns as asset_urls


urlpatterns = [*intake_urls, *issue_urls, *project_urls, *asset_urls]
