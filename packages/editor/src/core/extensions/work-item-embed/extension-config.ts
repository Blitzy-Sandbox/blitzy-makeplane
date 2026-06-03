/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Schema-only TipTap node configuration for the work-item-embed feature, defining
 * how an embedded work item is represented in the editor's ProseMirror document
 * model, what attributes it carries, and how it round-trips to/from HTML.
 *
 * This module is the platform-neutral schema substrate consumed by two paths:
 * - Runtime React render path — the sibling `./extension.tsx` extends this config
 *   with an `addNodeView()` returning a React component supplied through the
 *   cross-package `widgetCallback` injection contract, giving the editor UI an
 *   interactive work-item card.
 * - Schema-only / non-React render path — consumed directly by
 *   `packages/editor/src/core/extensions/core-without-props.ts` (in the
 *   `DocumentEditorExtensionsWithoutProps` array), which is used by
 *   `packages/editor/src/core/helpers/yjs-utils.ts` for binary Y.Doc → HTML/JSON
 *   conversion. That path ultimately backs `apps/live`'s PDF export pipeline
 *   (renders work-item embeds as inert `<issue-embed-component …>` HTML tags) and
 *   the API backend's HTML-based search/indexing of `Page.description_html`.
 *
 * This is a first-party custom ProseMirror node created via `Node.create(...)`
 * from `@tiptap/core` — it is NOT a wrapper around any upstream
 * `@tiptap/extension-*` package, so the "Exposes / Overrides / Hides" triplet
 * conventional for TipTap wrapper modules does not apply.
 *
 * The node name resolves to `CORE_EXTENSIONS.WORK_ITEM_EMBED`
 * (= `"issue-embed-component"`, defined in `@/constants/extension`), keeping the
 * node identifier in sync with the editor's central extension registry and with
 * `BLOCK_NODE_TYPES`, which classifies block-level node types for editor logic
 * that filters or iterates by content type.
 */

import { mergeAttributes, Node } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

/**
 * Schema definition for the work-item-embed ProseMirror node — used as-is on the
 * non-React path and extended with a React `addNodeView()` on the runtime path.
 *
 * Schema facets:
 * - `name`: `CORE_EXTENSIONS.WORK_ITEM_EMBED` → `"issue-embed-component"` — the
 *   node identifier in the ProseMirror schema and the literal HTML tag emitted
 *   by `renderHTML`.
 * - `group: "block"` — block-level node, eligible to appear wherever block
 *   content is permitted by the document schema.
 * - `atom: true` — has no editable inner content; ProseMirror treats the node as
 *   an indivisible unit for selection, cursor traversal, and deletion.
 * - `selectable: true` and `draggable: true` — the node can be selected and
 *   dragged as a single unit in the editor UI.
 *
 * Attributes (`addAttributes`) — five fields, each defaulting to `undefined` so
 * the node tolerates partial metadata at parse time; the runtime widgetCallback
 * and PDF renderer must fail-soft on missing values:
 * - `id` — node-instance identifier; used by the React NodeView wrapper as a
 *   React `key`.
 * - `entity_identifier` — the embedded work item's id; forwarded to the runtime
 *   `widgetCallback` as `issueId`.
 * - `project_identifier` — the embedded work item's project id; forwarded as
 *   `projectId`.
 * - `workspace_identifier` — the embedded work item's workspace slug; forwarded
 *   as `workspaceSlug`.
 * - `entity_name` — a human-readable label for the embedded work item, useful
 *   on non-interactive HTML/PDF render paths where the MobX-backed card is not
 *   available.
 *
 * The same canonical attribute names are also captured in the
 * `EWorkItemEmbedAttributeNames` enum in `./types.ts`. The schema config uses
 * raw string keys (required by TipTap's `addAttributes()` signature); consumers
 * reading the attrs at runtime use the enum for compile-time safety.
 *
 * `parseHTML` matches the custom element tag `<issue-embed-component>` so
 * pasted or loaded HTML containing this tag is recognized as a work-item-embed
 * node; attribute extraction is implicit — TipTap reads the declared
 * `addAttributes` keys directly from the element's HTML attributes.
 *
 * `renderHTML` serializes the node back to `<issue-embed-component …>` with
 * attributes merged via `mergeAttributes(HTMLAttributes)`. The merge preserves
 * editor-managed and runtime-supplied attributes instead of overwriting them,
 * enabling HTML-based persistence to `apps/api`'s `Page.description_html`
 * column and inert HTML rendering in the PDF export pipeline.
 *
 * Intentionally does NOT declare `addCommands()` — insertion at runtime is
 * performed via TipTap's generic
 * `editor.chain().insertContent({ type: CORE_EXTENSIONS.WORK_ITEM_EMBED, attrs: { … } })`
 * from the host app, or by HTML import containing `<issue-embed-component …>`.
 */
export const WorkItemEmbedExtensionConfig = Node.create({
  name: CORE_EXTENSIONS.WORK_ITEM_EMBED,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      entity_identifier: {
        default: undefined,
      },
      project_identifier: {
        default: undefined,
      },
      workspace_identifier: {
        default: undefined,
      },
      id: {
        default: undefined,
      },
      entity_name: {
        default: undefined,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "issue-embed-component",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["issue-embed-component", mergeAttributes(HTMLAttributes)];
  },
});
