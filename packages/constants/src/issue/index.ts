/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue constants barrel re-exporting `common` (vocabulary, group-by/order-by, display properties), `filter` (rich filters + activity helpers), `layout` (layout catalog and `TIssueLayout`), and `modal` (work-item form defaults).
 * Cross-stack contract: priority and comment-access string values mirror Django choices in `apps/api/plane/db/models/issue.py` and are enforced by `apps/api/plane/app/serializers/issue.py`; consumers include `apps/web/core/components/issues/**` and `apps/web/core/store/issue/**`.
 */

export * from "./common";
export * from "./filter";
export * from "./layout";
export * from "./modal";
