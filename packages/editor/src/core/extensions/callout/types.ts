/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Type surface for the callout extension: the `data-*` attribute name enum, the
 * icon- and emoji-mode logo sub-shapes, the composite attribute shape, and the
 * TipTap node type alias used to constrain the schema-only config.
 *
 * Foundational within this folder — `extension-config.ts`, `extension.tsx`,
 * `block.tsx`, `logo-selector.tsx`, and `utils.ts` all import from here. This
 * module imports nothing back from any sibling, so the type surface stays
 * decoupled from runtime code paths and free of circular dependencies.
 *
 * First-party type surface: callout is a Plane-authored ProseMirror node, not
 * a wrapper of any upstream `@tiptap/extension-*` package. The shapes are
 * designed against Plane's persistence model — `data-*` HTML attributes that
 * survive the serialize → markdown → deserialize round trip enforced by
 * `extension-config.ts` `parseHTML`/`renderHTML` and the `markdown.serialize`
 * writer.
 */

import type { Node as ProseMirrorNode } from "@tiptap/core";

/**
 * Canonical names of every HTML attribute the callout block persists on its
 * outer `<div>`. The enum **values** (`"id"`, `"data-icon-color"`, …) are the
 * literal attribute keys that appear in the DOM and in the `parseHTML`
 * selector — this enum is the single source of truth for those keys across the
 * folder.
 *
 * Enum-driven by design: `extension-config.ts` `addAttributes` reduces over
 * `Object.values(ECalloutAttributeNames)` to generate the ProseMirror attribute
 * spec from `DEFAULT_CALLOUT_BLOCK_ATTRIBUTES` (in `utils.ts`). Adding a new
 * attribute therefore requires three coordinated edits: (1) a member here,
 * (2) a matching default in `DEFAULT_CALLOUT_BLOCK_ATTRIBUTES`, and (3) — for
 * HTML-round-trip fields — `parseHTML`/`renderHTML` handling in
 * `extension-config.ts`.
 *
 * Members:
 * - `ID` (`"id"`) — TipTap-generated unique identifier for the block instance;
 *   used as the React `key` on the NodeView wrapper. Lowercase rather than
 *   `data-*` because `id` is a native HTML attribute managed by TipTap's
 *   UniqueID extension elsewhere in the editor.
 * - `ICON_COLOR` (`"data-icon-color"`) — Lucide icon color when
 *   `LOGO_IN_USE === "icon"`; `undefined` in emoji mode.
 * - `ICON_NAME` (`"data-icon-name"`) — Lucide icon key (e.g. `"Star"`) when in
 *   icon mode.
 * - `EMOJI_UNICODE` (`"data-emoji-unicode"`) — decimal Unicode codepoint string
 *   (e.g. `"128161"` for the light-bulb emoji) when in emoji mode.
 * - `EMOJI_URL` (`"data-emoji-url"`) — pinned CDN URL to the Apple emoji
 *   image; emitted by the `markdown.serialize` writer inside an `<img>` tag.
 * - `LOGO_IN_USE` (`"data-logo-in-use"`) — discriminant valued `"emoji"` or
 *   `"icon"`. The four logo-related fields above are declared in pairs, but
 *   only the pair matching this discriminant is meaningful at any given time.
 * - `BACKGROUND` (`"data-background"`) — swatch key from `COLORS_LIST` (e.g.
 *   `"red"`) or `undefined` for the default `bg-layer-3` shell.
 * - `BLOCK_TYPE` (`"data-block-type"`) — always `"callout-component"`; the
 *   literal value matches the `parseHTML` tag selector in
 *   `extension-config.ts`, so changing this key without updating that selector
 *   breaks HTML round-trip.
 */
export enum ECalloutAttributeNames {
  ID = "id",
  ICON_COLOR = "data-icon-color",
  ICON_NAME = "data-icon-name",
  EMOJI_UNICODE = "data-emoji-unicode",
  EMOJI_URL = "data-emoji-url",
  LOGO_IN_USE = "data-logo-in-use",
  BACKGROUND = "data-background",
  BLOCK_TYPE = "data-block-type",
}

/**
 * Sub-shape carrying the two icon-mode logo fields — `data-icon-color` and
 * `data-icon-name` — both `string | undefined`. Meaningful only when the
 * `data-logo-in-use` discriminant is `"icon"`; in emoji mode `logo-selector.tsx`
 * writes both fields back to `undefined`.
 *
 * Split out from `TCalloutBlockAttributes` so that `utils.ts` `TStoredLogoValue`
 * can compose just the icon half via a union (`TCalloutBlockEmojiAttributes |
 * TCalloutBlockIconAttributes`) without dragging in the emoji pair.
 */
export type TCalloutBlockIconAttributes = {
  [ECalloutAttributeNames.ICON_COLOR]: string | undefined;
  [ECalloutAttributeNames.ICON_NAME]: string | undefined;
};

/**
 * Sub-shape carrying the two emoji-mode logo fields — `data-emoji-unicode`
 * (decimal Unicode codepoint string) and `data-emoji-url` (Apple
 * emoji-datasource CDN URL) — both `string | undefined`. Meaningful only when
 * the `data-logo-in-use` discriminant is `"emoji"`; in icon mode
 * `logo-selector.tsx` writes both fields back to `undefined`.
 *
 * Split out for the same reason as `TCalloutBlockIconAttributes`: lets
 * `utils.ts` `TStoredLogoValue` compose just the emoji half via a union without
 * dragging in the icon pair.
 */
export type TCalloutBlockEmojiAttributes = {
  [ECalloutAttributeNames.EMOJI_UNICODE]: string | undefined;
  [ECalloutAttributeNames.EMOJI_URL]: string | undefined;
};

/**
 * Full attribute shape carried by a callout ProseMirror node — an intersection
 * of the base attributes (`ID`, `LOGO_IN_USE`, `BACKGROUND`, `BLOCK_TYPE`) with
 * both `TCalloutBlockIconAttributes` and `TCalloutBlockEmojiAttributes`.
 *
 * Intersection, not discriminated union: TipTap's attribute schema flattens
 * every attribute into a single flat record at the ProseMirror layer, so both
 * the icon and emoji pairs are always present on this type. Runtime branching
 * uses `data-logo-in-use` as the discriminant, and the inactive logo pair
 * holds `undefined` (or stale prior-mode values that callers must ignore).
 * Modelling this as a union would force every consumer to narrow on each read;
 * the flat declaration matches the actual runtime record and keeps
 * `addAttributes` in `extension-config.ts` a single reduce over the enum.
 *
 * Non-obvious field semantics:
 * - `BLOCK_TYPE` is the literal `"callout-component"` — downstream parsers
 *   (markdown deserializer, server-side HTML → ProseMirror pipelines) narrow
 *   on this slot to distinguish callout nodes from other `<div>` blocks.
 * - `LOGO_IN_USE` is the literal union `"emoji" | "icon"`, exhaustively
 *   switched on in the `markdown.serialize` writer of `extension-config.ts`
 *   and in `logo-selector.tsx` `onChange`.
 * - `ID` is `string | null` (null until the editor assigns one); `BACKGROUND`
 *   is `string | undefined` (omitted → default `bg-layer-3` shell).
 */
export type TCalloutBlockAttributes = {
  [ECalloutAttributeNames.ID]: string | null;
  [ECalloutAttributeNames.LOGO_IN_USE]: "emoji" | "icon";
  [ECalloutAttributeNames.BACKGROUND]: string | undefined;
  [ECalloutAttributeNames.BLOCK_TYPE]: "callout-component";
} & TCalloutBlockIconAttributes &
  TCalloutBlockEmojiAttributes;

/**
 * Opaque markers for the callout extension's TipTap-level `addOptions` and
 * `addStorage` surfaces — both intentionally `unknown` because the extension
 * exposes no public options or storage to consumers.
 *
 * `addStorage` in `extension-config.ts` does declare a `markdown.serialize`
 * writer, but that is internal storage consumed only by the markdown
 * serializer pipeline, not part of the public type contract;
 * `CustomCalloutExtensionStorage` therefore stays `unknown` and is not
 * narrowed. Both aliases are consumed as the two generic parameters of
 * `Node.extend<...>(...)` in `extension.tsx`.
 */
export type CustomCalloutExtensionOptions = unknown;
export type CustomCalloutExtensionStorage = unknown;

/**
 * Convenience alias for the fully-parameterized TipTap node type, applied as
 * the explicit annotation on `CustomCalloutExtensionConfig` in
 * `extension-config.ts`.
 *
 * The explicit annotation pins the Options/Storage generics on the
 * schema-only `Node.create(...)` config so they cannot silently diverge from
 * the runtime-extended `Node.extend<Options, Storage>(...)` variant in
 * `extension.tsx` during refactors elsewhere in the codebase.
 */
export type CustomCalloutExtensionType = ProseMirrorNode<CustomCalloutExtensionOptions, CustomCalloutExtensionStorage>;
