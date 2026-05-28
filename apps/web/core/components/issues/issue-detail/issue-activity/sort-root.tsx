/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compact sort-order toggle for the issue activity timeline.
 *
 * Rendered purpose: a single tertiary `IconButton` that swaps between `ArrowUpWideNarrow` (ascending)
 * and `ArrowDownWideNarrow` (descending) based on the supplied `sortOrder`, and invokes the parent's
 * `toggleSort` callback on click. Stateless and memoized via `React.memo` so the icon button does
 * not re-render when its parent's unrelated state changes (the surrounding activity feed re-renders
 * frequently as comments stream in via the MobX store).
 *
 * Props (TActivitySortRoot):
 *   - sortOrder (E_SORT_ORDER, required): current sort direction; drives icon selection
 *   - toggleSort (() => void, required): invoked when the icon button is clicked; the parent
 *     (`./root.tsx`) is expected to flip the order and persist it via `useLocalStorage`
 *
 * MobX stores read: none — the parent owns the sort state and persistence.
 *
 * Side effects: none — emits a single user-driven callback; no toasts, navigations, or API calls.
 *
 * Accessibility:
 *   - Native `IconButton` from `@plane/propel/icon-button` provides keyboard focus and Enter/Space
 *     activation semantics.
 *   - The icon itself conveys direction visually; the parent surface (`root.tsx`) does NOT supply a
 *     visible label, so screen-reader announceability relies on `IconButton`'s default aria
 *     behavior.
 */

import { memo } from "react";
import { ArrowUpWideNarrow, ArrowDownWideNarrow } from "lucide-react";
// plane package imports
import { E_SORT_ORDER } from "@plane/constants";
import { IconButton } from "@plane/propel/icon-button";

/**
 * Public prop shape of `ActivitySortRoot` — consumed by `./root.tsx` to wire the sort toggle into
 * the activity header.
 */
export type TActivitySortRoot = {
  sortOrder: E_SORT_ORDER;
  toggleSort: () => void;
};
export const ActivitySortRoot = memo(function ActivitySortRoot(props: TActivitySortRoot) {
  const SortIcon = props.sortOrder === E_SORT_ORDER.ASC ? ArrowUpWideNarrow : ArrowDownWideNarrow;
  return <IconButton variant="tertiary" icon={SortIcon} onClick={props.toggleSort} />;
});

ActivitySortRoot.displayName = "ActivitySortRoot";
