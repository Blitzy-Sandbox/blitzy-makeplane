/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Custom ProseMirror trailing-node extension for the Plane editor.
 *
 * Ensures the document always ends with a paragraph the user can click into
 * to start typing below the last content block. Without this extension, when
 * the document's final block is non-text (e.g., an image, table, or
 * horizontal rule), the user would have no place to position the caret below
 * it — the trailing paragraph fixes that interaction gap.
 *
 * First-party code (not a third-party wrapper): Plane owns this
 * implementation under AGPL-3.0 and does NOT depend on the licensed
 * `@tiptap-pro/extension-trailing-node` package. See the JSDoc above
 * `TrailingNode` below for full behavioral semantics.
 *
 * Re-exported from `packages/editor/src/index.ts` as `TrailingNode` —
 * downstream consumers may import and compose this extension into custom
 * editor stacks.
 */

import { Extension } from "@tiptap/core";
import type { NodeType, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

/**
 * Returns `true` when the given node matches any of the supplied node types.
 *
 * The signature accepts `NodeType[]`, but the body also handles a single
 * `NodeType` via the `node?.type === types` branch — this legacy fallback
 * is preserved verbatim along with the `// TODO` and `// @ts-expect-error`
 * comments below, which flag the known type weakness for follow-up.
 */
function nodeEqualsType({ types, node }: { types: NodeType[]; node: ProseMirrorNode | null }) {
  // TODO: check this logic, might be wrong
  // @ts-expect-error - logic might be wrong
  return (Array.isArray(types) && types.includes(node?.type)) || node?.type === types;
}

/**
 * Configuration for `TrailingNode`.
 *
 * - `node`: the schema node type name to insert at the document tail
 *   (default `CORE_EXTENSIONS.PARAGRAPH` — i.e. `"paragraph"`). The named
 *   node must exist in the editor's schema; otherwise `schema.nodes[node]`
 *   resolves to `undefined` and the plugin's `type.create()` call throws.
 * - `notAfter`: schema node names whose presence as the document's last
 *   child suppresses the trailing-node insertion (default
 *   `[CORE_EXTENSIONS.PARAGRAPH]`, so a document already ending in a
 *   paragraph gets no extra trailing node — this is the gating mechanism
 *   that prevents an infinite append cycle).
 */
export interface TrailingNodeOptions {
  node: string;
  notAfter: string[];
}

/**
 * Custom ProseMirror trailing-node extension — maintains a trailing empty
 * paragraph at the document tail.
 *
 * Purpose:
 *   When the document's final block is non-text (image, table, horizontal
 *   rule, etc.), the user has no caret target below the last block. This
 *   extension appends a paragraph at `doc.content.size` so the click-below-
 *   to-type interaction always works.
 *
 * First-party note:
 *   Plane owns this implementation under AGPL-3.0 and does NOT depend on
 *   `@tiptap-pro/extension-trailing-node` (TipTap Pro tier, licensed). The
 *   trailing-node pattern is re-implemented from scratch as a ProseMirror
 *   plugin so the editor stack stays fully open-source.
 *
 * Schema note:
 *   Does not define a new schema node. The `node` option names an existing
 *   schema node (default `CORE_EXTENSIONS.PARAGRAPH`, provided by
 *   `@tiptap/starter-kit`). The trailing paragraph IS a real document node
 *   and serializes to HTML output (as `<p></p>`) — collaborators connecting
 *   via Y.js therefore see a consistent document tail.
 *
 * Plugin behavior:
 *   - `state.init` / `state.apply` track a boolean indicating whether the
 *     last child is NOT in the `notAfter` disabled list (default
 *     `[PARAGRAPH]`, so docs already ending in a paragraph get no extra
 *     trailing node — this gates the otherwise-infinite append cycle).
 *   - `state.apply` short-circuits when `tr.docChanged` is false so the
 *     boolean is only recomputed on document-mutating transactions.
 *   - `appendTransaction` reads the cached boolean via `plugin.getState`
 *     and inserts the configured node at `doc.content.size` only when the
 *     boolean is `true`, avoiding repeated last-child scans per dispatch.
 *
 * Plugin key:
 *   The internal `PluginKey` uses `this.name` (`"trailingNode"`) so other
 *   plugins can coordinate with the trailing-node state if needed.
 *
 * Re-exported from `packages/editor/src/index.ts` as `TrailingNode` —
 * canonical public API for downstream consumers composing custom editor
 * stacks.
 */
export const TrailingNode = Extension.create<TrailingNodeOptions>({
  name: "trailingNode",

  addOptions() {
    return {
      node: CORE_EXTENSIONS.PARAGRAPH,
      notAfter: [CORE_EXTENSIONS.PARAGRAPH],
    };
  },

  addProseMirrorPlugins() {
    const plugin = new PluginKey(this.name);
    const disabledNodes = Object.entries(this.editor.schema.nodes)
      .map(([, value]) => value)
      .filter((node) => this.options.notAfter.includes(node.name));

    return [
      new Plugin({
        key: plugin,
        appendTransaction: (_, __, state) => {
          const { doc, tr, schema } = state;
          const shouldInsertNodeAtEnd = plugin.getState(state);
          const endPosition = doc.content.size;
          const type = schema.nodes[this.options.node];

          if (!shouldInsertNodeAtEnd) {
            return;
          }

          return tr.insert(endPosition, type.create());
        },
        state: {
          init: (_, state) => {
            const lastNode = state.tr.doc.lastChild;

            return !nodeEqualsType({ node: lastNode, types: disabledNodes });
          },
          apply: (tr, value) => {
            if (!tr.docChanged) {
              return value;
            }

            const lastNode = tr.doc.lastChild;

            return !nodeEqualsType({ node: lastNode, types: disabledNodes });
          },
        },
      }),
    ];
  },
});
