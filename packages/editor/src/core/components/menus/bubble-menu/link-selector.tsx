/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Link selector for the bubble menu inside the `@plane/editor` TipTap wrapper.
 *
 * Renders a "Link" trigger that opens a floating URL input with validation,
 * apply, and clear/delete actions. The trigger reflects the active state of
 * the custom link extension at the current selection. URL normalization (e.g.,
 * prefixing `https://` when missing, blocking dangerous protocols like
 * `javascript:` / `data:`) is centralized in `isValidHttpUrl` from
 * `@/helpers/common`, so this selector never touches a raw `href` value.
 *
 * TipTap framing:
 *   - EXPOSES the custom link mark via the `setLinkEditor(editor, url)` and
 *     `unsetLinkEditor(editor)` wrappers from `@/helpers/editor-commands`.
 *   - EXPOSES the active state of the custom link extension via
 *     `editor.isActive(CORE_EXTENSIONS.CUSTOM_LINK)` — drives the
 *     `text-primary` styling on the trigger when a link is active at the cursor.
 *   - OVERRIDES the default `@tiptap/extension-link` behavior, which ships no
 *     UI for editing href values; this selector is the entire link-editing
 *     surface that downstream editor variants ship to the user.
 *   - HIDES raw chain invocations such as
 *     `editor.chain().focus().setLink({ href }).run()` behind the helper
 *     wrappers so URL normalization stays centralized in `isValidHttpUrl`.
 *     Future contributors must not call `editor.chain().setLink(...)` directly
 *     — route through the helper.
 *
 * Consumer surface: mounted only inside `./root.tsx` (`EditorBubbleMenu`) —
 * not consumed elsewhere. The parent hides this selector when
 * `editorState.code` is true because link marks inside code blocks render as
 * plain text in most downstream renderers.
 */

import type { Editor } from "@tiptap/core";

import { useCallback, useRef, useState } from "react";
import { LinkIcon, TrashIcon, CheckIcon } from "@plane/propel/icons";
// plane imports
import { cn } from "@plane/utils";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import { isValidHttpUrl } from "@/helpers/common";
import { setLinkEditor, unsetLinkEditor } from "@/helpers/editor-commands";
import { FloatingMenuRoot } from "../floating-menu/root";
import { useFloatingMenu } from "../floating-menu/use-floating-menu";

type Props = {
  editor: Editor;
};

/**
 * Contextual hyperlink editor anchored to the current text selection inside
 * `EditorBubbleMenu`.
 *
 * Shows a "Link" trigger that opens a floating URL input. On submit, validates
 * the input via `isValidHttpUrl` (which also normalizes missing-scheme inputs
 * by prefixing `https://`), applies the link mark, and closes the menu. The
 * right-side action button swaps between `CheckIcon` (apply) and `TrashIcon`
 * (delete) based on whether a link is already present at the selection.
 *
 * Props (see the local `Props` type):
 *   - `editor` (`Editor` from `@tiptap/core`) — the active TipTap editor instance.
 *
 * Unlike `BubbleMenuColorSelector` and `TextAlignmentSelector`, this selector
 * does NOT receive an `editorState` prop because it queries link active state
 * directly via `editor.isActive(CORE_EXTENSIONS.CUSTOM_LINK)` (synchronous, no
 * subscription needed) and reads the existing link's `href` directly via
 * `editor.getAttributes("link").href` — neither lookup requires the parent's
 * derived state slice.
 *
 * Local state:
 *   - `error: boolean` — true when the user submitted an invalid URL; toggles
 *     the input's `border-danger-strong` border and the inline "Please enter a
 *     valid URL" message rendered below the input.
 *   - `useFloatingMenu({})` returns `options`, `getReferenceProps`,
 *     `getFloatingProps`; `options.context` provides Floating UI's
 *     `onOpenChange` controller used to close the menu after apply/delete.
 *   - `inputRef: HTMLInputElement | null` — DOM ref used to read the input
 *     value on submit (the input is uncontrolled — `defaultValue` is sourced
 *     from `editor.getAttributes("link").href` at first render).
 *
 * Side effects:
 *   - `handleLinkSubmit` (memoized via `useCallback([editor, inputRef, context])`)
 *     reads `inputRef.current.value`, validates via `isValidHttpUrl(url)` from
 *     `@/helpers/common` (returns `{ isValid, url: validatedUrl }`). On valid
 *     input, dispatches `setLinkEditor(editor, validatedUrl)` from
 *     `@/helpers/editor-commands`, closes the menu via
 *     `context.onOpenChange(false)`, and clears the error state. On invalid
 *     input, sets `error` to true and leaves the menu open so the user can
 *     correct the input.
 *   - The trash button's `onClick` handler dispatches `unsetLinkEditor(editor)`
 *     from `@/helpers/editor-commands` to clear the link mark on the current
 *     selection, then closes the menu via `context.onOpenChange(false)`.
 *   - Input handlers: `Enter` submits via `handleLinkSubmit()`; any `keydown`
 *     and `focus` clear the error state.
 *
 * TipTap behavior:
 *   - EXPOSES `editor.commands.setLink` and `editor.commands.unsetLink` via the
 *     `setLinkEditor` / `unsetLinkEditor` wrappers from
 *     `@/helpers/editor-commands`.
 *   - EXPOSES the active state of the custom link extension via
 *     `editor.isActive(CORE_EXTENSIONS.CUSTOM_LINK)`, driving the
 *     `text-primary` styling on the trigger when a link is active at the cursor.
 *   - OVERRIDES the default `@tiptap/extension-link` behavior — the upstream
 *     extension ships no UI for editing href values; this selector is the
 *     entire link-editing surface.
 *   - HIDES the direct chain invocation
 *     `editor.chain().focus().setLink({ href }).run()` behind the
 *     `setLinkEditor` helper so URL normalization stays centralized in
 *     `isValidHttpUrl`.
 *
 * Behavior notes (WHY):
 *   - The `isActive` check uses `editor.isActive(CORE_EXTENSIONS.CUSTOM_LINK)`
 *     while the `getAttributes` calls use the literal string `"link"`. The
 *     enum value `CORE_EXTENSIONS.CUSTOM_LINK` is defined as `"link"`, so the
 *     two strings are equal today — but the lookups are semantically distinct:
 *     `isActive` queries by extension key, `getAttributes` queries by mark
 *     name. The same literal-`"link"` convention is used by `LinkItem` in
 *     `../menu-items.ts`. Do NOT "harmonize" these two calls to a single form
 *     because they target different TipTap APIs with different naming
 *     contracts.
 *   - The right-side button swaps between `CheckIcon` (apply mode) and
 *     `TrashIcon` (delete mode) based on whether `editor.getAttributes("link").href`
 *     is truthy at the selection — one button serves two semantically distinct
 *     actions, communicated through the icon swap without button text.
 *   - `autoFocus` on the input is a deliberate UX choice: the user reaches
 *     this selector by selecting text and clicking "Link", so the input must
 *     be ready for immediate typing without an additional click.
 *   - The error message uses Tailwind `animate-in fade-in slide-in-from-top-0`
 *     animation tokens with `pointer-events-none` so it animates in but does
 *     not intercept the input's focus.
 *   - The input's `onClick={(e) => e.stopPropagation()}` is required because
 *     `FloatingMenuRoot` uses `useDismiss` from `@floating-ui/react`, which
 *     closes the menu on any outside click. Without `stopPropagation`, every
 *     click inside the input itself would trigger that handler and close the
 *     menu mid-typing.
 *
 * Consumer surface: mounted inside `./root.tsx` (`EditorBubbleMenu`).
 */
export function BubbleMenuLinkSelector(props: Props) {
  const { editor } = props;
  // states
  const [error, setError] = useState(false);
  // floating ui
  const { options, getReferenceProps, getFloatingProps } = useFloatingMenu({});
  const { context } = options;
  // refs
  const inputRef = useRef<HTMLInputElement>(null);

  const handleLinkSubmit = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const url = input.value;
    if (!url) return;
    const { isValid, url: validatedUrl } = isValidHttpUrl(url);
    if (isValid) {
      setLinkEditor(editor, validatedUrl);
      context.onOpenChange(false);
      setError(false);
    } else {
      setError(true);
    }
  }, [editor, inputRef, context]);

  return (
    <FloatingMenuRoot
      classNames={{
        buttonContainer: "h-full",
        button: cn(
          "flex h-full items-center gap-1 rounded-sm px-3 text-13 font-medium whitespace-nowrap text-tertiary transition-colors hover:bg-layer-1 active:bg-layer-1",
          {
            "bg-layer-1": context.open,
            "text-primary": editor.isActive(CORE_EXTENSIONS.CUSTOM_LINK),
          }
        ),
      }}
      getFloatingProps={getFloatingProps}
      getReferenceProps={getReferenceProps}
      menuButton={
        <>
          Link
          <LinkIcon className="size-3 shrink-0" />
        </>
      }
      options={options}
    >
      <div className="mt-1 w-60 rounded-md bg-surface-1 shadow-raised-200">
        <div
          className={cn("flex rounded-sm border-[0.5px] border-strong transition-colors", {
            "border-danger-strong": error,
          })}
        >
          <input
            ref={inputRef}
            type="url"
            placeholder="Enter or paste a link"
            onClick={(e) => e.stopPropagation()}
            className="flex-1 rounded-sm border-r-[0.5px] border-strong bg-surface-1 px-1.5 py-2 text-11 outline-none placeholder:text-placeholder"
            defaultValue={editor.getAttributes("link").href || ""}
            onKeyDown={(e) => {
              setError(false);
              if (e.key === "Enter") {
                e.preventDefault();
                handleLinkSubmit();
              }
            }}
            onFocus={() => setError(false)}
            autoFocus
          />
          {editor.getAttributes("link").href ? (
            <button
              type="button"
              className="grid place-items-center rounded-xs p-1 text-danger-primary transition-all hover:bg-danger-subtle-hover"
              onClick={(e) => {
                unsetLinkEditor(editor);
                e.stopPropagation();
                context.onOpenChange(false);
              }}
            >
              <TrashIcon className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              className="grid aspect-square h-full place-items-center rounded-xs p-1 text-tertiary transition-all hover:bg-layer-1"
              onClick={(e) => {
                e.stopPropagation();
                handleLinkSubmit();
              }}
            >
              <CheckIcon className="size-4" />
            </button>
          )}
        </div>
        {error && (
          <p className="animate-in fade-in slide-in-from-top-0 pointer-events-none my-1 px-2 text-11 text-danger-primary">
            Please enter a valid URL
          </p>
        )}
      </div>
    </FloatingMenuRoot>
  );
}
