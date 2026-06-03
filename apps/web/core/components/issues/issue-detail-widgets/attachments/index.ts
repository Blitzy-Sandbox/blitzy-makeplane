/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel re-export aggregator for the issue-detail attachments widget.
 *
 * Re-exports the public surface of the attachments collapsible — `AttachmentsCollapsible`
 * (root), `IssueAttachmentsCollapsibleTitle`, `IssueAttachmentsCollapsibleContent`,
 * and `IssueAttachmentActionButton` — so that consumers can import from
 * `@/components/issues/issue-detail-widgets/attachments` instead of the individual files.
 *
 * Consumers: `apps/web/core/components/issues/issue-detail-widgets/root.tsx` and any
 * sibling widget aggregators that compose the issue-detail widgets surface.
 */

export * from "./content";
export * from "./title";
export * from "./root";
export * from "./quick-action-button";
