/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Runtime mention extension — composes the schema-only `CustomMentionExtensionConfig` with
 * a React node view (`MentionNodeView`) and the `@tiptap/suggestion`-driven autocomplete
 * dropdown (`renderMentionsDropdown` → `MentionsListDropdown`).
 *
 * This module is the canonical mention surface for interactive editing contexts (rich-text,
 * lite-text, document, collaborative editors). The headless variant exported from
 * `./extension-config` (`CustomMentionExtensionConfig`) is used by `core-without-props.ts`
 * for PDF export and server-side HTML conversion, which cannot mount a React node view.
 *
 * Registers under the schema name `CORE_EXTENSIONS.MENTION` (value `"mention"`), defined in
 * `@/constants/extension`.
 */

import { ReactNodeViewRenderer } from "@tiptap/react";
// types
import type { TMentionHandler } from "@/types";
// extension config
import { CustomMentionExtensionConfig } from "./extension-config";
// node view
import type { MentionNodeViewProps } from "./mention-node-view";
import { MentionNodeView } from "./mention-node-view";
// utils
import { renderMentionsDropdown } from "./utils";

/**
 * Build the runtime mention TipTap extension bound to a caller-provided `TMentionHandler`.
 *
 * Wires three pieces onto the schema base:
 *   1. `addOptions` — injects `renderComponent` and `getMentionedEntityDetails` so the node
 *      view and the markdown `renderText` helper can resolve mentioned entities without
 *      reaching into application state.
 *   2. `addNodeView` — wraps `MentionNodeView` in `ReactNodeViewRenderer` so each mention
 *      node renders as a styled React chip (user avatar + name, project icon + name, etc.).
 *   3. `.configure({ suggestion })` — wires the `@tiptap/suggestion` plugin to
 *      `renderMentionsDropdown({ searchCallback })`, with `allowSpaces: true` so multi-word
 *      queries (e.g. "John Smith") work after the `@` trigger.
 *
 * Suggestion search delegation:
 *   The `searchCallback` is NOT a static list — it is delegated to the caller (per-app)
 *   and ultimately invokes Plane's workspace member search API. This keeps the editor
 *   package free of network coupling and lets each consumer (web, live, plane-editor)
 *   plug in its own search source. See `MentionsListDropdown` for the debounced (300ms)
 *   invocation site.
 *
 * Exposes / Overrides / Hides (relative to upstream `@tiptap/extension-mention`):
 *   - Exposes:
 *       * Inherited `setMention` command for programmatic insertion.
 *       * Mention node schema (parse/render `<mention-component>` tag) — inherited from
 *         `CustomMentionExtensionConfig`.
 *   - Overrides:
 *       * Suggestion search → caller-injected `searchCallback` (Plane workspace member API);
 *         upstream's static array model is replaced.
 *       * Node view → `ReactNodeViewRenderer(MentionNodeView)` paints a styled chip;
 *         upstream renders only a plain inline element.
 *       * Dropdown rendering → `renderMentionsDropdown` mounts a custom popover positioned
 *         via floating-ui (see `@/helpers/floating-ui`) and registered with the editor's
 *         active-dropbar gate (`CORE_EXTENSIONS.MENTION`) to coordinate with sibling
 *         dropdowns (`emoji`, `slash-commands`) so only one is open at a time.
 *   - Hides:
 *       * Upstream default suggestion list UI — replaced entirely with `MentionsListDropdown`.
 *       * Upstream default dropdown rendering pipeline — replaced with `renderMentionsDropdown`.
 *
 * @param props - `TMentionHandler` from `@/types`: `searchCallback` (optional async query),
 *                `renderComponent` (required React renderer for chips), and
 *                `getMentionedEntityDetails` (optional display-name resolver for serialization).
 * @returns A configured TipTap extension ready to be added to an editor extensions array.
 */
export function CustomMentionExtension(props: TMentionHandler) {
  const { searchCallback, renderComponent, getMentionedEntityDetails } = props;
  return CustomMentionExtensionConfig.extend({
    addOptions(this) {
      return {
        ...this.parent?.(),
        renderComponent,
        getMentionedEntityDetails,
      };
    },

    addNodeView() {
      return ReactNodeViewRenderer((props) => (
        <MentionNodeView {...props} node={props.node as MentionNodeViewProps["node"]} />
      ));
    },
  }).configure({
    suggestion: {
      render: renderMentionsDropdown({
        searchCallback,
      }),
      allowSpaces: true,
    },
  });
}
