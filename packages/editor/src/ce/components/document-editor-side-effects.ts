/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Stable React mount point reserved for future editor/document side effects.
 *
 * This is the CE (community-edition) implementation of the document-editor
 * side-effects slot: it accepts an `Editor` instance, document `id`, and
 * optional extended editor props, but currently renders nothing. The EE
 * namespace may override this slot to attach document-level side effects such
 * as page-property syncing or presence-write hooks.
 *
 * The component exists to preserve a stable typed contract so consumers can
 * mount it unconditionally in collaborative document trees, eliminating
 * conditional null-checks against an EE-vs-CE feature toggle at every call site.
 */

import type { Editor } from "@tiptap/core";
import type { ReactElement } from "react";
import type { IEditorPropsExtended } from "@/types";

/**
 * Props contract for the document-editor side-effects mount point.
 *
 * `updatePageProperties` is intentionally typed as `unknown` so the CE build
 * does not couple itself to a specific call signature — the EE override
 * defines the precise contract when it substitutes this component.
 * `extendedEditorProps` reuses the existing `IEditorPropsExtended` type; see
 * its definition in `@/types` for member-level documentation.
 */
export type DocumentEditorSideEffectsProps = {
  editor: Editor;
  id: string;
  updatePageProperties?: unknown;
  extendedEditorProps?: IEditorPropsExtended;
};

/**
 * Renders nothing in the CE build; EE may override to wire document-level side effects.
 *
 * Consumers mount this component unconditionally so the EE override can be
 * swapped in without changing component trees in `core/components/editors/`.
 * The parameter is intentionally underscore-prefixed (`_props`) to signal it
 * is ignored in this implementation — the prefix is a TypeScript-recognized
 * convention for unused parameters and carries no semantic meaning beyond that.
 */
export const DocumentEditorSideEffects = (_props: DocumentEditorSideEffectsProps): ReactElement | null => null;
