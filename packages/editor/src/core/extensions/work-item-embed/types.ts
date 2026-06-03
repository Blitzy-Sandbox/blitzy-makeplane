/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared type/attribute vocabulary for the work-item-embed editor extension.
 *
 * This module is the single, strongly typed source of truth for the
 * attribute names carried on a work-item-embed ProseMirror node. It is
 * consumed by:
 *   - the schema producer in `./extension-config.ts`, whose
 *     `addAttributes()` block declares each field as the raw string key
 *     (TipTap's `addAttributes()` signature requires literal object keys,
 *     so the enum is referenced indirectly via matching string values);
 *   - the runtime React NodeView in `./extension.tsx`, which casts
 *     `node.attrs` to `TWorkItemEmbedAttributes` and reads enum members
 *     to forward `issueId` / `projectId` / `workspaceSlug` to the
 *     host-app `widgetCallback`;
 *   - any non-React render path (PDF export in `apps/live`, plain-HTML
 *     preview in `apps/api`'s `Page.description_html` round-trip) that
 *     must read the same attribute bag without instantiating the React
 *     NodeView.
 *
 * Type-only at the source level: the file declares one `enum` (emitted
 * as a runtime object — `EWorkItemEmbedAttributeNames.ID === "id"` etc.)
 * and one `type` alias (erased at compile time). There are no other
 * runtime side effects.
 *
 * First-party origin: work-item-embed is a Plane-owned custom ProseMirror
 * node (see `CORE_EXTENSIONS.WORK_ITEM_EMBED = "issue-embed-component"`),
 * not a wrapper around an upstream TipTap extension. The names declared
 * here are therefore owned identifiers — renaming an enum value here
 * without updating the matching key in `./extension-config.ts`'s
 * `addAttributes()` would silently break HTML round-tripping and the
 * Y.js-binary → HTML conversion used by the `apps/live` PDF pipeline.
 *
 * Folder-local visibility: these exports are intentionally NOT
 * re-exported via the folder barrel `./index.ts` (which only forwards
 * `./extension`). Consumers within the folder import them by direct
 * relative path; the host app interacts with the embed feature through
 * the `widgetCallback` contract (typed in
 * `packages/editor/src/ce/types/issue-embed.ts`) instead of constructing
 * `TWorkItemEmbedAttributes` objects directly.
 */

/**
 * Canonical, compile-time-safe names for the five serialized
 * HTML/ProseMirror attribute keys carried by a work-item-embed node.
 *
 * Centralizing the keys here prevents string-literal drift between the
 * schema (`./extension-config.ts`'s `addAttributes()` block), the React
 * NodeView (`./extension.tsx`'s `attrs[EWorkItemEmbedAttributeNames.*]`
 * reads), and any other code path that inspects `node.attrs` on a
 * work-item-embed node.
 *
 * Each member's string value matches the exact attribute key emitted in
 * the rendered HTML element — i.e. the attributes that appear on the
 * `<issue-embed-component id="…" entity_identifier="…"
 * project_identifier="…" workspace_identifier="…" entity_name="…">` tag
 * produced by the schema's `renderHTML()` and recognized by its
 * `parseHTML()`. The same strings therefore persist verbatim through
 * `Page.description_html` storage in `apps/api` and through the
 * Y.js-binary → HTML conversion consumed by the `apps/live` PDF export
 * pipeline, so changing a value here without coordinating the schema
 * and downstream consumers would silently break round-tripping.
 */
export enum EWorkItemEmbedAttributeNames {
  /**
   * Node-instance identifier — used by the React NodeView as the
   * `<NodeViewWrapper key={…}>` so React can reconcile this specific
   * embed across document reorderings. NOT the same as
   * `ENTITY_IDENTIFIER` (which identifies the embedded work item).
   */
  ID = "id",
  /**
   * Embedded work item's id (UUID). Forwarded to the host-app
   * `widgetCallback` as `issueId`, with `?? ""` fallback when undefined
   * (see `./extension.tsx`).
   */
  ENTITY_IDENTIFIER = "entity_identifier",
  /**
   * Embedded work item's project id. Forwarded to the host-app
   * `widgetCallback` as `projectId`; may be `undefined` when the
   * project context cannot be resolved.
   */
  PROJECT_IDENTIFIER = "project_identifier",
  /**
   * Embedded work item's workspace slug. Forwarded to the host-app
   * `widgetCallback` as `workspaceSlug`; may be `undefined` when the
   * workspace context cannot be resolved.
   */
  WORKSPACE_IDENTIFIER = "workspace_identifier",
  /**
   * Human-readable label for the embedded work item — useful for
   * non-interactive render paths (PDF export, plain-HTML preview)
   * where the React card cannot fetch the live title from the MobX
   * store.
   */
  ENTITY_NAME = "entity_name",
}

/**
 * Strongly typed shape of the attribute bag carried on a work-item-embed
 * ProseMirror node. The React NodeView casts `node.attrs` to this type
 * (`./extension.tsx`, where
 * `const attrs = issueProps.node.attrs as TWorkItemEmbedAttributes`) so
 * that subsequent enum-indexed reads are checked at compile time.
 *
 * Every field is `string | undefined` because the schema declares each
 * attribute in `./extension-config.ts` with `default: undefined`; a
 * freshly inserted node without explicit attrs therefore has `undefined`
 * across the board. Consumers MUST fail-soft on missing values — the
 * runtime path in `./extension.tsx` applies `?? ""` for the `issueId`
 * arg and forwards `undefined` straight through for `projectId` and
 * `workspaceSlug`.
 *
 * Keys are sourced from `EWorkItemEmbedAttributeNames` via computed
 * property names, so adding a member to the enum automatically extends
 * this type and forces every consumer reading `node.attrs` through this
 * alias to handle the new field.
 */
export type TWorkItemEmbedAttributes = {
  [EWorkItemEmbedAttributeNames.ID]: string | undefined;
  [EWorkItemEmbedAttributeNames.ENTITY_IDENTIFIER]: string | undefined;
  [EWorkItemEmbedAttributeNames.PROJECT_IDENTIFIER]: string | undefined;
  [EWorkItemEmbedAttributeNames.WORKSPACE_IDENTIFIER]: string | undefined;
  [EWorkItemEmbedAttributeNames.ENTITY_NAME]: string | undefined;
};
