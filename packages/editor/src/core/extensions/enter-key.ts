/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Enter / Shift-Enter shortcut orchestration for the lite-text editor.
 *
 * Exports {@link EnterKeyExtension}, a factory that builds a TipTap
 * extension overriding the default `Enter` and `Shift-Enter` keyboard
 * shortcuts. The lite-text editor stack in
 * `core/components/editors/lite-text/editor.tsx` conditionally pushes
 * this extension when an `onEnterKeyPress` callback is supplied
 * (e.g. chat composer / inline comment editor where Enter submits the
 * message, and Shift-Enter inserts a newline through a fallback chain
 * of TipTap commands that respects the active block type).
 */

import { Extension } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

/**
 * Builds an Enter / Shift-Enter shortcut extension for the lite-text editor.
 *
 * Enter:
 *   - Falls through (returns `false`) when any dropbar extension is active
 *     so the dropbar (mention / emoji / slash-command / table / side-menu /
 *     bubble-menu) handles Enter itself (e.g. select the highlighted item
 *     in a mention dropdown rather than submitting a half-typed message).
 *   - Otherwise invokes `onEnterKeyPress?.()` and returns `true`, which
 *     suppresses the editor's default Enter behavior so the Plane chat /
 *     inline-comment editors can submit on Enter.
 *
 * Shift-Enter:
 *   Falls through `editor.commands.first(...)` with the priority chain
 *     `newlineInCode` → `splitListItem(LIST_ITEM)` →
 *     `splitListItem(TASK_ITEM)` → `createParagraphNear` →
 *     `liftEmptyBlock` → `splitBlock`
 *   so the line break is applied with structurally correct block
 *   creation for the active context (literal newline inside a code
 *   block, a new list item inside a list, a new paragraph elsewhere)
 *   rather than breaking the document structure.
 *
 * Storage dependency:
 *   Reads `editor.storage.utility.activeDropbarExtensions`, the
 *   cross-extension registry provisioned by `UtilityExtension` (sibling
 *   `utility.ts`). The extension must therefore be composed AFTER
 *   `UtilityExtension` in the editor's extension array — otherwise the
 *   destructure on every Enter press would throw.
 *
 * @param onEnterKeyPress - Optional callback invoked when the user
 *   presses Enter and NO dropbar extension is currently active. Used by
 *   lite-text consumers (chat composer, inline comment editor) to
 *   submit on Enter. When omitted, Enter is a no-op while the document
 *   default Enter handling remains suppressed (return value `true`).
 * @returns A TipTap `Extension` instance named after
 *   `CORE_EXTENSIONS.ENTER_KEY`.
 */
export const EnterKeyExtension = (onEnterKeyPress?: () => void) =>
  Extension.create({
    name: CORE_EXTENSIONS.ENTER_KEY,

    addKeyboardShortcuts(this) {
      return {
        Enter: () => {
          const { activeDropbarExtensions } = this.editor.storage.utility;

          if (activeDropbarExtensions.length === 0) {
            onEnterKeyPress?.();
            return true;
          }

          return false;
        },
        "Shift-Enter": ({ editor }) =>
          editor.commands.first(({ commands }) => [
            () => commands.newlineInCode(),
            () => commands.splitListItem(CORE_EXTENSIONS.LIST_ITEM),
            () => commands.splitListItem(CORE_EXTENSIONS.TASK_ITEM),
            () => commands.createParagraphNear(),
            () => commands.liftEmptyBlock(),
            () => commands.splitBlock(),
          ]),
      };
    },
  });
