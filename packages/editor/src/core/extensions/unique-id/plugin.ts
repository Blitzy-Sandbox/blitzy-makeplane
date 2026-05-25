/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * ProseMirror plugin factory for the Plane unique-ID extension.
 *
 * This module is the transactional maintenance layer of the unique-ID feature.
 * On every local-origin transaction that mutates the document, the plugin:
 *   1. Finds block nodes (filtered by `options.types`) inside the changed
 *      ranges that have `null` for the `options.attributeName` attribute,
 *      and stamps a freshly generated ID on each.
 *   2. Detects ID duplication globally across the document, and regenerates
 *      IDs on any NEW nodes whose ID collides with an existing one (defense
 *      in depth against pasted content that arrives with pre-existing IDs).
 *
 * Y.js / CRDT collaborative-safety strategy (CRITICAL):
 *   - IDs are random UUID v4 values (see `generateUniqueID` in `./extension.ts`).
 *     UUID v4 is statistically unique with negligible collision probability,
 *     so two clients editing the same document concurrently will stamp
 *     non-colliding IDs on their respective local inserts WITHOUT any
 *     coordination protocol.
 *   - Y.js-originated transactions are SKIPPED. The plugin checks each
 *     incoming transaction for the `y-sync$` meta tag set by the
 *     `y-prosemirror` binding when applying remote Y.Doc updates. If any
 *     transaction in the batch is a y-sync transaction, `appendTransaction`
 *     returns without stamping. This is the load-bearing safety property:
 *     remote nodes already carry IDs stamped by their origin client; the
 *     local client must NEVER overwrite them.
 *   - Net effect on concurrent edit convergence: client A's local insert
 *     receives UUID_A; client B's local insert receives UUID_B. When the
 *     Y.js CRDT merges A's and B's changes, each block keeps its origin
 *     client's UUID. After merge, every client sees both blocks with the
 *     correct IDs, and the IDs are stable across reloads because they are
 *     persisted as part of the Y.Doc structural state.
 *   - Hocuspocus provider sync coordination: when the editor is constructed
 *     with an unsynced collaboration provider, the plugin defers ID
 *     stamping until the provider emits `synced`. Otherwise, the empty
 *     placeholder document presented before sync would be stamped with
 *     transient IDs that would then conflict with the authoritative state
 *     once it arrives.
 *
 * Cross-references:
 *   - `apps/live/src/extensions/database.ts` — server-side debounced
 *     persistence of the Y.Doc. Block IDs stamped here become part of the
 *     persisted binary Y.Doc state and survive disconnect/reconnect cycles.
 *   - `packages/editor/src/core/extensions/unique-id/extension.ts` —
 *     plugin configuration source (`UniqueIDOptions`).
 *   - `packages/editor/src/core/extensions/unique-id/utils.ts` —
 *     view-level backfill helper invoked from the `synced` callback below.
 *   - `packages/editor/src/core/hooks/use-editor.ts` line ~93 — consumer
 *     of the `uniqueIdOnlyChange` meta flag set by the backfill helper.
 */

import { combineTransactionSteps, findChildrenInRange, findDuplicates, getChangedRanges } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
// types
import type { UniqueIDOptions } from "./extension";
// utils
import { createIdsForView } from "./utils";

/**
 * Build the ProseMirror plugin instance that maintains unique IDs on block nodes.
 *
 * The plugin is keyed by `PluginKey("uniqueID")` so its `appendTransaction`
 * is referenced/tracked uniquely within the editor's plugin chain. The plugin
 * runs at the very high extension priority configured on the parent
 * `UniqueID` Tiptap extension (`priority: 10000`), so it executes BEFORE
 * most other `appendTransaction` hooks. This ordering matters because
 * downstream extensions (e.g., comment-anchor extensions, slash-command
 * helpers) may read `node.attrs.id` and must observe a fully-stamped doc.
 *
 * Plugin layout:
 *   - `appendTransaction(transactions, oldState, newState)` — the main
 *     transactional ID maintenance hook (see inline JSDoc below).
 *   - `view(view)` — registers a global `dragstart` listener (so the plugin
 *     can detect whether a drop originated inside or outside the current
 *     editor) AND, when a `HocuspocusProvider` is configured and not yet
 *     synced, registers a one-shot `synced` listener that invokes the
 *     view-level backfill helper `createIdsForView`. Both listeners are
 *     torn down in `destroy()`.
 *   - `props.handleDOMEvents.drop` / `props.handleDOMEvents.paste` — set
 *     the `transformPasted` flag so that the upcoming `transformPasted`
 *     call removes IDs from the incoming slice. This guarantees that
 *     pasted/dropped content gets fresh IDs when it lands in the doc,
 *     instead of carrying over the source document's IDs (which would
 *     break comment anchoring and create duplicate IDs).
 *   - `props.transformPasted(slice)` — walks the pasted slice and, for
 *     every node whose type is in `options.types`, returns a copy with
 *     its ID attribute set to `null`. Text nodes are passed through
 *     unchanged; unmanaged structural nodes are recursed into. The
 *     `appendTransaction` hook then assigns fresh IDs when the slice
 *     becomes part of the document.
 *
 * @param options Configuration inherited from the parent `UniqueID` extension.
 *   Most importantly:
 *     - `types`: block-level node type names to manage.
 *     - `attributeName`: name of the ID attribute (default `"id"`).
 *     - `generateUniqueID`: ID factory (default UUID v4).
 *     - `filterTransaction`: optional predicate to reject specific
 *       transactions from triggering ID stamping (returning `false`
 *       on any transaction in the batch suppresses the hook).
 *     - `provider`: optional `HocuspocusProvider` used to defer the
 *       initial backfill until collaboration sync completes.
 * @returns A configured `Plugin` instance to register via
 *          `addProseMirrorPlugins()` in `./extension.ts`.
 */
export const createUniqueIDPlugin = (options: UniqueIDOptions) => {
  let dragSourceElement: Element | null = null;
  let transformPasted = false;
  let syncHandler: (() => void) | null = null;

  return new Plugin({
    key: new PluginKey("uniqueID"),
    /**
     * Per-transaction ID maintenance hook.
     *
     * Skipped (returns undefined) when:
     *   - Any transaction in the batch carries the `y-sync$` meta flag
     *     (Y.js remote update — must NOT be re-stamped; see module JSDoc).
     *   - `options.filterTransaction` is configured AND rejects any
     *     transaction in the batch.
     *   - No transaction in the batch actually changed the document
     *     (`docChanged === false` everywhere, or `oldState.doc.eq(newState.doc)`).
     *
     * When run, it:
     *   1. Combines all transactions in the batch (`combineTransactionSteps`)
     *      so that step ranges can be mapped through a single mapping.
     *   2. Scans the ENTIRE document (not just changed ranges) to build a
     *      global list of existing IDs, then `findDuplicates` to detect any
     *      collisions across the whole doc — critical for catching pasted
     *      content that brought duplicate IDs.
     *   3. For each changed range, walks the new nodes of managed types:
     *        - If the node's current ID (read from `tr.doc.nodeAt(pos)`,
     *          NOT from the original `node` reference — see inline comment)
     *          is `null`, stamps a fresh ID.
     *        - Else, checks whether the node existed in the old state by
     *          inverting the step mapping; if `deleted === true` the node
     *          is NEW, and if its ID is in the global duplicate set, the
     *          ID is regenerated.
     *   4. Restores stored marks (because `setNodeMarkup` clears them) and
     *      returns the amended transaction.
     */
    appendTransaction: (transactions, oldState, newState) => {
      const hasDocChanges =
        transactions.some((transaction) => transaction.docChanged) && !oldState.doc.eq(newState.doc);
      const filterTransactions =
        options.filterTransaction && transactions.some((tr) => !options.filterTransaction?.(tr));

      const isCollabTransaction = transactions.find((tr) => tr.getMeta("y-sync$"));

      if (isCollabTransaction) {
        return;
      }

      if (!hasDocChanges || filterTransactions) {
        return;
      }

      const { tr } = newState;

      const { types, attributeName, generateUniqueID } = options;
      const transform = combineTransactionSteps(oldState.doc, transactions as Transaction[]);

      const { mapping } = transform;

      // get changed ranges based on the old state
      const changes = getChangedRanges(transform);

      // Get all IDs from the entire document to check for duplicates globally
      const allNodesInDoc: Array<{ node: ProseMirrorNode; pos: number }> = [];
      newState.doc.descendants((node, pos) => {
        if (types.includes(node.type.name)) {
          allNodesInDoc.push({ node, pos });
        }
      });
      const allIds = allNodesInDoc.map(({ node }) => node.attrs[attributeName]).filter((id) => id !== null);
      const duplicatedIds = findDuplicates(allIds);

      changes.forEach(({ newRange }) => {
        const newNodes = findChildrenInRange(newState.doc, newRange, (node) => types.includes(node.type.name));

        newNodes.forEach(({ node, pos }) => {
          // instead of checking `node.attrs[attributeName]` directly
          // we look at the current state of the node within `tr.doc`.
          // this helps to prevent adding new ids to the same node
          // if the node changed multiple times within one transaction
          const id = tr.doc.nodeAt(pos)?.attrs[attributeName];

          if (id === null) {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              [attributeName]: generateUniqueID({ node, pos }),
            });

            return;
          }

          // check if the node doesn't exist in the old state
          const { deleted } = mapping.invert().mapResult(pos);

          // If this is a new node (didn't exist in old state) and its ID is duplicated in the entire document
          const newNode = deleted && duplicatedIds.includes(id);

          if (newNode) {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              [attributeName]: generateUniqueID({ node, pos }),
            });
          }
        });
      });

      if (!tr.steps.length) {
        return;
      }

      // `tr.setNodeMarkup` resets the stored marks
      // so we'll restore them if they exist
      tr.setStoredMarks(newState.tr.storedMarks);

      // Don't add ID generation to undo history
      // since its causing issue with undo feature we are commmeting it out for now
      // tr.setMeta("addToHistory", false);

      return tr;
    },

    /**
     * Plugin view hook — wires up global drag tracking and the one-time
     * Hocuspocus `synced` listener for deferred initial ID backfill.
     *
     * Drag tracking: the global `dragstart` listener records whether the
     * current drag originated inside this editor's DOM. This is read in
     * `props.handleDOMEvents.drop` to decide whether to strip IDs from the
     * dropped content (drops from a different editor or an Alt-modified
     * drop are treated like a paste; in-editor drag-reorders preserve IDs).
     *
     * Sync listener: when the editor is collaborative and the provider has
     * not yet synced, `createIdsForView` is invoked once on the first
     * `synced` event, then the listener is removed. This is the
     * load-bearing safety property for collaboration startup — it prevents
     * stamping IDs on the empty placeholder doc that exists before the
     * authoritative Y.Doc arrives from `apps/live`.
     *
     * `destroy()` removes both listeners; without this cleanup, multiple
     * editor instances on the same page would leak `dragstart` listeners
     * to `window`.
     */
    // we register a global drag handler to track the current drag source element
    view(view) {
      const handleDragstart = (event: DragEvent) => {
        dragSourceElement = view.dom.parentElement?.contains(event.target as Element) ? view.dom.parentElement : null;
      };

      window.addEventListener("dragstart", handleDragstart);

      // Handle provider sync listener for creating IDs when collaboration provider syncs
      const provider = options.provider;
      if (provider && !provider.isSynced) {
        syncHandler = () => {
          createIdsForView(view, options);

          // Clean up the listener after it runs
          if (provider && syncHandler) {
            provider.off("synced", syncHandler);
            syncHandler = null;
          }
        };

        provider.on("synced", syncHandler);
      }

      return {
        destroy() {
          window.removeEventListener("dragstart", handleDragstart);

          // Clean up provider sync listener if it exists
          if (provider && syncHandler) {
            provider.off("synced", syncHandler);
            syncHandler = null;
          }
        },
      };
    },

    /**
     * Plugin props.
     *
     * `handleDOMEvents` runs BEFORE `transformPasted`, allowing the drop
     * and paste handlers to set the `transformPasted` closure flag so that
     * the subsequent `transformPasted` invocation knows whether to strip
     * IDs from the incoming slice.
     *
     * Drop semantics:
     *   - When the drag originated in this editor AND `effectAllowed` is
     *     not "copy", IDs are preserved (in-editor drag-reorder).
     *   - Otherwise (cross-editor drop or Alt-modified copy), IDs are
     *     stripped so the dropped content receives fresh IDs.
     *
     * Paste semantics: always strip IDs from the pasted slice.
     *
     * `transformPasted` recurses through the pasted slice's fragment tree.
     * Text nodes are passed through untouched. Unmanaged structural nodes
     * (not in `options.types`) are copied with their existing attrs but
     * their content is recursively cleaned. Managed nodes are reconstructed
     * via `node.type.create` with the ID attribute set to `null`; the
     * `appendTransaction` hook then assigns a fresh ID when the slice is
     * applied to the document.
     */
    props: {
      // `handleDOMEvents` is called before `transformPasted`
      // so we can do some checks before
      handleDOMEvents: {
        // only create new ids for dropped content
        // or dropped content while holding `alt`
        // or content is dragged from another editor
        drop: (view, event) => {
          if (dragSourceElement !== view.dom.parentElement || event.dataTransfer?.effectAllowed === "copy") {
            dragSourceElement = null;
            transformPasted = true;
          }

          return false;
        },
        // always create new ids on pasted content
        paste: () => {
          transformPasted = true;

          return false;
        },
      },

      // we'll remove ids for every pasted node
      // so we can create a new one within `appendTransaction`
      transformPasted: (slice) => {
        if (!transformPasted) {
          return slice;
        }

        const { types, attributeName } = options;
        const removeId = (fragment: Fragment): Fragment => {
          const list: ProseMirrorNode[] = [];

          fragment.forEach((node) => {
            // don't touch text nodes
            if (node.isText) {
              list.push(node);

              return;
            }

            // check for any other child nodes
            if (!types.includes(node.type.name)) {
              list.push(node.copy(removeId(node.content)));

              return;
            }

            // remove id
            const nodeWithoutId = node.type.create(
              {
                ...node.attrs,
                [attributeName]: null,
              },
              removeId(node.content),
              node.marks
            );

            list.push(nodeWithoutId);
          });

          return Fragment.from(list);
        };

        // reset check
        transformPasted = false;

        return new Slice(removeId(slice.content), slice.openStart, slice.openEnd);
      },
    },
  });
};
