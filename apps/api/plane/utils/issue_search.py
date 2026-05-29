# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Case-insensitive issue search by name, sequence ID, and project identifier.

Used by :class:`plane.app.views.search.issue.IssueSearchEndpoint` (via the
``search_issues_by_query`` helper) to filter an ``Issue`` queryset by a
free-text query supplied through the search endpoints.

Search columns (all OR-combined, then ``.distinct()`` applied):

- ``name`` -- issue title; matched via ``__icontains`` against the full query.
- ``sequence_id`` -- per-project numeric ID; numeric tokens extracted from
  the query via word-boundary regex (only when ``len(query) <= 20``) and
  matched exactly.
- ``project__identifier`` -- project shortcode; matched via ``__icontains``
  against the full query.

A query like ``"PROJ-123"`` therefore primarily resolves through the
``sequence_id == 123`` clause (the ``"PROJ"`` shortcode is matched only if
it appears as a substring of ``project__identifier`` or ``name``). Callers
that need a strict ``shortcode + sequence_id`` pair must filter the
returned queryset further (e.g. by ``project_id``).
"""

# Python imports
import re

# Django imports
from django.db.models import Q

# Module imports


def search_issues(query, queryset):
    """Filter ``queryset`` by name, sequence ID, and project identifier search.

    The query is matched case-insensitively. ``name`` and
    ``project__identifier`` use ``__icontains`` against the full ``query``
    string; ``sequence_id`` is matched exactly against numeric tokens
    extracted from ``query`` via a word-boundary regex (only when
    ``len(query) <= 20`` to bound regex cost on pathological input). All
    column clauses are OR-combined into a single ``Q`` expression, and the
    resulting queryset has ``.distinct()`` applied to deduplicate rows that
    matched on multiple columns.
    """
    fields = ["name", "sequence_id", "project__identifier"]
    q = Q()
    for field in fields:
        if field == "sequence_id" and len(query) <= 20:
            sequences = re.findall(r"\b\d+\b", query)
            for sequence_id in sequences:
                q |= Q(**{"sequence_id": sequence_id})
        else:
            q |= Q(**{f"{field}__icontains": query})
    return queryset.filter(q).distinct()
