/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for the custom-link mark extension package.
 *
 * Re-exports the public surface from `./extension`:
 *   - `CustomLinkExtension`: TipTap mark that implements Plane's link
 *     behavior — wraps `@tiptap/extension-link` semantics with Plane-specific
 *     autolink, click-to-open, paste-to-link handling, and bubble-menu storage flags.
 *   - `CustomLinkStorage`: type describing the editor storage slice consumed by
 *     Plane's link bubble-menu UI components (preview-open flag, insertion
 *     range, and bubble-menu-open flag).
 *
 * Consumers should import from this barrel rather than the underlying
 * implementation file so the internal layout can evolve without forcing
 * downstream import updates as long as the exported API remains compatible.
 */
export * from "./extension";
