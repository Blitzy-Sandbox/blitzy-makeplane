/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Plane custom list keymap extension — Tab / Shift-Tab / Backspace / Delete /
 * Mod-Backspace / Mod-Delete handling for nested bullet, ordered, and task lists.
 *
 * Replaces `@tiptap/extension-list-keymap` (Plane owns the implementation
 * rather than wrapping the upstream package). The keyboard UX for nested
 * lists is delicate: Backspace inside an empty nested item must outdent
 * rather than delete the item from the parent list; Tab must sink the
 * current item into its predecessor as a sub-list; Delete at the end of a
 * list item must merge with the next item respecting list depth. Owning
 * the implementation lets Plane bind these semantics directly to its task
 * list and nested-list rendering without inheriting upstream behavior
 * changes across `@tiptap/extension-list-keymap` releases.
 *
 * Delegates structural decisions to `./list-helpers` (`handleBackspace`,
 * `handleDelete`). The keyboard shortcut callbacks here orchestrate the
 * delegation per configured list type and provide defensive error
 * handling for the non-Mod variants.
 */

import { Extension } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// extensions
import { handleBackspace, handleDelete } from "@/extensions/custom-list-keymap/list-helpers";

/**
 * Configuration for {@link ListKeymap}.
 *
 * `listTypes` pairs each list item node name (`listItem`, `taskItem`) with
 * the container/wrapper node names that may legally hold it
 * (`bulletList` + `orderedList` for `listItem`; `taskList` for `taskItem`).
 * Defaults are provided by the extension's `addOptions()` so callers
 * typically rely on them; supply this option only to extend or replace
 * the supported list schema.
 */
export type ListKeymapOptions = {
  listTypes: Array<{
    itemName: string;
    wrapperNames: string[];
  }>;
};

/**
 * List keymap extension — keyboard shortcuts for nested list traversal.
 *
 * Factory returning a TipTap `Extension` named `"listKeymap"` that wires
 * keyboard handlers for `Tab`, `Shift-Tab`, `Backspace`, `Delete`,
 * `Mod-Backspace`, and `Mod-Delete` against `bulletList`, `orderedList`,
 * and `taskList` containers (and their respective `listItem` / `taskItem`
 * items).
 *
 * Exposes (preserved from `@tiptap/extension-list-keymap`):
 *   - `Tab`: `sinkListItem(listItem)` → `sinkListItem(taskItem)` — indent
 *     the current list item into a nested sub-list under its predecessor.
 *   - `Shift-Tab`: `liftListItem(listItem)` → `liftListItem(taskItem)` —
 *     outdent the current list item one level.
 *   - Default split-list-item-on-Enter behavior is preserved by NOT
 *     registering an Enter handler here; Enter is handled by StarterKit's
 *     `listItem` keymap (and by `enter-key.ts` for the lite-text variant).
 *
 * Overrides (replaces `@tiptap/extension-list-keymap` defaults via
 * `./list-helpers`):
 *   - `Backspace` at start of a list item — delegated to `handleBackspace`:
 *       nested item with sub-list + paragraph sibling → no-op (preserve
 *       complex structure);
 *       nested item with sub-list (no para sibling) → lift then
 *       `joinItemBackward()`;
 *       has prior list item → lift one level (outdent);
 *       outside a list with prior list block → cut current content and
 *       append to last list item.
 *   - `Delete` at end of a list item — delegated to `handleDelete`:
 *       next list deeper → focus into it then `lift(name).joinBackward()`;
 *       next list higher → `joinForward().joinBackward()`;
 *       otherwise → `joinItemForward()`.
 *   - `Mod-Backspace` / `Mod-Delete`: mirror the non-modifier handlers but
 *     WITHOUT try/catch. Non-modifier keys fire on every keystroke so a
 *     thrown helper exception must not kill the editor; modifier keys
 *     signal explicit user intent, so failures should surface upstream
 *     rather than being swallowed.
 *
 * Hides (relative to `@tiptap/extension-list-keymap`):
 *   - Any upstream `@tiptap/extension-list-keymap` behavior not enumerated
 *     above is unreachable because this extension replaces (does not
 *     wrap) the upstream package. Plane's `Mod-Backspace` / `Mod-Delete`
 *     handlers go through the same list-aware helpers as the non-modifier
 *     variants, rather than the upstream defaults.
 *
 * `tabIndex` parameter:
 *   When `undefined`/`null`, Tab inside a list item is ALWAYS consumed
 *   (returns `true`) — preventing focus from escaping the editor mid-list,
 *   which would be jarring. When set to any number, Tab / Shift-Tab
 *   OUTSIDE a list item return `false` so the browser's native focus
 *   traversal advances to the next focusable element with the configured
 *   `tabIndex`. Used by editors embedded in forms (e.g., the comment
 *   composer) so keyboard users can escape the editor for accessibility.
 *
 * WHY delegation to `./list-helpers`:
 *   Each keyboard handler iterates the configured `listTypes` and breaks
 *   on the first helper returning `true`. The shared helpers concentrate
 *   the structural logic (depth/sibling detection, lift/join/cut chains)
 *   so a future engineer cannot regress one handler's semantics without
 *   updating every list-key call site in lock-step. The
 *   `editor.state.schema.nodes[itemName] === undefined` guard skips list
 *   types whose schema nodes are not registered in the current editor
 *   (e.g., lite-text editors that disable `taskList`).
 *
 * MUST be composed AFTER the extensions that register the list schema
 * (StarterKit's `listItem`, `bulletList`, `orderedList` plus the task-list
 * extensions). Otherwise the schema-node guard would skip every list type
 * and the extension would no-op.
 */
export const ListKeymap = ({ tabIndex }: { tabIndex?: number }) =>
  Extension.create<ListKeymapOptions>({
    name: "listKeymap",

    addOptions() {
      return {
        listTypes: [
          {
            itemName: "listItem",
            wrapperNames: ["bulletList", "orderedList"],
          },
          {
            itemName: "taskItem",
            wrapperNames: ["taskList"],
          },
        ],
      };
    },

    addKeyboardShortcuts() {
      return {
        Tab: () => {
          if (this.editor.isActive(CORE_EXTENSIONS.LIST_ITEM) || this.editor.isActive(CORE_EXTENSIONS.TASK_ITEM)) {
            if (this.editor.commands.sinkListItem(CORE_EXTENSIONS.LIST_ITEM)) {
              return true;
            } else if (this.editor.commands.sinkListItem(CORE_EXTENSIONS.TASK_ITEM)) {
              return true;
            }
            return true;
          }
          // if tabIndex is set, we don't want to handle Tab key
          if (tabIndex !== undefined && tabIndex !== null) {
            return false;
          }
          return true;
        },
        "Shift-Tab": () => {
          if (this.editor.commands.liftListItem(CORE_EXTENSIONS.LIST_ITEM)) {
            return true;
          } else if (this.editor.commands.liftListItem(CORE_EXTENSIONS.TASK_ITEM)) {
            return true;
          }
          // if tabIndex is set, we don't want to handle Tab key
          if (tabIndex !== undefined && tabIndex !== null) {
            return false;
          }
          return true;
        },
        Delete: ({ editor }) => {
          try {
            let handled = false;

            this.options.listTypes.forEach(({ itemName }) => {
              if (editor.state.schema.nodes[itemName] === undefined) {
                return;
              }

              if (handleDelete(editor, itemName)) {
                handled = true;
              }
            });

            return handled;
          } catch (e) {
            console.log("Error in handling Delete:", e);
            return false;
          }
        },
        // Mod-Delete: word-level forward delete — modifier key signals explicit intent,
        // so we omit the try/catch wrapper that the non-modifier Delete uses.
        "Mod-Delete": ({ editor }) => {
          let handled = false;

          this.options.listTypes.forEach(({ itemName }) => {
            if (editor.state.schema.nodes[itemName] === undefined) {
              return;
            }

            if (handleDelete(editor, itemName)) {
              handled = true;
            }
          });

          return handled;
        },
        Backspace: ({ editor }) => {
          try {
            let handled = false;

            this.options.listTypes.forEach(({ itemName, wrapperNames }) => {
              if (editor.state.schema.nodes[itemName] === undefined) {
                return;
              }

              if (handleBackspace(editor, itemName, wrapperNames)) {
                handled = true;
              }
            });

            return handled;
          } catch (e) {
            console.log("Error in handling Backspace:", e);
            return false;
          }
        },
        // Mod-Backspace: word-level backward delete — modifier key signals explicit intent,
        // so we omit the try/catch wrapper that the non-modifier Backspace uses.
        "Mod-Backspace": ({ editor }) => {
          let handled = false;

          this.options.listTypes.forEach(({ itemName, wrapperNames }) => {
            if (editor.state.schema.nodes[itemName] === undefined) {
              return;
            }

            if (handleBackspace(editor, itemName, wrapperNames)) {
              handled = true;
            }
          });

          return handled;
        },
      };
    },
  });
