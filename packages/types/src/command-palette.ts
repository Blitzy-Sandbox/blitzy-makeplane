/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Command palette and keyboard shortcut contracts for the `@plane/types` package.
 *
 * Models the registry of palette actions (consumed by `apps/web/core/store/base-command-palette.store.ts`
 * and the `Cmd-K`/`Ctrl-K` menu) and the shortcut help screen displayed from the user menu.
 */

/**
 * Map of command palette actions keyed by stable string id.
 *
 * Each entry pairs a localized title/description with the callback executed when the user
 * selects the action. Consumers: command palette view in `apps/web/ce/components/command-palette/`.
 */
export type TCommandPaletteActionList = Record<string, { title: string; description: string; action: () => void }>;

/**
 * Group of related keyboard shortcuts displayed under a single section in the help screen.
 *
 * Fields:
 * - `key`: stable group identifier used for React keying
 * - `title`: localized section header (e.g. "Navigation", "Issues")
 * - `shortcuts`: ordered list of shortcuts in this group
 */
export type TCommandPaletteShortcutList = {
  key: string;
  title: string;
  shortcuts: TCommandPaletteShortcut[];
};

/**
 * Single keyboard shortcut entry shown in the shortcut help dialog.
 *
 * Fields:
 * - `keys`: comma-separated key combination (e.g. "Ctrl,K" or "Shift,Enter")
 * - `description`: localized human-readable label
 */
export type TCommandPaletteShortcut = {
  keys: string; // comma separated keys
  description: string;
};
