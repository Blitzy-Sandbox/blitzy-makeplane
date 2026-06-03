/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Row-level renderer for individual entries in the slash-command popup.
 *
 * Consumed exclusively by `SlashCommandsMenu` in `./command-menu`. Renders
 * one `<button type="button">` per `ISlashCommandItem` with selected-state
 * styling, icon + title + optional badge, and case-insensitive substring
 * highlight against the active query.
 *
 * Selection state and activation logic live in the parent menu — this
 * component is presentational and owns no state. The
 * `item-${sectionIndex}-${itemIndex}` id pattern is part of the public DOM
 * contract with `SlashCommandsMenu`: the parent's `useLayoutEffect` queries
 * this id to call `scrollIntoView({ block: "nearest" })` when the user
 * navigates with the keyboard, so the contract is owned jointly by this
 * module and `command-menu.tsx`.
 */

// plane utils
import { cn } from "@plane/utils";
// types
import type { ISlashCommandItem } from "@/types";

/**
 * Props for {@link CommandMenuItem}.
 *
 * Local (non-exported) type — consumed only by `CommandMenuItem` and the
 * parent `SlashCommandsMenu` (which inlines the matching shape on the JSX
 * side rather than importing this type).
 *
 * @property isSelected - Required. Whether this row is currently the active
 *   selection; toggles the highlighted background via `cn(...)`.
 * @property item - Required. The catalog entry to render; provides `icon`,
 *   `iconContainerStyle`, `title`, and optional `badge`.
 * @property itemIndex - Required. The item's position within its section;
 *   combined with `sectionIndex` to derive the stable DOM id.
 * @property onClick - Required. Click handler forwarded from the parent;
 *   the parent calls `e.stopPropagation()` and then `selectItem(...)`.
 * @property onMouseEnter - Required. Hover handler; the parent uses it to
 *   update `selectedIndex` so hover follows keyboard navigation.
 * @property sectionIndex - Required. The row's section position; combined
 *   with `itemIndex` for the stable DOM id.
 * @property query - Optional. When present and non-empty, enables
 *   substring highlighting in the title via {@link highlightMatch}.
 */
type Props = {
  isSelected: boolean;
  item: ISlashCommandItem;
  itemIndex: number;
  onClick: (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
  onMouseEnter: () => void;
  sectionIndex: number;
  query?: string;
};

// Utility to highlight matched text in a string
/**
 * Visually emphasize the first case-insensitive substring match of `query`
 * within `text` by wrapping the matched range in a styled `<span>`
 * (`font-medium text-primary`).
 *
 * Improves scanability when the user types a partial query — they can see
 * which substring of each row matched their input. Only the FIRST
 * occurrence is highlighted (deliberate UX choice: avoids visual noise
 * from repeated highlights in long titles).
 *
 * Case-insensitive matching compares `text.toLowerCase()` against
 * `query.toLowerCase().trim()`, but the highlighted span uses the
 * ORIGINAL casing from `text` (so "Heading" matches "head" but renders as
 * "**Head**ing", preserving capitalization).
 *
 * @param text - The string to scan for a match.
 * @param query - The user's search input; matched case-insensitively
 *   after trimming. An empty/whitespace value short-circuits to the
 *   original `text`.
 * @returns Either the original `text` (when `query` is empty/whitespace
 *   or no match is found) or a React fragment of three children:
 *   `before`, the highlighted `<span>`, and `after`.
 */
const highlightMatch = (text: string, query: string): React.ReactNode => {
  if (!query || query.trim() === "") return text;

  const queryLower = query.toLowerCase().trim();
  const textLower = text.toLowerCase();

  // Check for direct substring match
  const index = textLower.indexOf(queryLower);
  if (index >= 0) {
    const before = text.substring(0, index);
    const match = text.substring(index, index + queryLower.length);
    const after = text.substring(index + queryLower.length);

    return (
      <>
        {before}
        <span className="font-medium text-primary">{match}</span>
        {after}
      </>
    );
  }

  // Otherwise just return the text
  return text;
};

/**
 * A single row in the slash-command popup — renders the item's icon,
 * title, and optional badge with selected-state styling and
 * query-substring highlight.
 *
 * Presentational only: owns no state and runs no effects. Click and hover
 * are forwarded to the parent `SlashCommandsMenu`, which owns selection
 * and command dispatch.
 *
 * Selected-state styling: when `isSelected` is `true`, the button gains
 * the `bg-layer-1-hover` background via `cn(...)`; hover applies the same
 * background, so the visible state is unified across keyboard and pointer
 * interactions.
 *
 * Scroll-into-view contract: the button is rendered at a stable DOM id
 * `item-${sectionIndex}-${itemIndex}` so the parent menu can call
 * `scrollIntoView({ block: "nearest" })` when keyboard navigation moves
 * the selection. This id pattern is owned jointly by this component and
 * `SlashCommandsMenu`; do not change it without updating both files.
 *
 * Icon container: `item.iconContainerStyle` is applied to the wrapping
 * `<span>` so callers can override background/border (e.g.
 * background-color palette items use a colored swatch container; the
 * default uses a bordered surface).
 *
 * Highlight: when `query` is truthy and non-whitespace,
 * {@link highlightMatch} wraps the matched substring in a styled span;
 * otherwise the plain `item.title` is rendered. `item.badge` is rendered
 * as-is to the right of the title.
 *
 * @see {@link Props} for the per-prop contract.
 */
export function CommandMenuItem(props: Props) {
  const { isSelected, item, itemIndex, onClick, onMouseEnter, sectionIndex, query } = props;

  return (
    <button
      type="button"
      id={`item-${sectionIndex}-${itemIndex}`}
      className={cn(
        "flex w-full items-center gap-2 truncate rounded-sm px-1 py-1.5 text-left text-13 text-secondary hover:bg-layer-1-hover",
        {
          "bg-layer-1-hover": isSelected,
        }
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <span className="grid size-5 flex-shrink-0 place-items-center" style={item.iconContainerStyle}>
        {item.icon}
      </span>
      <p className="flex-grow truncate text-12">{query ? highlightMatch(item.title, query) : item.title}</p>
      {item.badge}
    </button>
  );
}
