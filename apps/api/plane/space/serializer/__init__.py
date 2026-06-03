# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public barrel for the ``plane.space.serializer`` package.

Re-exports the serializer classes that form the published API surface of the
``plane.space`` domain -- the anonymous public read surface mounted under
``api/public/`` and consumed by published deploy boards:

* :class:`.user.UserLiteSerializer` -- compact ``User`` projection (id, names,
  avatar, ``is_bot``) used in nested actor fields on public issue, comment,
  reaction, and vote payloads.
* :class:`.issue.LabelLiteSerializer` -- compact ``Label`` projection
  (``id``/``name``/``color``) for nested issue/comment label arrays.
* :class:`.issue.IssuePublicSerializer` -- deliberately narrow ``Issue``
  payload (every field read-only) safe for anonymous traffic on published
  boards; foreign-key relations are flattened to ``module_ids`` /
  ``label_ids`` / ``assignee_ids`` UUID lists so the public surface never
  leaks workspace-internal records.
* :class:`.state.StateSerializer` -- full ``State`` model serializer used by
  state listings on published boards.

Consumers should import from ``plane.space.serializer`` rather than the
implementation modules so the internal module structure of the package
can evolve without breaking call sites.
"""

from .user import UserLiteSerializer

from .issue import LabelLiteSerializer, IssuePublicSerializer

from .state import StateSerializer
