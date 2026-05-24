/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Reserved placeholder module for future issue-subscription type contracts inside the
 * `@plane/types/issues` subfolder; no `TIssueSubscription` record type is declared yet
 * because issue-subscription state is currently surfaced only as the boolean
 * `is_subscribed?: boolean` field on `TIssue` (see `./issue.ts`). The authoritative
 * subscription record model lives on the backend at
 * `apps/api/plane/db/models/issue.py::IssueSubscriber`, and a dedicated
 * `TIssueSubscription` interface mirroring that Django model would be added here if
 * frontend consumers ever need to read raw subscriber records rather than the derived
 * per-viewer boolean. This file is intentionally NOT re-exported by the folder's
 * de-facto barrel `./base.ts`, so it is not part of the `@plane/types` public API
 * surface today.
 */
