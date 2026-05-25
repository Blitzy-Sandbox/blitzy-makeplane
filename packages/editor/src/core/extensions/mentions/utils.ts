/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Mention suggestion render lifecycle — the glue between TipTap's `@tiptap/suggestion`
 * plugin and the React-based `MentionsListDropdown` UI.
 *
 * Exports the curried `renderMentionsDropdown` factory consumed by `extension.tsx` when
 * it `.configure({ suggestion: { render: renderMentionsDropdown(...) } })`s the runtime
 * mention extension. The factory shape (curried at call site, returning a `() => { ... }`
 * implementing `SuggestionOptions["render"]`) lets the caller bind `searchCallback` once
 * while still satisfying TipTap's hookable interface.
 *
 * Coordinates with sibling autocomplete extensions (`emoji`, `slash-commands`) via the
 * editor's active-dropbar gate (`addActiveDropbarExtension`/`removeActiveDropbarExtension`)
 * registered under `CORE_EXTENSIONS.MENTION`, so only one dropdown is open at a time.
 */

import { ReactRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import { updateFloatingUIFloaterPosition } from "@/helpers/floating-ui";
import type { CommandListInstance } from "@/helpers/tippy";
import { DROPDOWN_NAVIGATION_KEYS } from "@/helpers/tippy";
// types
import type { TMentionHandler } from "@/types";
// local components
import type { MentionsListDropdownProps } from "./mentions-list-dropdown";
import { MentionsListDropdown } from "./mentions-list-dropdown";

/**
 * Build a TipTap suggestion `render` implementation that mounts the React mention dropdown
 * and proxies keyboard + position lifecycle into it.
 *
 * Lifecycle hooks returned:
 *   - `onStart(props)`  — Triggered when the `@` character begins a mention query.
 *       Reads: `searchCallback` from closure, `props.editor`, `props.clientRect`.
 *       Writes: instantiates a `ReactRenderer<CommandListInstance, MentionsListDropdownProps>`
 *               wrapping `MentionsListDropdown`; calls
 *               `editor.commands.addActiveDropbarExtension(CORE_EXTENSIONS.MENTION)` to mark
 *               this dropdown as the active autocomplete; binds floating-UI positioning via
 *               `updateFloatingUIFloaterPosition`.
 *       Early-exits if `searchCallback` is undefined (consumer opted out of mentions UI).
 *   - `onUpdate(props)` — Triggered on every keystroke inside an active query.
 *       Reads: current `props` (query, clientRect).
 *       Writes: updates React props on the mounted renderer; re-runs floating-UI placement.
 *   - `onKeyDown({ event })` — Triggered on every keypress while the dropdown is open.
 *       Intercepts ArrowUp/ArrowDown/Enter (via `DROPDOWN_NAVIGATION_KEYS`) and Escape to
 *       prevent default editor handling. Escape closes the dropdown; other keys are
 *       forwarded to the mounted instance's imperative `onKeyDown` (see `MentionsListDropdown`).
 *   - `onExit({ editor })` — Triggered when the suggestion plugin exits (mention completed,
 *       trigger deleted, or selection moved away). Removes the floating element from the DOM
 *       and runs `handleClose` to destroy the renderer, clear the active-dropbar marker, and
 *       run the floating-UI cleanup.
 *
 * Persistence: NONE. This lifecycle does not write to any database or API; selection of a
 * mention item is handled by `MentionsListDropdown` via TipTap's `command()` callback,
 * which inserts the mention node into the editor document. Server-side persistence then
 * flows through the editor's normal save path.
 *
 * @param args - Pick of `TMentionHandler` containing the caller-injected `searchCallback`.
 *               This callback is NOT a static list — it ultimately calls Plane's workspace
 *               member search API to resolve query strings to mentionable entities.
 * @returns A `SuggestionOptions["render"]` factory ready to plug into TipTap's suggestion
 *          configuration.
 */
export const renderMentionsDropdown =
  (args: Pick<TMentionHandler, "searchCallback">): SuggestionOptions["render"] =>
  () => {
    const { searchCallback } = args;
    let component: ReactRenderer<CommandListInstance, MentionsListDropdownProps> | null = null;
    let cleanup: () => void = () => {};
    let editorRef: Editor | null = null;

    const handleClose = (editor?: Editor) => {
      component?.destroy();
      component = null;
      (editor || editorRef)?.commands.removeActiveDropbarExtension(CORE_EXTENSIONS.MENTION);
      cleanup();
    };

    return {
      onStart: (props) => {
        if (!searchCallback) return;
        editorRef = props.editor;
        component = new ReactRenderer<CommandListInstance, MentionsListDropdownProps>(MentionsListDropdown, {
          props: {
            ...props,
            searchCallback,
            onClose: () => handleClose(props.editor),
          } satisfies MentionsListDropdownProps,
          editor: props.editor,
          className: "fixed z-[100]",
        });
        if (!props.clientRect) return;
        props.editor.commands.addActiveDropbarExtension(CORE_EXTENSIONS.MENTION);
        const element = component.element as HTMLElement;
        cleanup = updateFloatingUIFloaterPosition(props.editor, element).cleanup;
      },
      onUpdate: (props) => {
        if (!component || !component.element) return;
        component.updateProps(props);
        if (!props.clientRect) return;
        cleanup();
        cleanup = updateFloatingUIFloaterPosition(props.editor, component.element as HTMLElement).cleanup;
      },
      onKeyDown: ({ event }) => {
        if ([...DROPDOWN_NAVIGATION_KEYS, "Escape"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
        }

        if (event.key === "Escape") {
          handleClose();
          return true;
        }

        return component?.ref?.onKeyDown({ event }) ?? false;
      },
      onExit: ({ editor }) => {
        component?.element.remove();
        handleClose(editor);
      },
    };
  };
