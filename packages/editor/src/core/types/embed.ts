/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Picker-row contract for entities the editor's work-item embed extension
 * can insert as ProseMirror nodes.
 *
 * Consumers: `core/extensions/work-item-embed/` (host applications pass a
 * resolved list of `TEmbedItem` records to the slash-command / suggestion
 * UI, then the selected row is converted into a `WorkItemEmbed` node
 * whose attributes are defined by `TWorkItemEmbedAttributes` in the same
 * extension folder).
 */

/**
 * Presentation- and scoping-shape for a single row in the work-item embed
 * picker — `id`, `title`, and `subTitle` drive the rendered list item;
 * `icon`, `projectId`, and `workspaceSlug` carry semantics that are not
 * obvious from the field names alone.
 *
 * Non-obvious field semantics:
 *   - `icon` is a pre-rendered `React.ReactNode` (typically a JSX
 *     element such as `<IssueIcon />`), never a URL or icon name. Host
 *     applications resolve their icon component once and pass the JSX
 *     node directly so the picker can render it without further lookup.
 *   - `projectId` + `workspaceSlug` are required scoping fields, not
 *     ambient context — the embed extension serializes them onto the
 *     inserted node (mapped to `project_identifier` and
 *     `workspace_identifier` attributes in
 *     `core/extensions/work-item-embed/extension-config.ts`) so a
 *     collaborator opening the document later can resolve the embedded
 *     entity against the correct workspace/project boundary, even when
 *     the rendering session is scoped to a different workspace than the
 *     author's at insertion time.
 */
export type TEmbedItem = {
  id: string;
  title: string;
  subTitle: string;
  icon: React.ReactNode;
  projectId: string;
  workspaceSlug: string;
};
