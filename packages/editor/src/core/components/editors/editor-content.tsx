/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Focus-managing wrapper around TipTap's `<EditorContent />`.
 *
 * Forwards outer-div focus into the editor without forcing viewport scroll —
 * a deliberate accessibility choice so that Tab-key focusing does not steal
 * the user's scroll position.
 */

import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";

type Props = {
  className?: string;
  children?: ReactNode;
  editor: Editor | null;
  id: string;
  tabIndex?: number;
};

/**
 * Renders a focusable outer `<div>` whose `onFocus` handler forwards focus
 * into the editor via `editor.chain().focus(undefined, { scrollIntoView: false }).run()`.
 *
 * Props are typed by the local `Props` alias — see its declaration.
 *
 * Side effects are confined to the `onFocus` handler — no other DOM
 * mutation, no API calls, no state mutation.
 *
 * TipTap surface:
 * - Exposes `editor.chain().focus()` via the outer-div focus handler so
 *   Tab-key navigation can land focus on the editable surface.
 * - Overrides TipTap's default focus-scroll behavior by explicitly passing
 *   `scrollIntoView: false`; this is a deliberate accessibility decision —
 *   focusing the editor must not steal the viewport.
 * - Hides no TipTap behavior; mounts the native `<EditorContent />` as-is.
 *
 * Consumed by `EditorWrapper` as the inner content host inside `EditorContainer`.
 */
export function EditorContentWrapper(props: Props) {
  const { editor, className, children, tabIndex, id } = props;

  return (
    <div
      tabIndex={tabIndex}
      onFocus={() => editor?.chain().focus(undefined, { scrollIntoView: false }).run()}
      className={className}
    >
      <EditorContent editor={editor} id={id} />
      {children}
    </div>
  );
}
