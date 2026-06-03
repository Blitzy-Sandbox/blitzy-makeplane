/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Document-editor additional-extension assembly module.
 *
 * Consumed by `core/hooks/use-collaborative-editor.ts` (the collaborative/document editor hook)
 * and `core/components/editors/document/editor.tsx` (the document editor component) to build
 * the document editor's additional extension array.
 *
 * The props contract is broader than the rich-text counterpart, adding document-/session-specific
 * fields (`isEditable`, optional Hocuspocus `provider`, `userDetails`) to support collaboration
 * awareness and edit-permission gating.
 */

import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { AnyExtension } from "@tiptap/core";
import { SlashCommands } from "@/extensions";
// types
import type { IEditorProps, TExtensions, TUserDetails } from "@/types";

/**
 * Props contract for the document-editor additional-extension builder.
 *
 * Picks `disabledExtensions`, `flaggedExtensions`, `fileHandler`, and `extendedEditorProps`
 * from `IEditorProps`.
 *
 * Document-/session-specific fields intersected on top:
 * - `isEditable: boolean` — gates extensions that should be disabled in read-only mode
 *   (e.g., write-permission gating for collaborative sessions).
 * - `provider?: HocuspocusProvider` — optional Hocuspocus provider for collaborative awareness
 *   extensions (presence, cursors); omitted in non-collaborative document contexts.
 * - `userDetails: TUserDetails` — current user info for presence/cursor extensions.
 *
 * Refer to `IEditorProps`, `HocuspocusProvider`, and `TUserDetails` for their detailed semantics;
 * this JSDoc does NOT duplicate them.
 */
export type TDocumentEditorAdditionalExtensionsProps = Pick<
  IEditorProps,
  "disabledExtensions" | "flaggedExtensions" | "fileHandler" | "extendedEditorProps"
> & {
  isEditable: boolean;
  provider?: HocuspocusProvider;
  userDetails: TUserDetails;
};

/**
 * Registry entry shape for conditionally activating a document-editor extension.
 *
 * Decouples enablement logic (`isEnabled`) from instantiation (`getExtension`) so each entry
 * self-describes its activation criteria — additions or removals of extension entries do not
 * require changes to the `DocumentEditorAdditionalExtensions` build pipeline.
 *
 * Note: `getExtension` returns `AnyExtension` (non-optional) — unlike the rich-text registry
 * which returns `AnyExtension | undefined` — so the build pipeline does NOT need a trailing
 * undefined-narrowing filter.
 */
export type TDocumentEditorAdditionalExtensionsRegistry = {
  isEnabled: (disabledExtensions: TExtensions[], flaggedExtensions: TExtensions[]) => boolean;
  getExtension: (props: TDocumentEditorAdditionalExtensionsProps) => AnyExtension;
};

const extensionRegistry: TDocumentEditorAdditionalExtensionsRegistry[] = [
  {
    isEnabled: (disabledExtensions) => !disabledExtensions.includes("slash-commands"),
    getExtension: ({ disabledExtensions, flaggedExtensions }) =>
      SlashCommands({ disabledExtensions, flaggedExtensions }),
  },
];

/**
 * Builds the document/collaborative editor's additional extension array by filtering the registry
 * against `disabledExtensions`/`flaggedExtensions` and instantiating each enabled entry.
 *
 * Invoked by `core/hooks/use-collaborative-editor.ts` and `core/components/editors/document/editor.tsx`
 * when constructing the document editor; the result is spread into the editor's extensions array.
 *
 * Currently wraps a single TipTap extension: `SlashCommands` from `@/extensions` (the barrel
 * re-export of `core/extensions/slash-commands/root`), conditional on the `"slash-commands"`
 * literal NOT being present in `disabledExtensions`. This is the CE wrapper's contribution beyond
 * the `CORE_EXTENSIONS` set.
 *
 * @param props - Document editor props (`TDocumentEditorAdditionalExtensionsProps`).
 * @returns Array of `AnyExtension` (may be empty if all registry entries are disabled by the
 *   caller's `disabledExtensions` list). Note: this is a `.filter().map()` pipeline without a
 *   trailing undefined-narrowing filter — the registry's `getExtension` is typed `AnyExtension`
 *   (non-optional), which is the type-level difference from `rich-text-extensions.tsx`.
 */
export function DocumentEditorAdditionalExtensions(props: TDocumentEditorAdditionalExtensionsProps) {
  const { disabledExtensions, flaggedExtensions } = props;

  const documentExtensions = extensionRegistry
    .filter((config) => config.isEnabled(disabledExtensions, flaggedExtensions))
    .map((config) => config.getExtension(props));

  return documentExtensions;
}
