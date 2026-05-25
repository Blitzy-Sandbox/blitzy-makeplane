/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Slash-command catalog and filter factory for the editor.
 *
 * Defines every item available in the `/` menu and the case-insensitive filter
 * applied per keystroke. The catalog is a USER-FACING PRODUCT SURFACE: every
 * entry here is something a user can do via the slash menu, so additions or
 * removals directly change the editor's perceived capability.
 *
 * Sections (in render order, matching `TSlashCommandSectionKeys`):
 *   1. "general"            — block-level commands (text, headings 1–6,
 *                             numbered list, bulleted list, to-do list,
 *                             table, quote, code, callout, divider, emoji,
 *                             and image when not in `disabledExtensions`).
 *   2. "text-colors"        — typography color palette: a "Default" reset
 *                             item plus one item per entry of `COLORS_LIST`.
 *   3. "background-colors"  — highlight palette: a "Default background"
 *                             reset item plus one item per `COLORS_LIST`.
 *
 * Dense color-palette generators are documented at the group level (per the
 * AAP allowance "Group-level comments are acceptable for closely related
 * constant sets") rather than per individual color, because each generated
 * `ISlashCommandItem` already self-documents via its own `title` /
 * `description` / `searchTerms` fields.
 *
 * Extensibility: callers may supply `additionalOptions` on `TExtensionProps`
 * and the factory also merges in `coreEditorAdditionalSlashCommandOptions`
 * from `@/plane-editor/extensions` (e.g. work-item embed). Each extra entry
 * declares its target `section` plus a `pushAfter` anchor (an existing
 * `commandKey`); this anchor is the stable extensibility seam so external
 * code does not have to depend on numeric indices that core may reshuffle.
 *
 * Filtering: case-insensitive substring match against `title`, `description`,
 * and every `searchTerms` entry; sections that end up empty are dropped so
 * the menu never renders an orphan heading.
 *
 * Consumers / cross-references:
 *   - `./root`                       — slash-commands extension that hands
 *                                      the returned getter to `@tiptap/suggestion`
 *   - `./command-menu`               — `SlashCommandsMenu` UI that renders
 *                                      the returned sections
 *   - `@/helpers/editor-commands`    — command implementations dispatched on
 *                                      item selection
 *   - `@/constants/common`           — `COLORS_LIST` palette definition
 *   - `@/plane-editor/extensions`    — edition-specific extra options
 */

import {
  ALargeSmall,
  CaseSensitive,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ImageIcon,
  List,
  ListOrdered,
  ListTodo,
  MessageSquareText,
  MinusSquare,
  Smile,
  Table,
  TextQuote,
} from "lucide-react";
// constants
import { COLORS_LIST } from "@/constants/common";
// helpers
import {
  insertTableCommand,
  toggleBlockquote,
  toggleBulletList,
  toggleOrderedList,
  toggleTaskList,
  toggleHeading,
  toggleTextColor,
  toggleBackgroundColor,
  insertImage,
  insertCallout,
  setText,
  openEmojiPicker,
} from "@/helpers/editor-commands";
// plane editor extensions
import { coreEditorAdditionalSlashCommandOptions } from "@/plane-editor/extensions";
// types
import type { CommandProps, ISlashCommandItem, TSlashCommandSectionKeys } from "@/types";
// local types
import type { TExtensionProps, TSlashCommandAdditionalOption } from "./root";

/**
 * One section of the slash menu — a logical grouping of related commands.
 *
 * Returned (as an array) by `getSlashCommandFilteredSections` and consumed by
 * `SlashCommandsMenu` to render the dropdown.
 *
 * @property key    Section identifier — one of `TSlashCommandSectionKeys`
 *                  (`"general" | "text-colors" | "background-colors"`).
 * @property title  Optional human-readable heading shown above the section's
 *                  items. Intentionally omitted for the General section so it
 *                  renders at the top without a heading.
 * @property items  Ordered list of slash-menu items belonging to the section.
 */
export type TSlashCommandSection = {
  key: TSlashCommandSectionKeys;
  title?: string;
  items: ISlashCommandItem[];
};

/**
 * Curried factory that produces the per-keystroke item getter handed to
 * `@tiptap/suggestion`'s `items` option by the slash-commands extension.
 *
 * The outer call captures `args` once at extension-init time; the returned
 * inner function is invoked by `@tiptap/suggestion` on every keystroke that
 * follows a `/` trigger and returns the filtered, ordered sections.
 *
 * Behavior:
 *   - Builds a fresh `SLASH_COMMAND_SECTIONS` array on each call — no
 *     mutation of `args` and no shared mutable state across calls.
 *   - Conditionally appends the Image command into the General section
 *     (anchored after the Code item via `pushAfter: "code"`) unless the
 *     caller listed `"image"` in `disabledExtensions`. All other extension
 *     gating is delegated to `coreEditorAdditionalSlashCommandOptions` in
 *     `@/plane-editor/extensions`, not handled here.
 *   - Merges three streams of additional options — internal (the Image
 *     gate above), external caller-supplied (`args.additionalOptions`), and
 *     edition-specific (`coreEditorAdditionalSlashCommandOptions(...)`) —
 *     positioning each entry into its declared `section` immediately after
 *     the item whose `commandKey` matches `pushAfter`. When the anchor is
 *     not present in the target section, the item is appended at the end.
 *   - Applies a case-insensitive substring filter against `item.title`,
 *     `item.description`, and each `item.searchTerms` entry. Sections that
 *     become empty are dropped so the menu does not render bare headings.
 *
 * @param args  Currently-disabled extensions, currently-flagged extensions,
 *              and any caller-supplied `additionalOptions` to splice in.
 * @returns     A `({ query }) => TSlashCommandSection[]` getter compatible
 *              with `@tiptap/suggestion`'s `items` option.
 */
export const getSlashCommandFilteredSections =
  (args: TExtensionProps) =>
  ({ query }: { query: string }): TSlashCommandSection[] => {
    const { additionalOptions: externalAdditionalOptions, disabledExtensions, flaggedExtensions } = args;
    const SLASH_COMMAND_SECTIONS: TSlashCommandSection[] = [
      // General section — block-level commands in declared order: Text,
      // Heading 1–6, Numbered list, Bulleted list, To-do list, Table, Quote,
      // Code, Callout, Divider, Emoji. The Image command is appended below
      // (anchored after Code via `pushAfter: "code"`) unless `"image"` is in
      // `disabledExtensions`.
      {
        key: "general",
        items: [
          {
            commandKey: "text",
            key: "text",
            title: "Text",
            description: "Just start typing with plain text.",
            searchTerms: ["p", "paragraph"],
            icon: <CaseSensitive className="size-3.5" />,
            command: ({ editor, range }) => setText(editor, range),
          },
          {
            commandKey: "h1",
            key: "h1",
            title: "Heading 1",
            description: "Big section heading.",
            searchTerms: ["title", "big", "large"],
            icon: <Heading1 className="size-3.5" />,
            command: ({ editor, range }) => toggleHeading(editor, 1, range),
          },
          {
            commandKey: "h2",
            key: "h2",
            title: "Heading 2",
            description: "Medium section heading.",
            searchTerms: ["subtitle", "medium"],
            icon: <Heading2 className="size-3.5" />,
            command: ({ editor, range }) => toggleHeading(editor, 2, range),
          },
          {
            commandKey: "h3",
            key: "h3",
            title: "Heading 3",
            description: "Small section heading.",
            searchTerms: ["subtitle", "small"],
            icon: <Heading3 className="size-3.5" />,
            command: ({ editor, range }) => toggleHeading(editor, 3, range),
          },
          {
            commandKey: "h4",
            key: "h4",
            title: "Heading 4",
            description: "Small section heading.",
            searchTerms: ["subtitle", "small"],
            icon: <Heading4 className="size-3.5" />,
            command: ({ editor, range }) => toggleHeading(editor, 4, range),
          },
          {
            commandKey: "h5",
            key: "h5",
            title: "Heading 5",
            description: "Small section heading.",
            searchTerms: ["subtitle", "small"],
            icon: <Heading5 className="size-3.5" />,
            command: ({ editor, range }) => toggleHeading(editor, 5, range),
          },
          {
            commandKey: "h6",
            key: "h6",
            title: "Heading 6",
            description: "Small section heading.",
            searchTerms: ["subtitle", "small"],
            icon: <Heading6 className="size-3.5" />,
            command: ({ editor, range }) => toggleHeading(editor, 6, range),
          },

          {
            commandKey: "numbered-list",
            key: "numbered-list",
            title: "Numbered list",
            description: "Create a numbered list.",
            searchTerms: ["ordered"],
            icon: <ListOrdered className="size-3.5" />,
            command: ({ editor, range }) => toggleOrderedList(editor, range),
          },
          {
            commandKey: "bulleted-list",
            key: "bulleted-list",
            title: "Bulleted list",
            description: "Create a bulleted list.",
            searchTerms: ["unordered", "point"],
            icon: <List className="size-3.5" />,
            command: ({ editor, range }) => toggleBulletList(editor, range),
          },
          {
            commandKey: "to-do-list",
            key: "to-do-list",
            title: "To-do list",
            description: "Create a to-do list.",
            searchTerms: ["todo", "task", "list", "check", "checkbox"],
            icon: <ListTodo className="size-3.5" />,
            command: ({ editor, range }) => toggleTaskList(editor, range),
          },
          {
            commandKey: "table",
            key: "table",
            title: "Table",
            description: "Create a table",
            searchTerms: ["table", "cell", "db", "data", "tabular"],
            icon: <Table className="size-3.5" />,
            command: ({ editor, range }) => insertTableCommand(editor, range),
          },
          {
            commandKey: "quote",
            key: "quote",
            title: "Quote",
            description: "Capture a quote.",
            searchTerms: ["blockquote"],
            icon: <TextQuote className="size-3.5" />,
            command: ({ editor, range }) => toggleBlockquote(editor, range),
          },
          {
            commandKey: "code",
            key: "code",
            title: "Code",
            description: "Capture a code snippet.",
            searchTerms: ["codeblock"],
            icon: <Code2 className="size-3.5" />,
            command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
          },
          {
            commandKey: "callout",
            key: "callout",
            title: "Callout",
            icon: <MessageSquareText className="size-3.5" />,
            description: "Insert callout",
            searchTerms: ["callout", "comment", "message", "info", "alert"],
            command: ({ editor, range }: CommandProps) => insertCallout(editor, range),
          },
          {
            commandKey: "divider",
            key: "divider",
            title: "Divider",
            description: "Visually divide blocks.",
            searchTerms: ["line", "divider", "horizontal", "rule", "separate"],
            icon: <MinusSquare className="size-3.5" />,
            command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
          },
          {
            commandKey: "emoji",
            key: "emoji",
            title: "Emoji",
            description: "Insert an emoji",
            searchTerms: ["emoji", "icons", "reaction", "emoticon", "emotags"],
            icon: <Smile className="size-3.5" />,
            command: ({ editor, range }) => {
              openEmojiPicker(editor, range);
            },
          },
        ],
      },
      // Text colors section — generates one item per entry of `COLORS_LIST`
      // (from `@/constants/common`); each dispatches
      // `toggleTextColor(color.key, editor, range)`. The leading "Default"
      // item passes `undefined` to clear any active text-color mark.
      {
        key: "text-colors",
        title: "Colors",
        items: [
          {
            commandKey: "text-color",
            key: "text-color-default",
            title: "Default",
            description: "Change text color",
            searchTerms: ["color", "text", "default"],
            icon: <ALargeSmall className="size-3.5 text-primary" />,
            command: ({ editor, range }) => toggleTextColor(undefined, editor, range),
          },
          ...COLORS_LIST.map(
            (color) =>
              ({
                commandKey: "text-color",
                key: `text-color-${color.key}`,
                title: color.label,
                description: "Change text color",
                searchTerms: ["color", "text", color.label],

                icon: (
                  <ALargeSmall
                    className="size-3.5"
                    style={{
                      color: color.textColor,
                    }}
                  />
                ),

                command: ({ editor, range }) => toggleTextColor(color.key, editor, range),
              }) as ISlashCommandItem
          ),
        ],
      },
      // Background colors section — generates one item per entry of
      // `COLORS_LIST` for highlight backgrounds; each dispatches
      // `toggleBackgroundColor(color.key, editor, range)`. The leading
      // "Default background" item is intended to clear any active
      // background-color mark (see INTENT UNCLEAR flag on its command below).
      {
        key: "background-colors",
        title: "Background colors",
        items: [
          {
            commandKey: "background-color",
            key: "background-color-default",
            title: "Default background",
            description: "Change background color",
            searchTerms: ["color", "bg", "background", "default"],
            icon: <ALargeSmall className="size-3.5" />,
            iconContainerStyle: {
              borderRadius: "4px",
              backgroundColor: "var(--background-color-surface-1)",
              border: "1px solid var(--border-color-strong)",
            },
            // INTENT UNCLEAR: "Default background" dispatches toggleTextColor
            // (not toggleBackgroundColor) — preserved verbatim per system boundary.
            command: ({ editor, range }) => toggleTextColor(undefined, editor, range),
          },
          ...COLORS_LIST.map(
            (color) =>
              ({
                commandKey: "background-color",
                key: `background-color-${color.key}`,
                title: color.label,
                description: "Change background color",
                searchTerms: ["color", "bg", "background", color.label],
                icon: <ALargeSmall className="size-3.5" />,

                iconContainerStyle: {
                  borderRadius: "4px",
                  backgroundColor: color.backgroundColor,
                },

                command: ({ editor, range }) => toggleBackgroundColor(color.key, editor, range),
              }) as ISlashCommandItem
          ),
        ],
      },
    ];

    const internalAdditionalOptions: TSlashCommandAdditionalOption[] = [];
    // Append the Image command into the General section right after Code
    // (via `pushAfter: "code"`) unless the caller listed `"image"` in
    // `disabledExtensions`. Other extension-gated commands (e.g. work-item
    // embed) are gated inside `coreEditorAdditionalSlashCommandOptions`,
    // not here.
    if (!disabledExtensions?.includes("image")) {
      internalAdditionalOptions.push({
        commandKey: "image",
        key: "image",
        title: "Image",
        icon: <ImageIcon className="size-3.5" />,
        description: "Insert an image",
        searchTerms: ["img", "photo", "picture", "media", "upload"],
        command: ({ editor, range }: CommandProps) => insertImage({ editor, event: "insert", range }),
        section: "general",
        pushAfter: "code",
      });
    }

    // Merge three additional-options streams (internal, external caller-supplied,
    // and plane-editor edition) and splice each entry into its declared `section`
    // immediately after the item whose `commandKey` matches `pushAfter`; if the
    // anchor is not found, the item is appended at the section's end.
    [
      ...internalAdditionalOptions,
      ...(externalAdditionalOptions ?? []),
      ...coreEditorAdditionalSlashCommandOptions({
        disabledExtensions,
        flaggedExtensions,
      }),
    ]?.forEach((item) => {
      const sectionToPushTo = SLASH_COMMAND_SECTIONS.find((s) => s.key === item.section) ?? SLASH_COMMAND_SECTIONS[0];
      const itemIndexToPushAfter = sectionToPushTo.items.findIndex((i) => i.commandKey === item.pushAfter);
      if (itemIndexToPushAfter !== -1) {
        sectionToPushTo.items.splice(itemIndexToPushAfter + 1, 0, item);
      } else {
        sectionToPushTo.items.push(item);
      }
    });

    const filteredSlashSections = SLASH_COMMAND_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (typeof query !== "string") return;

        const lowercaseQuery = query.toLowerCase();
        return (
          item.title.toLowerCase().includes(lowercaseQuery) ||
          item.description.toLowerCase().includes(lowercaseQuery) ||
          item.searchTerms.some((t) => t.includes(lowercaseQuery))
        );
      }),
    }));

    return filteredSlashSections.filter((s) => s.items.length !== 0);
  };
