/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Slash-command extension wiring for the Plane editor.
 *
 * Composes the generic `@tiptap/suggestion` plugin with a Plane-specific
 * command catalog and a custom React popup (`SlashCommandsMenu`) to deliver
 * the `/`-triggered command palette. Registered under
 * `CORE_EXTENSIONS.SLASH_COMMANDS` (`"slash-command"`) so it can be enabled,
 * disabled, and discovered via the central core-extensions registry in
 * `@/constants/extension`.
 *
 * Trigger character: `/`. Opens a floating menu anchored to the cursor.
 *
 * Suggestion source: `getSlashCommandFilteredSections(props)` from
 * `./command-items-list`, parameterized by `disabledExtensions`,
 * `flaggedExtensions`, and caller-supplied `additionalOptions`. The list is
 * filtered case-insensitively on title / description / searchTerms each
 * keystroke via the `query` prop forwarded by `@tiptap/suggestion`.
 *
 * Command dispatch: on selection, `Suggestion.command({ editor, range, props })`
 * forwards to the chosen item's `command({ editor, range })` — these are the
 * canonical Plane editor commands declared in `@/helpers/editor-commands`
 * (heading toggles, list toggles, table/callout/emoji/image insertion, color
 * application, etc.). This indirection is the extensibility point that the
 * catalog file (`./command-items-list`) hangs every command from: each item
 * owns the mutation it triggers, rather than this extension hard-coding any.
 *
 * Exposes / Overrides / Hides (citing `@tiptap/suggestion`):
 *   - Exposes: the suggestion lifecycle (open on trigger character, filter on
 *     typing via the `query` prop, close on Escape/blur) and the `onStart`,
 *     `onUpdate`, `onKeyDown`, `onExit` hooks plus the `command` callback
 *     invoked when an item is chosen.
 *   - Overrides: the command list (Plane-specific items — Heading 1–6,
 *     Bulleted / Numbered / To-do list, Table, Quote, Code, Callout, Divider,
 *     Emoji, Text-color / Background-color palette, Image, Work-item embed,
 *     etc.); the `allow()` guard which blocks the menu inside
 *     `CORE_EXTENSIONS.CODE_BLOCK`; the `command` handler which receives
 *     `{ editor, range, props }` and delegates to the selected item.
 *   - Hides: any upstream default UI from `@tiptap/suggestion` — the dropdown
 *     is custom-rendered via
 *     `ReactRenderer<CommandListInstance, SlashCommandsMenuProps>` wrapping
 *     `SlashCommandsMenu`, positioned by `updateFloatingUIFloaterPosition`
 *     from `@/helpers/floating-ui`, with backdrop and outside-click owned by
 *     the menu component itself.
 *
 * Coordination: while the menu is open, the extension calls
 * `editor.commands.addActiveDropbarExtension(CORE_EXTENSIONS.SLASH_COMMANDS)`
 * and removes itself on close so other floating UI (side menu, bubble menu)
 * does not co-open. Active-dropbar is a Plane-specific coordination
 * mechanism, not a TipTap concept.
 *
 * Pattern: this is one of three folders following the `@tiptap/suggestion`
 * substrate (alongside `@/extensions/emoji` and `@/extensions/mentions`); the
 * lifecycle hooks are shared, only the trigger character and command catalog
 * differ.
 */
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionOptions } from "@tiptap/suggestion";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import { updateFloatingUIFloaterPosition } from "@/helpers/floating-ui";
import type { CommandListInstance } from "@/helpers/tippy";
import { DROPDOWN_NAVIGATION_KEYS } from "@/helpers/tippy";
// types
import type { IEditorProps, ISlashCommandItem, TEditorCommands, TSlashCommandSectionKeys } from "@/types";
// components
import { getSlashCommandFilteredSections } from "./command-items-list";
import type { SlashCommandsMenuProps } from "./command-menu";
import { SlashCommandsMenu } from "./command-menu";

/**
 * Option shape consumed by `Extension.create<SlashCommandOptions>` below.
 *
 * Exposes a single `suggestion` field — the `@tiptap/suggestion` option object
 * minus the `editor` field (the editor is injected at extension-init time by
 * the `addProseMirrorPlugins()` hook). This is the only customizable surface;
 * defaults (trigger char `/`, code-block guard, command dispatcher) are filled
 * in by `addOptions()` and any override is merged via the trailing
 * `...this.options.suggestion` spread.
 *
 * Callers typically do not construct this directly — they call the
 * `SlashCommands(...)` factory which assigns `suggestion.items`.
 */
export type SlashCommandOptions = {
  suggestion: Omit<SuggestionOptions, "editor">;
};

/**
 * Caller-supplied item shape for injecting additional commands into the slash
 * menu without modifying the core catalog in `./command-items-list`.
 *
 * Extends `ISlashCommandItem` with two anchor fields:
 *   - `section`: which section of the menu the item belongs to — one of
 *     `"general"`, `"text-colors"`, or `"background-colors"` (`TSlashCommandSectionKeys`).
 *   - `pushAfter`: the existing `TEditorCommands` key after which the new
 *     item is inserted; if `pushAfter` is not found in the target section,
 *     the item is appended at the end.
 *
 * Used by `@/plane-editor/extensions` (the editor-edition layer) to register
 * edition-specific items (e.g. work-item embed) so that the core editor
 * package does not need to know about them.
 */
export type TSlashCommandAdditionalOption = ISlashCommandItem & {
  section: TSlashCommandSectionKeys;
  pushAfter: TEditorCommands;
};

/**
 * The TipTap extension instance, registered under
 * `CORE_EXTENSIONS.SLASH_COMMANDS` (`"slash-command"`).
 *
 * `addOptions()` supplies the default `suggestion` config:
 *   - `char: "/"` — the trigger character that opens the menu.
 *   - `command({ editor, range, props })` — dispatches
 *     `props.command({ editor, range })` so each catalog item owns its own
 *     editor mutation rather than the extension hard-coding mutations.
 *   - `allow({ editor })` — returns `false` when the cursor is inside a
 *     `CORE_EXTENSIONS.CODE_BLOCK` so the menu does not open mid-code. This
 *     is a deliberate UX choice: typing `/` inside a code block should
 *     produce a literal `/`, not a command menu.
 *
 * `addProseMirrorPlugins()` returns a single `Suggestion(...)` plugin whose
 * `render()` factory builds the React popup via `ReactRenderer`, positions
 * it via `updateFloatingUIFloaterPosition`, registers the active dropbar via
 * `addActiveDropbarExtension`, forwards arrow / Enter / Escape via
 * `onKeyDown`, and tears down on `onExit`.
 *
 * The trailing `...this.options.suggestion` spread lets callers (via
 * `SlashCommands(...)`) override or extend the default suggestion config —
 * specifically, the `items` getter that supplies the filtered sections —
 * without touching this declaration.
 */
const Command = Extension.create<SlashCommandOptions>({
  name: CORE_EXTENSIONS.SLASH_COMMANDS,
  addOptions() {
    return {
      suggestion: {
        char: "/",
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        allow({ editor }: { editor: Editor }) {
          const { selection } = editor.state;
          const parentNode = selection.$from.node(selection.$from.depth);
          const blockType = parentNode.type.name;

          if (blockType === CORE_EXTENSIONS.CODE_BLOCK) {
            return false;
          }

          return true;
        },
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        render: () => {
          let component: ReactRenderer<CommandListInstance, SlashCommandsMenuProps> | null = null;
          let cleanup: () => void = () => {};
          let editorRef: Editor | null = null;

          const handleClose = (editor?: Editor) => {
            component?.destroy();
            component = null;
            (editor || editorRef)?.commands.removeActiveDropbarExtension(CORE_EXTENSIONS.SLASH_COMMANDS);
            cleanup();
          };

          return {
            onStart: (props) => {
              editorRef = props.editor;
              // React renderer component, which wraps the actual dropdown component
              component = new ReactRenderer<CommandListInstance, SlashCommandsMenuProps>(SlashCommandsMenu, {
                props: {
                  ...props,
                  onClose: () => handleClose(props.editor),
                } satisfies SlashCommandsMenuProps,
                editor: props.editor,
                className: "fixed z-[100]",
              });
              if (!props.clientRect) return;
              props.editor.commands.addActiveDropbarExtension(CORE_EXTENSIONS.SLASH_COMMANDS);
              const element = component.element as HTMLElement;
              cleanup = updateFloatingUIFloaterPosition(props.editor, element).cleanup;
            },

            onUpdate: (props) => {
              if (!component || !component.element) return;
              component.updateProps(props);
              if (!props.clientRect) return;
              const element = component.element as HTMLElement;
              cleanup();
              cleanup = updateFloatingUIFloaterPosition(props.editor, element).cleanup;
            },

            onKeyDown: ({ event }) => {
              if ([...DROPDOWN_NAVIGATION_KEYS, "Escape"].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
              }

              if (event.key === "Escape") {
                handleClose(this.editor);
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
        ...this.options.suggestion,
      }),
    ];
  },
});

/**
 * Props consumed by the {@link SlashCommands} factory function.
 *
 * Picks `disabledExtensions` and `flaggedExtensions` from the editor's
 * top-level `IEditorProps`: these flags gate which items appear in the menu
 * (e.g. if `image` is disabled, the Image command is omitted from the
 * catalog; if an extension is behind a feature flag, it is filtered out
 * unless `flaggedExtensions` includes it).
 *
 * Adds `additionalOptions?: TSlashCommandAdditionalOption[]` so external
 * callers can inject extra commands at well-defined anchor points without
 * modifying the core catalog.
 */
export type TExtensionProps = Pick<IEditorProps, "disabledExtensions" | "flaggedExtensions"> & {
  additionalOptions?: TSlashCommandAdditionalOption[];
};

/**
 * Public factory for the slash-commands extension.
 *
 * Callers (e.g. `ce/extensions/document-extensions.tsx`,
 * `ce/extensions/rich-text-extensions.tsx`) invoke
 * `SlashCommands({ disabledExtensions, flaggedExtensions, additionalOptions })`
 * and pass the result into the editor's extensions array.
 *
 * Internally calls `Command.configure({ suggestion: { items: ... } })` so the
 * item-list getter is closed over the props once at factory time, then
 * re-invoked per keystroke with the current `query` to produce the filtered
 * sections. The filtering itself lives in `getSlashCommandFilteredSections`.
 *
 * Returns a fully configured TipTap `Extension` instance ready for use in
 * the editor's extension list.
 */
export function SlashCommands(props: TExtensionProps) {
  return Command.configure({
    suggestion: {
      items: getSlashCommandFilteredSections(props),
    },
  });
}
