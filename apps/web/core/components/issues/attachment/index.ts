/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel aggregator for the issue attachments feature, re-exporting the public
 * surface from `./root` (currently `IssueAttachmentRoot` + `TIssueAttachmentRoot`).
 *
 * Consumers: imported by issue-detail screens through `@/components/issues/attachment` —
 * e.g., `apps/web/core/components/issues/issue-detail-widgets/attachments/content.tsx`
 * pulls `IssueAttachmentItemList` from `../../attachment/attachment-item-list` directly,
 * and the root export is consumed by issue-detail page composition.
 */

export * from "./root";
