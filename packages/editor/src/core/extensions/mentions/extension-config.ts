/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Schema-only mention extension configuration — the "without-props" variant of the
 * editor's `@`-mention feature.
 *
 * This module owns the mention node schema, HTML parse/render, plain-text + markdown
 * serialization, and the `TMentionExtensionOptions` contract used by the runtime
 * variant in `./extension.tsx`. It deliberately omits any React node view and any
 * `@tiptap/suggestion`-driven autocomplete UI.
 *
 * WHY a separate "without-props" variant:
 *   Headless contexts that cannot mount React components (PDF export, server-side
 *   HTML→markdown conversion, schema-only document parsing) need to round-trip mention
 *   nodes without pulling in `react-dom`, `ReactNodeViewRenderer`, or
 *   `MentionsListDropdown`. `core-without-props.ts` registers this config (not the
 *   runtime extension from `./extension.tsx`) so those contexts render mentions as
 *   inert text/HTML via `renderText` and the markdown serializer.
 *
 * Wraps `@tiptap/extension-mention` (`Mention.extend<TMentionExtensionOptions>(...)`).
 *
 * Exposes / Overrides / Hides (relative to upstream `@tiptap/extension-mention`):
 *   - Exposes: mention node schema, HTML parse/render pipeline, markdown storage entry,
 *              the inherited `setMention` command (available to consumers that wire this
 *              schema into an editor).
 *   - Overrides:
 *       * `addAttributes` — uses Plane-specific `id`, `entity_identifier`, `entity_name`
 *         keyed by `EMentionComponentAttributeNames`, instead of upstream's default
 *         `id` + `label` pair. All three default to `null` so HTML round-trips with
 *         missing attributes do not throw.
 *       * `parseHTML` — recognizes the custom `<mention-component>` tag rather than
 *         upstream's `<span data-type="mention">` pattern.
 *       * `renderHTML` — emits `<mention-component>` with merged attributes (no class
 *         or `data-type` envelope).
 *       * `renderText` — produces `@<display-name | id | entity_identifier>` via
 *         `getMentionDisplayText`; upstream's default formats the `label` attribute.
 *       * `addStorage().markdown.serialize` — writes the display text into the markdown
 *         output stream so markdown exports render mentions as inert `@name` strings.
 *   - Hides:
 *       * Upstream HTML envelope (no class-based DOM matching, no `data-type` attribute).
 *       * Upstream suggestion configuration — added only by the runtime variant in
 *         `./extension.tsx` via `.configure({ suggestion: ... })`.
 *       * Upstream label-based attribute model — replaced with Plane's
 *         `entity_identifier` / `entity_name` model so the chip renderer can dispatch
 *         on entity type (user vs. project, etc.).
 */

import { mergeAttributes } from "@tiptap/core";
import type { MentionOptions } from "@tiptap/extension-mention";
import Mention from "@tiptap/extension-mention";
import type { MarkdownSerializerState } from "@tiptap/pm/markdown";
import type { Node as NodeType } from "@tiptap/pm/model";
// types
import type { TMentionHandler } from "@/types";
// local types
import type { TMentionComponentAttributes } from "./types";
import { EMentionComponentAttributeNames } from "./types";

/**
 * Options stored on the mention extension instance, extending upstream `MentionOptions`
 * with two Plane-specific callbacks supplied per editor instance via `TMentionHandler`:
 *
 *   - `renderComponent` — Pure React renderer invoked by `MentionNodeView` to paint the
 *     chip body (avatar + name, icon + name, etc.). Caller-owned; the editor package
 *     does not import application avatar/icon components.
 *   - `getMentionedEntityDetails` — Optional sync resolver invoked at HTML/markdown/text
 *     serialization time (see `getMentionDisplayText`) to upgrade an `entity_identifier`
 *     to a human-readable `display_name`. When undefined, `renderText` falls back to the
 *     raw `id` then to `entity_identifier`.
 */
export type TMentionExtensionOptions = MentionOptions & {
  renderComponent: TMentionHandler["renderComponent"];
  getMentionedEntityDetails: TMentionHandler["getMentionedEntityDetails"];
};

/**
 * Schema-only mention TipTap extension. Wraps `@tiptap/extension-mention` with:
 *
 *   - Attributes: `id`, `entity_identifier`, `entity_name` (all default `null`).
 *   - `parseHTML` matches `<mention-component>`; `renderHTML` emits `<mention-component>`
 *     with merged attributes.
 *   - `renderText` and `addStorage().markdown.serialize` both delegate to
 *     `getMentionDisplayText`, which prefixes the resolved display value with `@`.
 *
 * Consumers:
 *   - `./extension.tsx` `.extend(...).configure({ suggestion })` — runtime React variant.
 *   - `../core-without-props.ts` — headless variant for PDF export / server-side parsing.
 *
 * The two CORE_EXTENSIONS registrations both use the inherited schema name `"mention"`
 * (see `CORE_EXTENSIONS.MENTION` in `@/constants/extension`).
 */
export const CustomMentionExtensionConfig = Mention.extend<TMentionExtensionOptions>({
  addAttributes() {
    return {
      [EMentionComponentAttributeNames.ID]: {
        default: null,
      },
      [EMentionComponentAttributeNames.ENTITY_IDENTIFIER]: {
        default: null,
      },
      [EMentionComponentAttributeNames.ENTITY_NAME]: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mention-component",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mention-component", mergeAttributes(HTMLAttributes)];
  },

  renderText({ node }) {
    return getMentionDisplayText(this.options, node);
  },

  addStorage() {
    const options = this.options;
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: NodeType) {
          state.write(getMentionDisplayText(options, node));
        },
      },
    };
  },
});

/**
 * Resolve the display string for a mention node, prefixed with `@`.
 *
 * Fallback chain (in order):
 *   1. `options.getMentionedEntityDetails(entity_identifier)?.display_name` — the
 *      consumer-supplied lookup against application state.
 *   2. `attrs.id` — the mention node's persistent id attribute.
 *   3. `attrs.entity_identifier` — the entity reference id.
 *
 * Used by both `renderText` (TipTap plain-text export) and the markdown storage
 * serializer so HTML, plain text, and markdown round-trips all show the same `@name`
 * surface even when the React node view is not mounted (e.g., PDF export).
 *
 * @param options - The extension options, including the optional `getMentionedEntityDetails`.
 * @param node - The ProseMirror node whose `attrs` carry `TMentionComponentAttributes`.
 * @returns The display string, always starting with `@`.
 */
function getMentionDisplayText(options: TMentionExtensionOptions, node: NodeType): string {
  const attrs = node.attrs as TMentionComponentAttributes;
  const mentionEntityId = attrs[EMentionComponentAttributeNames.ENTITY_IDENTIFIER];
  const mentionEntityDetails = options.getMentionedEntityDetails?.(mentionEntityId ?? "");
  return `@${mentionEntityDetails?.display_name ?? attrs[EMentionComponentAttributeNames.ID] ?? mentionEntityId}`;
}
