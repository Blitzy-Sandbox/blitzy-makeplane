/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel entrypoint for the slash-commands extension.
 *
 * Re-exports every public symbol from `./root`, which is the canonical
 * implementation file for the extension. Consumers MUST import from this
 * barrel (e.g. `@/extensions/slash-commands`) rather than reaching into
 * the implementation files directly; this keeps the public folder surface
 * stable across internal refactors of the menu / item-list / item-row split.
 *
 * Re-exported public surface:
 *   - `SlashCommands` — extension factory accepting `TExtensionProps`.
 *   - `SlashCommandOptions` — TipTap `Suggestion` plugin options shape used
 *     internally by the extension.
 *   - `TSlashCommandAdditionalOption` — type for additional items injected
 *     by callers into a target section, optionally placed after a named
 *     anchor command via `pushAfter`.
 *   - `TExtensionProps` — props consumed by `SlashCommands(...)`.
 */

export * from "./root";
