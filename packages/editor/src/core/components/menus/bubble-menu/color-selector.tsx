/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Color selector for the bubble menu inside the `@plane/editor` TipTap wrapper.
 *
 * Splits the color picker into two stacked sections — "Text colors" and
 * "Background colors" — each driven by the curated `COLORS_LIST` palette from
 * `@/constants/common`. Every section ends with a `Ban`-icon "clear" button
 * that removes the corresponding color mark from the current selection by
 * dispatching the menu-item command with `{ color: undefined }`.
 *
 * TipTap framing:
 *   - EXPOSES the text-color custom extension (a `@tiptap/extension-color`
 *     wrapper) and the background-color custom extension via the
 *     `TextColorItem(editor).command(...)` and
 *     `BackgroundColorItem(editor).command(...)` factories from `../menu-items`.
 *   - OVERRIDES the default behavior of those extensions by surfacing explicit
 *     "clear" actions (passing `{ color: undefined }`) — the upstream
 *     text-color extension provides no built-in UI for removing a color once
 *     set.
 *   - HIDES the underlying extensions' full color spectrum (any CSS color
 *     string is a valid input to the upstream extension) by restricting the UI
 *     to the curated `COLORS_LIST` set so swatch choices stay aligned with
 *     Plane's design system tokens. Future contributors must NOT expand the
 *     palette here without coordinating with the design system.
 *
 * Consumer surface: mounted only inside `./root.tsx` (`EditorBubbleMenu`) —
 * not consumed elsewhere. The parent hides this selector when
 * `editorState.code` is true because color marks would conflict with code-block
 * syntax highlighting in downstream renderers.
 */

import type { Editor } from "@tiptap/react";
import { ALargeSmall, Ban } from "lucide-react";
import { useMemo } from "react";
// plane utils
import { cn } from "@plane/utils";
// constants
import { COLORS_LIST } from "@/constants/common";
// local imports
import { FloatingMenuRoot } from "../floating-menu/root";
import { useFloatingMenu } from "../floating-menu/use-floating-menu";
import { BackgroundColorItem, TextColorItem } from "../menu-items";
import type { EditorStateType } from "./root";

type Props = {
  editor: Editor;
  editorState: EditorStateType;
};

/**
 * Bubble-menu color picker exposing two curated palettes plus per-section clear
 * actions.
 *
 * The trigger is a literal "Color" label followed by a 6×6 preview swatch that
 * combines the active background and active text colors at a glance: the box
 * is filled with `activeBackgroundColor.backgroundColor` (falling back to the
 * `bg-surface-1` theme token when no background is set), and the foreground
 * `ALargeSmall` icon adopts `activeTextColor.textColor` (falling back to the
 * `text-primary` theme token when no text color is set). Theme-aware fallbacks
 * keep the trigger legible in both light and dark themes.
 *
 * Props (see the local `Props` type):
 *   - `editor` (`Editor` from `@tiptap/react`) — the active TipTap editor
 *     instance.
 *   - `editorState` (`EditorStateType` from `./root`) — derived state owned by
 *     the parent `EditorBubbleMenu`. Consumed for `editorState.color` and
 *     `editorState.backgroundColor` only (the active-swatch detection). This
 *     selector does NOT run its own `useEditorState` subscription because the
 *     parent has already derived this snapshot — receiving it via prop
 *     preserves the single-subscription performance contract for the bubble
 *     menu.
 *
 * Local state:
 *   - `useFloatingMenu({})` from `../floating-menu/use-floating-menu` provides
 *     `options` (Floating UI context), `getReferenceProps`, and
 *     `getFloatingProps` — all forwarded to `FloatingMenuRoot` for trigger /
 *     dropdown anchoring and dismiss-on-outside-click.
 *   - `activeTextColor = useMemo(() => editorState.color, [editorState.color])`
 *     and `activeBackgroundColor = useMemo(...)` — memoized references to the
 *     active palette entries (each entry is
 *     `{ key, label, textColor, backgroundColor }` from `COLORS_LIST`, or
 *     `undefined` when no corresponding mark is active). Used for
 *     trigger-button preview styling.
 *
 * Side effects:
 *   - Each text-color swatch click dispatches
 *     `TextColorItem(editor).command({ color: color.key })` — a TipTap chain
 *     command that sets the text-color mark on the current selection.
 *   - Each background-color swatch click dispatches
 *     `BackgroundColorItem(editor).command({ color: color.key })`.
 *   - Each "clear" button (`Ban` icon) dispatches the same factory with
 *     `{ color: undefined }`; the underlying `toggleTextColor` /
 *     `toggleBackgroundColor` helpers in `@/helpers/editor-commands` interpret
 *     that argument shape as a `chain().unsetColor()` /
 *     `unsetBackgroundColor()` call (removes the mark). The
 *     `{ color: undefined }` payload is the contract between this selector and
 *     those helpers — do not change one without the other.
 *   - No event-bubbling guards are installed; clicks propagate normally, and
 *     dismiss-on-outside-click is delegated to `FloatingMenuRoot` via the
 *     floating-menu hook contract.
 *
 * TipTap behavior:
 *   - EXPOSES `@tiptap/extension-color` (the text-color mark API) and the
 *     custom background-color extension via the
 *     `TextColorItem(editor).command(...)` and
 *     `BackgroundColorItem(editor).command(...)` factories from
 *     `../menu-items`.
 *   - OVERRIDES the default extension behavior by surfacing explicit "clear"
 *     actions — the upstream extension provides no UI to clear a color once
 *     set.
 *   - HIDES the default extension's full color spectrum by restricting the UI
 *     to the curated `COLORS_LIST` set so swatch choices match Plane's design
 *     system tokens. See the module-level JSDoc for the design-system
 *     coordination requirement before extending the palette.
 *
 * Behavior notes (WHY):
 *   - The trigger swatch deliberately combines text + background previews into
 *     a single 6×6 box (background fill + foreground glyph) so the user sees
 *     the combined active formatting at a glance without opening the dropdown.
 *     Future contributors must NOT split this into two separate badges — the
 *     combined-state-at-a-glance affordance is the design intent.
 *   - The two `useMemo` calls on `editorState.color` and
 *     `editorState.backgroundColor` are technically unnecessary (these
 *     references are already stable when unchanged) — they are kept to make
 *     the active-state derivation explicit at the call site and to insulate
 *     the downstream styling code from refactors of `EditorStateType`.
 *
 * Consumer surface: mounted inside `./root.tsx` (`EditorBubbleMenu`) between
 * the link selector and the basic formatting buttons; hidden by the parent
 * when `editorState.code` is true.
 */
export function BubbleMenuColorSelector(props: Props) {
  const { editor, editorState } = props;
  // floating ui
  const { options, getReferenceProps, getFloatingProps } = useFloatingMenu({});

  const activeTextColor = useMemo(() => editorState.color, [editorState.color]);
  const activeBackgroundColor = useMemo(() => editorState.backgroundColor, [editorState.backgroundColor]);

  return (
    <FloatingMenuRoot
      classNames={{
        buttonContainer: "h-full",
        button:
          "flex items-center gap-1 h-full whitespace-nowrap px-3 text-13 font-medium text-tertiary hover:bg-layer-1 active:bg-layer-1 rounded-sm transition-colors",
      }}
      menuButton={
        <>
          <span>Color</span>
          <span
            className={cn("grid size-6 flex-shrink-0 place-items-center rounded-sm border-[0.5px] border-strong", {
              "bg-surface-1": !activeBackgroundColor,
            })}
            style={{
              backgroundColor: activeBackgroundColor ? activeBackgroundColor.backgroundColor : "transparent",
            }}
          >
            <ALargeSmall
              className={cn("size-3.5", {
                "text-primary": !activeTextColor,
              })}
              style={{
                color: activeTextColor ? activeTextColor.textColor : "inherit",
              }}
            />
          </span>
        </>
      }
      options={options}
      getFloatingProps={getFloatingProps}
      getReferenceProps={getReferenceProps}
    >
      <section className="mt-1 space-y-2 rounded-md border-[0.5px] border-strong bg-surface-1 p-2 shadow-raised-200">
        <div className="space-y-1.5">
          <p className="text-11 font-semibold text-tertiary">Text colors</p>
          <div className="flex items-center gap-2">
            {COLORS_LIST.map((color) => (
              <button
                key={color.key}
                type="button"
                className="size-6 flex-shrink-0 rounded-sm border-[0.5px] border-strong-1 transition-opacity hover:opacity-60"
                style={{
                  backgroundColor: color.textColor,
                }}
                onClick={() => TextColorItem(editor).command({ color: color.key })}
              />
            ))}
            <button
              type="button"
              className="grid size-6 flex-shrink-0 place-items-center rounded-sm border-[0.5px] border-strong-1 text-tertiary transition-colors hover:bg-layer-1"
              onClick={() => TextColorItem(editor).command({ color: undefined })}
            >
              <Ban className="size-4" />
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-11 font-semibold text-tertiary">Background colors</p>
          <div className="flex items-center gap-2">
            {COLORS_LIST.map((color) => (
              <button
                key={color.key}
                type="button"
                className="size-6 flex-shrink-0 rounded-sm border-[0.5px] border-strong-1 transition-opacity hover:opacity-60"
                style={{
                  backgroundColor: color.backgroundColor,
                }}
                onClick={() => BackgroundColorItem(editor).command({ color: color.key })}
              />
            ))}
            <button
              type="button"
              className="grid size-6 flex-shrink-0 place-items-center rounded-sm border-[0.5px] border-strong-1 text-tertiary transition-colors hover:bg-layer-1"
              onClick={() => BackgroundColorItem(editor).command({ color: undefined })}
            >
              <Ban className="size-4" />
            </button>
          </div>
        </div>
      </section>
    </FloatingMenuRoot>
  );
}
