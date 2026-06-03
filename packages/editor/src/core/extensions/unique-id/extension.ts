/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Plane unique-ID Tiptap extension — assigns a stable `id` attribute to
 * every configured block-level node so that comments, URL fragment links
 * (e.g., `#block-id`), and Y.js CRDT merge identity remain consistent
 * across edits and collaborative sessions.
 *
 * Why this extension exists:
 *   - Comment anchoring: comments stored against a block reference the
 *     block's `id`. Without a stable ID, comments would lose their anchor
 *     after edits.
 *   - URL fragment linking: deep links to a specific block use the ID as
 *     the URL hash.
 *   - Collaborative merge identity: while Y.js handles structural CRDT
 *     merging at the Y.Doc level, the rendered ProseMirror node attributes
 *     are propagated via y-prosemirror. Stamping IDs on every managed
 *     block guarantees that downstream consumers (comments, mentions) can
 *     address blocks predictably across clients.
 *
 * Composition:
 *   - `./plugin.ts` — the ProseMirror plugin that does per-transaction
 *     ID maintenance (and contains the Y.js `y-sync$` safety guard).
 *   - `./utils.ts` — the view-level backfill helper used on editor mount
 *     and on Hocuspocus provider `synced`.
 *
 * Configured node types: by default, all block-level nodes in
 * `BLOCK_NODE_TYPES` (paragraph, heading, blockquote, code block,
 * horizontal rule, lists, list items, task lists/items, table, image,
 * custom image, callout, work-item embed) plus any
 * `ADDITIONAL_BLOCK_NODE_TYPES` declared in the plane-editor overlay.
 *
 * Collaborative-safety contract (cross-reference `./plugin.ts`):
 *   - IDs are random UUID v4 — statistically unique without coordination.
 *   - Y.js-origin transactions (marked `y-sync$`) are not re-stamped, so
 *     remote nodes retain the IDs assigned by their origin client.
 *   - When a Hocuspocus provider is configured and not yet synced, ID
 *     stamping is deferred to the plugin's `synced` callback to avoid
 *     stamping the empty placeholder document before the authoritative
 *     state arrives from `apps/live`.
 */

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { v4 as uuidv4 } from "uuid";
// constants
import { CORE_EXTENSIONS, BLOCK_NODE_TYPES } from "@/constants/extension";
import { ADDITIONAL_BLOCK_NODE_TYPES } from "@/plane-editor/constants/extensions";
import { createUniqueIDPlugin } from "./plugin";
import { createIdsForView } from "./utils";
// plane imports

const COMBINED_BLOCK_NODE_TYPES = [...BLOCK_NODE_TYPES, ...ADDITIONAL_BLOCK_NODE_TYPES];

/**
 * Context passed to `UniqueIDOptions.generateUniqueID`.
 *
 * @property node The ProseMirror node about to receive an ID.
 * @property pos  The position of the node within the current document,
 *                useful for callers that want position-derived IDs.
 */
export type UniqueIDGenerationContext = {
  node: ProseMirrorNode;
  pos: number;
};

/**
 * Canonical attribute name used to store the unique ID on a node.
 *
 * Exposed as a constant so downstream consumers (e.g., comment-anchor
 * resolution, slash-command helpers) can reference the attribute without
 * duplicating the string literal.
 */
export const UniqueIDAttribute = "id";

/**
 * Default unique-ID factory — returns a random UUID v4.
 *
 * Why UUID v4: statistically unique across all clients with no
 * coordination protocol required. This is the load-bearing property that
 * makes the unique-ID extension safe under concurrent edits — two clients
 * inserting blocks simultaneously will produce non-colliding IDs without
 * any cross-client synchronization. See `./plugin.ts` module JSDoc for
 * the full collaborative-safety analysis.
 *
 * @returns A new random UUID v4 string.
 */
export const generateUniqueID = () => uuidv4();

/**
 * Configuration options for the `UniqueID` extension.
 *
 * Per-field documentation is preserved in the existing JSDoc on each
 * property below. This top-level block describes the interface's role:
 * it is the configuration contract shared between the extension entry
 * point (`./extension.ts`), the ProseMirror plugin (`./plugin.ts`), and
 * the view-level backfill helper (`./utils.ts`).
 */
export interface UniqueIDOptions {
  /**
   * The name of the attribute to add the unique ID to.
   * @default "id"
   */
  attributeName: string;
  /**
   * The types of nodes to add unique IDs to.
   * @default []
   */
  types: string[];
  /**
   * The function that generates the unique ID. By default, a UUID v4 is
   * generated. However, you can provide your own function to generate the
   * unique ID based on the node type and the position.
   */
  generateUniqueID: (ctx: UniqueIDGenerationContext) => string;
  /**
   * Ignore some mutations, for example applied from other users through the collaboration plugin.
   *
   * @default null
   */
  filterTransaction: ((transaction: Transaction) => boolean) | null;
  /**
   * Whether to update the document by adding unique IDs to the nodes. Set this
   * property to `false` if the document is in `readonly` mode, is immutable, or
   * you don't want it to be modified.
   *
   * @default true
   */
  updateDocument: boolean;
  /**
   * The provider to use for the unique ID generation.
   * @default null
   */
  provider: HocuspocusProvider | undefined;
}

/**
 * The Plane unique-ID Tiptap extension.
 *
 * Registered name: `CORE_EXTENSIONS.UNIQUE_ID` (=`"uniqueID"`).
 *
 * Priority: `10000` — intentionally very high so that this extension's
 * `appendTransaction` hook runs before downstream extensions. Downstream
 * code may read `node.attrs.id` and depends on observing a fully-stamped
 * document.
 *
 * Default `types`: `BLOCK_NODE_TYPES` concatenated with
 * `ADDITIONAL_BLOCK_NODE_TYPES` — all block-level nodes that may serve as
 * comment anchors or URL targets.
 *
 * Lifecycle:
 *   - `addOptions()` — supplies defaults. Override at instantiation site
 *     to inject a `HocuspocusProvider`, disable `updateDocument` for
 *     read-only views, or provide a custom `generateUniqueID` factory.
 *   - `addGlobalAttributes()` — declares the `id` (or
 *     `options.attributeName`) attribute on every managed node type.
 *     The attribute is parsed from `data-{attributeName}` on HTML
 *     hydration and rendered as `data-{attributeName}` on serialization.
 *     Returning `{}` from `renderHTML` when the value is falsy ensures
 *     no spurious `data-id=""` attribute is emitted.
 *   - `onCreate()` — runs on editor mount. Disables `updateDocument` for
 *     non-editable editors. For collaborative editors, defers backfill
 *     to the plugin's `synced` callback (otherwise an empty placeholder
 *     would receive transient IDs that would conflict with the
 *     authoritative state once the provider syncs). For non-collaborative
 *     editors, immediately invokes the view-level backfill.
 *   - `addProseMirrorPlugins()` — registers the unique-ID plugin
 *     (see `./plugin.ts`). Returns an empty array when `updateDocument`
 *     is false, so read-only editors do not pay the per-transaction
 *     scanning cost.
 *
 * Collaborative-safety (see `./plugin.ts` module JSDoc for full detail):
 *   - Y.js sync transactions are skipped to avoid re-stamping remote nodes.
 *   - UUID v4 uniqueness guarantees that concurrent inserts on different
 *     clients produce non-colliding IDs.
 *   - The provider's `synced` event gates the initial backfill so the
 *     extension never stamps the pre-sync placeholder document.
 */
export const UniqueID = Extension.create<UniqueIDOptions>({
  name: CORE_EXTENSIONS.UNIQUE_ID,

  // we'll set a very high priority to make sure this runs first
  // and is compatible with `appendTransaction` hooks of other extensions
  priority: 10000,

  addOptions() {
    return {
      attributeName: "id",
      types: COMBINED_BLOCK_NODE_TYPES,
      generateUniqueID: () => uuidv4(),
      filterTransaction: null,
      updateDocument: true,
      provider: undefined,
    };
  },

  /**
   * Declare the unique ID attribute on every managed node type.
   *
   * The attribute serializes to `data-{attributeName}` in HTML and
   * parses back from the same attribute on hydration. The `renderHTML`
   * branch returns `{}` for falsy values to avoid emitting empty
   * `data-id=""` attributes when a node has not yet been stamped.
   */
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          [this.options.attributeName]: {
            default: null,
            parseHTML: (element) => element.getAttribute(`data-${this.options.attributeName}`),
            renderHTML: (attributes) => {
              if (!attributes[this.options.attributeName]) {
                return {};
              }

              return {
                [`data-${this.options.attributeName}`]: attributes[this.options.attributeName],
              };
            },
          },
        },
      },
    ];
  },

  /**
   * Editor `onCreate` lifecycle — checks initial content for missing IDs
   * and performs the initial unique-ID backfill.
   *
   * Flow:
   *   - If the editor is not editable, force `updateDocument = false`
   *     (no point stamping IDs we cannot persist back to storage).
   *   - If `updateDocument` is disabled, return without stamping.
   *   - If a Hocuspocus provider is configured:
   *       - If already synced, backfill immediately.
   *       - If not synced, defer to the plugin's one-shot `synced`
   *         listener (see `./plugin.ts` `view().synced`). Without this
   *         deferral the empty placeholder document would be stamped
   *         with transient IDs that would then conflict with the
   *         authoritative state once the provider syncs.
   *   - If no provider, backfill immediately.
   */
  onCreate() {
    if (!this.editor.isEditable) {
      this.options.updateDocument = false;
    }

    if (!this.options.updateDocument) {
      return;
    }

    const provider = this.options.provider;

    /**
     * We need to handle collaboration a bit different here
     * because we can't automatically add IDs when the provider is not yet synced
     * otherwise we end up with empty paragraphs
     */
    if (provider) {
      // Check if provider is already synced
      if (provider.isSynced) {
        createIdsForView(this.editor.view, this.options);
      }
      // If not synced, the listener will be registered in the plugin
      // and handled there with proper cleanup
    } else {
      createIdsForView(this.editor.view, this.options);
    }
  },

  /**
   * Register the unique-ID maintenance plugin (see `./plugin.ts`).
   *
   * Returns an empty plugin array when `updateDocument` is false so that
   * read-only editors do not pay the per-transaction document-scan cost.
   */
  addProseMirrorPlugins() {
    if (!this.options.updateDocument) {
      return [];
    }

    return [createUniqueIDPlugin(this.options)];
  },
});
