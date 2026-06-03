/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Slash-command extension type contracts for `@plane/editor`.
 *
 * Models the three shapes the slash-command machinery needs:
 *   - `CommandProps` — the live editor + ProseMirror range passed to every
 *     executor when the user selects a slash-menu entry.
 *   - `TSlashCommandSectionKeys` — string-literal allowlist of section
 *     buckets used to group commands in the dropdown.
 *   - `ISlashCommandItem` — metadata + executor shape for a single entry
 *     rendered in the suggestion popover.
 *
 * Consumer: `core/extensions/slash-commands/` — `command-items-list.tsx`
 * builds the `ISlashCommandItem[]` registry, `command-menu.tsx` /
 * `command-menu-item.tsx` render it, and `root.tsx` wires the suggestion
 * plugin into TipTap. Symbols here are re-exported through the
 * `@/types` barrel (`core/types/index.ts`) and form part of the
 * `@plane/editor` public API per AAP Directive 3.
 */

import type { Editor, Range } from "@tiptap/core";
import type { CSSProperties } from "react";
import type { TEditorCommands } from "@/types";

/**
 * Argument shape passed to every `ISlashCommandItem.command` executor when
 * the user selects an entry from the slash-suggestion dropdown.
 *
 * Both fields are required because the executor needs them together:
 *   - `editor` is the live `@tiptap/core` editor instance the executor
 *     mutates via `editor.chain()…run()` (the editor is not module-global,
 *     so it must be threaded through the callback).
 *   - `range` is the ProseMirror range covering the slash trigger (`/`) plus
 *     any typed query text. Executors are expected to delete this range as
 *     the first step of their chain (e.g.,
 *     `editor.chain().focus().deleteRange(range).<action>().run()`) so the
 *     trigger does not remain in the document after the command resolves.
 */
export type CommandProps = {
  editor: Editor;
  range: Range;
};

/**
 * Closed allowlist of section keys used to bucket `ISlashCommandItem`
 * entries into groups in the slash-suggestion dropdown.
 *
 * Constrained as a string-literal union (rather than `string`) so consumers
 * registering a command into a section get compile-time rejection of typos
 * and IDE autocomplete — `"general"` holds structural commands (text,
 * headings, lists, etc.), `"text-colors"` and `"background-colors"` hold the
 * palette-driven color toggles. Adding a new section requires extending
 * this union AND the section registry in
 * `core/extensions/slash-commands/command-items-list.tsx`.
 */
export type TSlashCommandSectionKeys = "general" | "text-colors" | "background-colors";

/**
 * Metadata + executor describing a single slash-command entry shown in the
 * suggestion dropdown.
 *
 * Field semantics worth flagging (per AAP Directive 3 — "noting any fields
 * with non-obvious semantics"):
 *   - `commandKey` is the catalog discriminator that ties this item back to
 *     `TEditorCommands`; the same logical command may surface in both the
 *     slash menu and a toolbar with the same `commandKey` but a different
 *     `key`, and helpers such as `EditorRefApi.executeMenuItemCommand`
 *     resolve invocations through this value.
 *   - `key` is the React list key used by `command-menu-item.tsx` when
 *     rendering the dropdown. It is intentionally distinct from
 *     `commandKey` so two entries sharing the same logical command (e.g.,
 *     two presentation variants) can coexist without React key collisions.
 *   - `searchTerms` extends the fuzzy filter beyond `title` and
 *     `description` with synonyms and aliases (e.g., `"todo"` matches the
 *     checklist command, `"p"` matches the paragraph command). Items omit
 *     it only when `title`/`description` cover every reasonable search.
 *   - `icon` is a pre-rendered React node (typically a `lucide-react`
 *     glyph at `size-3.5`) displayed in the leading slot of the row.
 *   - `iconContainerStyle?` is an optional inline style on the icon's
 *     container; when omitted the dropdown applies its default container
 *     styling — used by color-toggle commands to render swatch chips.
 *   - `command` is the executor invoked on selection and MUST consume
 *     `range` (via `editor.chain().focus().deleteRange(range)…`) before
 *     inserting content; otherwise the slash trigger and query text remain
 *     in the document. See `CommandProps` for the executor contract.
 *   - `badge?` is an optional pre-rendered React node displayed next to
 *     the title to flag secondary status (e.g., a "Beta" or "New" pill).
 *
 * Consumer: `core/extensions/slash-commands/command-items-list.tsx`
 * (registry) and `core/extensions/slash-commands/command-menu-item.tsx`
 * (renderer).
 */
export type ISlashCommandItem = {
  commandKey: TEditorCommands;
  key: string;
  title: string;
  description: string;
  searchTerms: string[];
  icon: React.ReactNode;
  iconContainerStyle?: CSSProperties;
  command: ({ editor, range }: CommandProps) => void;
  badge?: React.ReactNode;
};
