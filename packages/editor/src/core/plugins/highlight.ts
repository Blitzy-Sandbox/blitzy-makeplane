/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Node-highlighting ProseMirror plugin.
 *
 * Exports `NodeHighlightPlugin`, a ProseMirror plugin that decorates a single
 * document node (matched by `attrs.id`) with a transient highlight class —
 * used for "scroll-to-and-flash" visual feedback (e.g., from notification
 * deep-links or in-app navigation to a specific block).
 *
 * Consumers toggle the highlighted node by dispatching a transaction with
 * meta `{ nodeId: string | null }` keyed by `nodeHighlightPluginKey`; passing
 * `null` (or an empty string) clears the highlight.
 */

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** Plugin state slice tracking the currently highlighted node id and its `DecorationSet`. */
type NodeHighlightState = {
  highlightedNodeId: string | null;
  decorations: DecorationSet;
};

/** Transaction-meta payload accepted under `nodeHighlightPluginKey` for changing the highlight target. */
type NodeHighlightMeta = {
  nodeId?: string | null;
};

/**
 * PluginKey for `NodeHighlightPlugin`. Consumers read state via
 * `state.get(nodeHighlightPluginKey)` and dispatch highlight changes by
 * attaching `{ nodeId: string | null }` meta to a transaction under this key.
 */
export const nodeHighlightPluginKey = new PluginKey<NodeHighlightState>("nodeHighlight");

/**
 * Walk the document to locate the node whose `attrs.id` equals `highlightedNodeId`
 * and return a `DecorationSet` carrying a single inline/node decoration on that
 * match (or `DecorationSet.empty` when no id is targeted). The descendant walk
 * short-circuits at the first match because node ids are expected unique within
 * the document.
 */
const buildDecorations = (doc: Parameters<typeof DecorationSet.create>[0], highlightedNodeId: string | null) => {
  if (!highlightedNodeId) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];
  const highlightClassNames = ["bg-accent-primary/20", "transition-all", "duration-300", "rounded"];

  doc.descendants((node, pos) => {
    // Check if this node has the id we're looking for
    if (node.attrs && node.attrs.id === highlightedNodeId) {
      const decorationAttrs: Record<string, string> = {
        "data-node-highlighted": "true",
        class: highlightClassNames.join(" "),
      };

      // For text nodes, highlight the inline content
      if (node.isText) {
        decorations.push(
          Decoration.inline(pos, pos + node.nodeSize, decorationAttrs, {
            inclusiveStart: true,
            inclusiveEnd: true,
          })
        );
      } else {
        // For block nodes, add a node decoration
        decorations.push(Decoration.node(pos, pos + node.nodeSize, decorationAttrs));
      }

      return false; // Stop searching once we found the node
    }

    return true;
  });

  return DecorationSet.create(doc, decorations);
};

/**
 * Build the node-highlighting ProseMirror plugin instance.
 *
 * State read:
 *   - Plugin state slice `{ highlightedNodeId, decorations }` (init: `{ null, empty }`).
 *   - Document descendants — `buildDecorations` walks them in `apply` to find
 *     the node whose `attrs.id === highlightedNodeId`.
 *
 * State write (in `apply`):
 *   - Rebuilds the `DecorationSet` when the transaction carries
 *     `meta[nodeHighlightPluginKey].nodeId` (highlight target change — `null`
 *     or empty string clears) OR when `tr.docChanged` is true (the highlighted
 *     node may have moved within the document — e.g., the user reordered
 *     blocks via the drag-handle plugin).
 *   - When neither condition triggers a rebuild but `tr.docChanged` is still
 *     true, the existing decorations are mapped through `tr.mapping` instead
 *     of re-walking descendants — a cheaper path that keeps the highlight
 *     attached to its block across unrelated edits.
 *
 * DOM side effects (via `props.decorations(state)`):
 *   - Applies the highlight CSS classes (`bg-accent-primary/20`, `transition-all`,
 *     `duration-300`, `rounded`) and a `data-node-highlighted="true"` attribute
 *     to the matching node's DOM. The branch on `node.isText` selects
 *     `Decoration.inline` for text spans (preserves selection across the
 *     highlight) versus `Decoration.node` for block nodes (decorates the outer
 *     DOM) — using the wrong kind would render incorrectly.
 *
 * WHY rebuild on `docChanged` (not just on meta change): the highlighted node
 * may move (block reorder, parent edit), so mapping alone would leave the
 * highlight at a stale position. Walking descendants again reconciles the
 * decoration against the current document.
 */
export const NodeHighlightPlugin = () =>
  new Plugin<NodeHighlightState>({
    key: nodeHighlightPluginKey,
    state: {
      init: () => ({
        highlightedNodeId: null,
        decorations: DecorationSet.empty,
      }),
      apply: (tr, value, _oldState, newState) => {
        let highlightedNodeId = value.highlightedNodeId;
        let decorations = value.decorations;

        const meta = tr.getMeta(nodeHighlightPluginKey) as NodeHighlightMeta | undefined;
        let shouldRecalculate = tr.docChanged;

        if (meta) {
          if (meta.nodeId !== undefined) {
            highlightedNodeId = typeof meta.nodeId === "string" && meta.nodeId.length > 0 ? meta.nodeId : null;
            shouldRecalculate = true;
          }
        }

        if (shouldRecalculate) {
          decorations = buildDecorations(newState.doc, highlightedNodeId);
        } else if (tr.docChanged) {
          decorations = decorations.map(tr.mapping, newState.doc);
        }

        return {
          highlightedNodeId,
          decorations,
        };
      },
    },
    props: {
      decorations(state) {
        return nodeHighlightPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
