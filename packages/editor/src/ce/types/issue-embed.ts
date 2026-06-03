/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue embed configuration contracts for the editor's embed extension family.
 */

/**
 * Top-level embed configuration container.
 *
 * Currently exposes only `issue?` (optional). Consumers pass this to editor
 * instances to enable issue-embed widgets in the document.
 */
export type TEmbedConfig = {
  issue?: TIssueEmbedConfig;
};

/**
 * Alias of `TEmbedConfig` used in read-only editor mounts.
 *
 * Currently identical to `TEmbedConfig` — preserved as a distinct name so
 * future read-only-specific constraints can be added without breaking call
 * sites that use the alias.
 */
export type TReadOnlyEmbedConfig = TEmbedConfig;

/**
 * Issue embed widget callback contract.
 *
 * @property widgetCallback - Caller-provided React node factory invoked when
 * the editor renders an issue embed node. Receives `issueId` (always present),
 * `projectId` (optional), and `workspaceSlug` (optional); returns a
 * `React.ReactNode` (typically the application's issue preview card from
 * `apps/web`). `projectId` and `workspaceSlug` are optional because issue
 * references in cross-workspace contexts (e.g., notification deep-links,
 * shared embeds) may not carry full ancestry; callers must handle undefined
 * values defensively.
 */
export type TIssueEmbedConfig = {
  widgetCallback: ({
    issueId,
    projectId,
    workspaceSlug,
  }: {
    issueId: string;
    projectId: string | undefined;
    workspaceSlug: string | undefined;
  }) => React.ReactNode;
};
