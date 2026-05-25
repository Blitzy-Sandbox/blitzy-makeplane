/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Tiptap suggestion configuration for the emoji autocomplete popup.
 *
 * Bound to the emoji node's `addOptions().suggestion` in `./emoji.ts`; the
 * trigger character `:` is declared there (`addOptions().suggestion.char`), not
 * here. This module supplies the dataset lookup (`items`), the space-disallow
 * flag (`allowSpaces`), and the React popup lifecycle
 * (`render` → `onStart` / `onUpdate` / `onKeyDown` / `onExit`) wired to
 * {@link EmojisListDropdown} via Tiptap's {@link ReactRenderer}, with
 * floating-UI positioning managed by {@link updateFloatingUIFloaterPosition}.
 * Mirrors the `mentions/` and `slash-commands/` extension folders for pattern
 * consistency (same `ReactRenderer` + floating-UI + `useImperativeHandle`
 * approach).
 */

import type { EmojiOptions, EmojiStorage } from "@tiptap/extension-emoji";
import { ReactRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import { updateFloatingUIFloaterPosition } from "@/helpers/floating-ui";
import type { CommandListInstance } from "@/helpers/tippy";
import { DROPDOWN_NAVIGATION_KEYS } from "@/helpers/tippy";
// local imports
import { EmojisListDropdown } from "./components/emojis-list";
import type { EmojisListDropdownProps, EmojiItem } from "./components/emojis-list";
import type { ExtendedEmojiStorage } from "./emoji";

/**
 * Shortcodes displayed when the user types `:` with no follow-up query (the
 * "empty query" state). Resolved against the editor's configured emoji dataset
 * at lookup time; missing entries are silently dropped and the result is
 * capped at 5.
 */
const DEFAULT_EMOJIS = ["+1", "-1", "smile", "orange_heart", "eyes"];

/**
 * Concrete `EmojiOptions["suggestion"]` consumed by the emoji node's
 * `addOptions().suggestion` in `./emoji.ts` (the `:` trigger character is
 * declared upstream there, not here).
 *
 * `items({ editor, query })`:
 *   - Empty query: resolves {@link DEFAULT_EMOJIS} against
 *     `editor.storage.emoji.emojis` (capped at 5; missing entries dropped).
 *   - Non-empty query: case-insensitive prefix match across each emoji's
 *     `shortcodes` OR `tags` arrays, capped at 5. Returns `EmojiItem[]`
 *     consumed by the React dropdown.
 *
 * `allowSpaces: false` — closes the suggestion the instant the user types a
 * space after `:` (emoji shortcodes never contain spaces).
 *
 * `render()` returns the Tiptap lifecycle handlers and closes over three
 * pieces of local state for the popup's lifetime: the `ReactRenderer`
 * instance (`component`), the floating-UI teardown function (`cleanup`)
 * returned by {@link updateFloatingUIFloaterPosition}, and an `editorRef`
 * retained so the internal `handleClose` helper can still reach the editor
 * on paths where the caller does not pass one (e.g. the `Escape` key path).
 *
 * `handleClose(editor?)` is an internal helper invoked by `onExit` and the
 * `Escape` key path: it destroys the React renderer, deregisters
 * {@link CORE_EXTENSIONS.EMOJI} from the editor's active dropbar set, clears
 * {@link ExtendedEmojiStorage}.`forceOpen`, and tears down floating-UI
 * position tracking.
 *
 * Lifecycle hooks:
 *   - `onStart`: mounts {@link EmojisListDropdown} via {@link ReactRenderer},
 *     reads `forceOpen` from {@link ExtendedEmojiStorage} (the flag external
 *     callers such as a toolbar button use to open the picker without a
 *     query), registers {@link CORE_EXTENSIONS.EMOJI} as the active dropbar
 *     extension, and starts floating-UI position tracking. No-ops when
 *     `props.clientRect` is absent.
 *   - `onUpdate`: re-reads `forceOpen`, forwards updated props (including the
 *     new query) to the dropdown, then cleans up the previous floating-UI
 *     subscription and re-anchors a new one.
 *   - `onKeyDown`: swallows {@link DROPDOWN_NAVIGATION_KEYS} + `Escape` so
 *     they don't reach the editor; `Escape` invokes `handleClose` and
 *     returns `true`; the remaining navigation keys are forwarded to the
 *     imperative `onKeyDown` exposed by {@link EmojisListDropdown} via
 *     `useImperativeHandle`.
 *   - `onExit`: removes the rendered element from the DOM and runs
 *     `handleClose(editor)` to deregister the dropbar and clear `forceOpen`.
 */
export const emojiSuggestion: EmojiOptions["suggestion"] = {
  items: ({ editor, query }: { editor: Editor; query: string }): EmojiItem[] => {
    const { emojis } = editor.storage.emoji as EmojiStorage;

    if (query.trim() === "") {
      const defaultEmojis = DEFAULT_EMOJIS.map((name) =>
        emojis.find((emoji) => emoji.shortcodes.includes(name) || emoji.name === name)
      )
        .filter(Boolean)
        .slice(0, 5);
      return defaultEmojis as EmojiItem[];
    }
    return emojis
      .filter(({ shortcodes, tags }) => {
        const lowerQuery = query.toLowerCase();
        return (
          shortcodes.find((shortcode: string) => shortcode.startsWith(lowerQuery)) ||
          tags.find((tag: string) => tag.startsWith(lowerQuery))
        );
      })
      .slice(0, 5) as EmojiItem[];
  },

  allowSpaces: false,

  render: () => {
    let component: ReactRenderer<CommandListInstance, EmojisListDropdownProps> | null = null;
    let cleanup: () => void = () => {};
    let editorRef: Editor | null = null;

    const handleClose = (editor?: Editor) => {
      component?.destroy();
      component = null;
      (editor || editorRef)?.commands.removeActiveDropbarExtension(CORE_EXTENSIONS.EMOJI);
      const emojiStorage = editor?.storage.emoji as ExtendedEmojiStorage;
      emojiStorage.forceOpen = false;
      cleanup();
    };

    return {
      onStart: (props) => {
        editorRef = props.editor;
        const emojiStorage = props.editor.storage.emoji as ExtendedEmojiStorage;
        const forceOpen = emojiStorage.forceOpen || false;
        component = new ReactRenderer<CommandListInstance, EmojisListDropdownProps>(EmojisListDropdown, {
          props: {
            ...props,
            onClose: () => handleClose(props.editor),
            forceOpen,
          } satisfies EmojisListDropdownProps,
          editor: props.editor,
          className: "fixed z-[100]",
        });
        if (!props.clientRect) return;
        props.editor.commands.addActiveDropbarExtension(CORE_EXTENSIONS.EMOJI);
        const element = component.element as HTMLElement;
        cleanup = updateFloatingUIFloaterPosition(props.editor, element).cleanup;
      },

      onUpdate: (props) => {
        if (!component || !component.element) return;
        const emojiStorage = props.editor.storage.emoji as ExtendedEmojiStorage;
        const forceOpen = emojiStorage.forceOpen || false;
        component.updateProps({ ...props, forceOpen });
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
  },
};
