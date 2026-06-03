/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public API barrel for the link interaction subsystem in `@plane/editor`. Forwards
 * three sibling modules below so downstream code depends on a single stable
 * `@/components/links` import path for the floating link UI (preview ↔ edit
 * popovers and the controller that switches between them).
 *
 * Exported surface (transitively via the star re-exports below):
 *   - `LinkView` — controller that renders either `LinkPreview` or `LinkEditView`;
 *     resets back to preview when the selection `from` position changes.
 *   - `LinkPreview` — hover popover showing the URL with copy / edit / remove
 *     actions; the edit and remove buttons are gated on `editor.isEditable`.
 *   - `LinkEditView` — edit popover with URL + display-text inputs and a remove
 *     action; auto-removes an unsubmitted, empty link on cleanup.
 *   - `LinkViewProps`, `LinkViews` — prop contract and the
 *     `"LinkPreview" | "LinkEditView"` view discriminant consumed by the controller.
 *
 * Primary consumers (import via the `@/components/links` path alias that resolves
 * to this barrel):
 *   - `core/components/editors/link-view-container.tsx` — direct consumer that
 *     mounts `LinkView` with Floating UI positioning when the cursor hovers a link
 *     anchor; coordinates via `editor.storage.link` (`isPreviewOpen`,
 *     `isBubbleMenuOpen`) so the hover popover does not collide with the bubble
 *     menu.
 *   - `core/components/menus/bubble-menu/link-selector.tsx` — peer bubble-menu
 *     entry point for the same link UX subsystem (creates / clears URLs through
 *     the `setLinkEditor` / `unsetLinkEditor` editor commands rather than by
 *     mounting these popovers directly).
 *
 * Relationship to `@tiptap/extension-link` (Directive 3 — exposed / overridden /
 * hidden): this barrel SURFACES UI that the upstream extension does not provide
 * (hover preview, in-place edit popover). The upstream mark's data model and its
 * click-to-open navigation are preserved and reimplemented by the companion
 * `core/extensions/custom-link/` mark, which owns `openOnClick`, autolink, and
 * paste-to-link handling. This barrel is UI-only and does not override the
 * upstream mark schema.
 */
export * from "./link-edit-view";
export * from "./link-preview";
export * from "./link-view";
