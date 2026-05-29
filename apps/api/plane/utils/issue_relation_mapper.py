# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Bidirectional issue-relation token mapping.

Issue relations are persisted in both directions so list endpoints on either
side of the relation can surface it cheaply. This module supplies the
forward/inverse token mapping for the four supported relation kinds:

  - ``start_after``    <-> ``start_before``
  - ``finish_after``   <-> ``finish_before``
  - ``blocked_by``     <-> ``blocking``
  - ``implemented_by`` <-> ``implements``

Persisting both directions matters because, for example, when issue A is
``blocked_by`` issue B the inverse must be persisted on B as ``blocking`` A
so that list endpoints scoped to B can surface the relation without having
to scan A's relation set.

Consumers: ``plane.app.views.issue.relation`` and the IssueRelation save
signals that persist the inverse row whenever a new relation is created.
"""


def get_inverse_relation(relation_type):
    """Return the inverse of an issue-relation token (e.g., ``blocked_by`` -> ``blocking``)."""
    relation_mapping = {
        "start_after": "start_before",
        "finish_after": "finish_before",
        "blocked_by": "blocking",
        "blocking": "blocked_by",
        "start_before": "start_after",
        "finish_before": "finish_after",
        "implemented_by": "implements",
        "implements": "implemented_by",
    }
    return relation_mapping.get(relation_type, relation_type)


def get_actual_relation(relation_type):
    """Return the canonical/user-facing relation token from a possibly-inverse token."""
    # This function is used to get the actual relation type which is stored in database
    actual_relation = {
        "start_after": "start_before",
        "finish_after": "finish_before",
        "blocking": "blocked_by",
        "blocked_by": "blocked_by",
        "start_before": "start_before",
        "finish_before": "finish_before",
        "implemented_by": "implemented_by",
        "implements": "implemented_by",
    }

    return actual_relation.get(relation_type, relation_type)
