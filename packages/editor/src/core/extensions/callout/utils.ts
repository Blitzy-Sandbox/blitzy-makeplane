/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Callout extension runtime helpers — the canonical default-attributes object
 * and four `localStorage`-backed accessors for the user's last-used logo and
 * background color.
 *
 * First-party helpers: not a wrapper of any upstream library. Stored values
 * are passed through Plane's shared `sanitizeHTML` (from `@plane/utils`) on
 * read so they cannot smuggle a script payload back into the DOM when they
 * are later written as `data-*` attributes by `extension-config.ts`
 * `renderHTML`.
 *
 * WHY persist to localStorage: a user editing one callout typically expects
 * the next callout they insert (same session or next visit) to reuse the same
 * logo and background color. `extension.tsx` `insertCallout` reads these
 * helpers on every insertion to pre-seed the new node, and `block.tsx`
 * (background) plus `logo-selector.tsx` (logo) write back on every pick.
 *
 * Storage keys (literal, must not change):
 * - `editor-calloutComponent-logo` — JSON-encoded `TLogoProps`.
 * - `editor-calloutComponent-background` — plain swatch key string (e.g.
 *   `"red"`, `"blue"`) drawn from `COLORS_LIST`.
 *
 * SSR safety: every helper gates on `typeof window !== "undefined"` so the
 * server-rendered editor paths (used by `apps/live` and the PDF export
 * pipeline) do not crash on `localStorage` access.
 */

// plane imports
import type { TLogoProps } from "@plane/types";
import { sanitizeHTML } from "@plane/utils";
// types
import type { TCalloutBlockAttributes, TCalloutBlockEmojiAttributes, TCalloutBlockIconAttributes } from "./types";
import { ECalloutAttributeNames } from "./types";

/**
 * Canonical default attribute set for a freshly inserted callout when no user
 * preference is stored — seeds the ProseMirror schema and is the fallback
 * returned by `getStoredLogo` when persisted data is missing or corrupt.
 *
 * Logo default: the Apple emoji 💡 — `data-emoji-unicode` decimal `"128161"`
 * (U+1F4A1) with `data-emoji-url` pinned to
 * `cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f4a1.png`,
 * paired with `data-logo-in-use: "emoji"`. The light-bulb conveys
 * "callout / tip / note" intent without locale assumptions, and the Apple
 * emoji set is used everywhere in Plane for cross-platform visual parity.
 *
 * Block-type marker: `data-block-type: "callout-component"` is the literal
 * the `parseHTML` selector in `./extension-config.ts` matches on — changing
 * this value without updating that selector breaks the HTML round-trip.
 *
 * Consumers: `extension-config.ts` `addAttributes` (seeds `Node.create`
 * defaults), `extension.tsx` `insertCallout` (used as the fallback when
 * `localStorage` is empty), `getStoredLogo` (fallback on missing/corrupt
 * data), and `logo-selector.tsx` (fallback shape for new picks).
 */
export const DEFAULT_CALLOUT_BLOCK_ATTRIBUTES: TCalloutBlockAttributes = {
  [ECalloutAttributeNames.ID]: null,
  [ECalloutAttributeNames.LOGO_IN_USE]: "emoji",
  [ECalloutAttributeNames.ICON_COLOR]: undefined,
  [ECalloutAttributeNames.ICON_NAME]: undefined,
  [ECalloutAttributeNames.EMOJI_UNICODE]: "128161",
  [ECalloutAttributeNames.EMOJI_URL]: "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f4a1.png",
  [ECalloutAttributeNames.BACKGROUND]: undefined,
  [ECalloutAttributeNames.BLOCK_TYPE]: "callout-component",
};

/**
 * Internal-only discriminated union of the `data-logo-in-use` field plus
 * either the emoji-attribute sub-shape or the icon-attribute sub-shape —
 * never both.
 *
 * WHY a union (and not the full `TCalloutBlockAttributes`): `getStoredLogo`
 * only persists and returns the four logo-related fields; `ID`,
 * `data-background`, and `data-block-type` are reset to defaults on every
 * callout insertion and are intentionally not carried across sessions.
 */
type TStoredLogoValue = Pick<TCalloutBlockAttributes, ECalloutAttributeNames.LOGO_IN_USE> &
  (TCalloutBlockEmojiAttributes | TCalloutBlockIconAttributes);

/**
 * Read the user's last-used callout logo from
 * `localStorage["editor-calloutComponent-logo"]` as a `TStoredLogoValue`
 * ready to spread into a `Partial<TCalloutBlockAttributes>` payload at
 * insertion time.
 *
 * Falls back to the emoji default (decimal `"128161"`, Apple bulb CDN URL)
 * when (a) running on the server (`window` undefined), (b) the storage key
 * is empty, (c) `JSON.parse` fails, or (d) the parsed payload is well-formed
 * JSON but is missing the required emoji `value` or icon `name` field.
 *
 * On a `JSON.parse` failure the corrupt entry is **removed** from
 * `localStorage` and the error is logged to `console.error`. WHY evict: a
 * malformed entry persists across reloads and would otherwise repeat the
 * parse failure on every callout insertion — clearing it breaks that loop.
 *
 * Input is passed through `sanitizeHTML` (from `@plane/utils`) before JSON
 * parsing because the returned values eventually become `data-*` attributes
 * written to the DOM via `mergeAttributes` in `extension-config.ts`
 * `renderHTML`; sanitizing at read-time defends against tampered
 * `localStorage` entries.
 *
 * Consumers: `extension.tsx` `insertCallout` (pre-seeds the new callout);
 * `logo-selector.tsx` (indirectly, via the
 * `DEFAULT_CALLOUT_BLOCK_ATTRIBUTES` fallback).
 *
 * @returns A `TStoredLogoValue` — either the persisted logo or the
 *          emoji-default fallback.
 */
// function to get the stored logo from local storage
export const getStoredLogo = (): TStoredLogoValue => {
  const fallBackValues: TStoredLogoValue = {
    [ECalloutAttributeNames.LOGO_IN_USE]: "emoji",
    [ECalloutAttributeNames.EMOJI_UNICODE]: DEFAULT_CALLOUT_BLOCK_ATTRIBUTES[ECalloutAttributeNames.EMOJI_UNICODE],
    [ECalloutAttributeNames.EMOJI_URL]: DEFAULT_CALLOUT_BLOCK_ATTRIBUTES[ECalloutAttributeNames.EMOJI_URL],
  };

  if (typeof window !== "undefined") {
    const storedData = sanitizeHTML(localStorage.getItem("editor-calloutComponent-logo") ?? "");
    if (storedData) {
      let parsedData: TLogoProps;
      try {
        parsedData = JSON.parse(storedData) as TLogoProps;
      } catch (error) {
        console.error(`Error parsing stored callout logo, stored value- ${storedData}`, error);
        localStorage.removeItem("editor-calloutComponent-logo");
        return fallBackValues;
      }
      if (parsedData.in_use === "emoji" && parsedData.emoji?.value) {
        return {
          [ECalloutAttributeNames.LOGO_IN_USE]: "emoji",
          [ECalloutAttributeNames.EMOJI_UNICODE]:
            parsedData.emoji.value || DEFAULT_CALLOUT_BLOCK_ATTRIBUTES[ECalloutAttributeNames.EMOJI_UNICODE],
          [ECalloutAttributeNames.EMOJI_URL]:
            parsedData.emoji.url || DEFAULT_CALLOUT_BLOCK_ATTRIBUTES[ECalloutAttributeNames.EMOJI_URL],
        };
      }
      if (parsedData.in_use === "icon" && parsedData.icon?.name) {
        return {
          [ECalloutAttributeNames.LOGO_IN_USE]: "icon",
          [ECalloutAttributeNames.ICON_NAME]:
            parsedData.icon.name || DEFAULT_CALLOUT_BLOCK_ATTRIBUTES[ECalloutAttributeNames.ICON_NAME],
          [ECalloutAttributeNames.ICON_COLOR]:
            parsedData.icon.color || DEFAULT_CALLOUT_BLOCK_ATTRIBUTES[ECalloutAttributeNames.ICON_COLOR],
        };
      }
    }
  }
  // fallback values
  return fallBackValues;
};
/**
 * Persist the user's chosen logo to
 * `localStorage["editor-calloutComponent-logo"]` as `JSON.stringify(value)`.
 *
 * No-op on the server (`typeof window === "undefined"`). Idempotent for
 * identical inputs; consecutive distinct calls overwrite each other so the
 * last write wins — which is the intended "remember my most-recent pick"
 * semantic.
 *
 * Consumer: `logo-selector.tsx` `onChange` writes here after every
 * successful emoji or icon pick.
 *
 * @param value - The canonical `TLogoProps` shape from `@plane/types`; the
 *                same shape produced by `logo-selector.tsx`'s `onChange`
 *                emoji and icon branches.
 */
// function to update the stored logo on local storage
export const updateStoredLogo = (value: TLogoProps): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem("editor-calloutComponent-logo", JSON.stringify(value));
};
/**
 * Read the user's last-used callout background swatch key from
 * `localStorage["editor-calloutComponent-background"]`.
 *
 * The returned value is the persisted `key` from `COLORS_LIST` (e.g.
 * `"red"`) passed through `sanitizeHTML` from `@plane/utils` for the same
 * XSS-defense reason as `getStoredLogo`. Returns `null` on the server
 * (`window` undefined) and the empty-string result of `sanitizeHTML("")`
 * when no preference is stored.
 *
 * Consumer: `extension.tsx` `insertCallout` (pre-seeds `data-background`
 * on the new callout).
 *
 * @returns Sanitized swatch key string, or `null` on the server.
 */
// function to get the stored background color from local storage
export const getStoredBackgroundColor = (): string | null => {
  if (typeof window !== "undefined") {
    return sanitizeHTML(localStorage.getItem("editor-calloutComponent-background") ?? "");
  }
  return null;
};
/**
 * Persist or clear the user's chosen callout background swatch in
 * `localStorage["editor-calloutComponent-background"]`.
 *
 * When `value === null` the storage key is **removed** so the next callout
 * inserts with the editor-default `bg-layer-3` shell; otherwise the swatch
 * key is written as a raw string. No-op on the server.
 *
 * Idempotent for identical inputs; sequential distinct calls overwrite
 * each other (last write wins) — the same "remember most-recent pick"
 * semantic as `updateStoredLogo`.
 *
 * Consumer: `block.tsx` `onSelect` callback wired into
 * `CalloutBlockColorSelector` (writes after every color pick, including
 * the Ban-icon clear that passes `null`).
 *
 * @param value - The swatch `key` from `COLORS_LIST`, or `null` to clear
 *                the persisted preference.
 */
// function to update the stored background color on local storage
export const updateStoredBackgroundColor = (value: string | null): void => {
  if (typeof window === "undefined") return;
  if (value === null) {
    localStorage.removeItem("editor-calloutComponent-background");
    return;
  } else {
    localStorage.setItem("editor-calloutComponent-background", value);
  }
};
