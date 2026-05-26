/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Rich-text editor additional-extension assembly module.
 *
 * Consumed by `core/components/editors/rich-text/editor.tsx` (the rich-text
 * editor component, which itself wires extensions into the foundational
 * `useEditor` hook in `core/hooks/use-editor.ts`).
 *
 * The registry pattern conditionally includes the `SlashCommands` TipTap
 * extension when not present in `disabledExtensions` and returns a filtered
 * `Extensions` array; this is the CE wrapper's contribution beyond
 * `CORE_EXTENSIONS`.
 */

import type { AnyExtension, Extensions } from "@tiptap/core";
// extensions
import { SlashCommands } from "@/extensions/slash-commands/root";
// types
import type { IEditorProps, TExtensions } from "@/types";

/**
 * Subset of `IEditorProps` needed by the rich-text additional-extension builder.
 *
 * Picks `disabledExtensions`, `flaggedExtensions`, `fileHandler`, and
 * `extendedEditorProps` from `IEditorProps`; see `IEditorProps` for full
 * field semantics.
 */
export type TRichTextEditorAdditionalExtensionsProps = Pick<
  IEditorProps,
  "disabledExtensions" | "flaggedExtensions" | "fileHandler" | "extendedEditorProps"
>;

/**
 * Registry entry shape for conditionally activating a rich-text extension.
 *
 * Decouples enablement logic (`isEnabled`) from instantiation
 * (`getExtension`) so each entry self-describes its activation criteria —
 * additions or removals of extension entries do not require changes to the
 * `RichTextEditorAdditionalExtensions` build pipeline.
 */
export type TRichTextEditorAdditionalExtensionsRegistry = {
  /** Determines if the extension should be enabled based on disabled extensions */
  isEnabled: (disabledExtensions: TExtensions[], flaggedExtensions: TExtensions[]) => boolean;
  /** Returns the extension instance(s) when enabled */
  getExtension: (props: TRichTextEditorAdditionalExtensionsProps) => AnyExtension | undefined;
};

const extensionRegistry: TRichTextEditorAdditionalExtensionsRegistry[] = [
  {
    isEnabled: (disabledExtensions) => !disabledExtensions.includes("slash-commands"),
    getExtension: ({ disabledExtensions, flaggedExtensions }) =>
      SlashCommands({
        disabledExtensions,
        flaggedExtensions,
      }),
  },
];

/**
 * Builds the rich-text editor's additional extension array by filtering the
 * registry against `disabledExtensions`/`flaggedExtensions` and instantiating
 * each enabled entry.
 *
 * Invoked by `core/components/editors/rich-text/editor.tsx` when constructing
 * the rich-text editor's extensions; the result is spread into the
 * `EditorWrapper`'s `extensions` prop, which then feeds the `useEditor()`
 * hook in `core/hooks/use-editor.ts`.
 *
 * Currently wraps a single TipTap extension: `SlashCommands` from
 * `@/extensions/slash-commands/root` (conditional on the `"slash-commands"`
 * literal NOT being present in `disabledExtensions`). This is the CE
 * wrapper's contribution beyond the `CORE_EXTENSIONS` set.
 *
 * @param props - Editor props subset (`TRichTextEditorAdditionalExtensionsProps`)
 *   containing `disabledExtensions`, `flaggedExtensions`, `fileHandler`, and
 *   `extendedEditorProps`; see inline TypeScript annotation for the exact shape.
 * @returns TipTap `Extensions` array (may be empty if all registry entries are
 *   disabled by the caller's `disabledExtensions` list).
 */
export function RichTextEditorAdditionalExtensions(props: TRichTextEditorAdditionalExtensionsProps) {
  const { disabledExtensions, flaggedExtensions } = props;

  const extensions: Extensions = extensionRegistry
    .filter((config) => config.isEnabled(disabledExtensions, flaggedExtensions))
    .map((config) => config.getExtension(props))
    .filter((extension): extension is AnyExtension => extension !== undefined);

  return extensions;
}
