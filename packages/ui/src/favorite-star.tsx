/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compact star toggle button used to mark workspace entities (projects, cycles, pages, views) as favorites.
 */

import { Star } from "lucide-react";
import React from "react";
// helpers
import { cn } from "./utils";

type Props = {
  buttonClassName?: string;
  iconClassName?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  selected: boolean;
};

/**
 * Compact 16×16 button toggling a lucide-react `Star` icon between filled and outlined states
 * to indicate whether the associated entity is favorited.
 *
 * Consumers own the favorited-state mutation (typically a MobX `favorite.store.ts` action) and
 * pass the resulting boolean back through `selected`. The click handler receives the raw
 * `MouseEvent` so it can `stopPropagation()` when the star is embedded inside another clickable
 * row.
 *
 * Props (see local `Props` type):
 *   - `selected`: filled-yellow when true, outlined when false.
 *   - `onClick`: required handler receiving the raw button mouse event.
 *   - `buttonClassName` / `iconClassName`: optional Tailwind overrides for button vs. icon.
 *
 * Accessibility: native `<button>` focus + activation. INTENT UNCLEAR: `aria-pressed` is not
 * applied even though this is a toggle; the selected state is conveyed by fill color alone.
 */
export function FavoriteStar(props: Props) {
  const { buttonClassName, iconClassName, onClick, selected } = props;

  return (
    <button type="button" className={cn("grid h-4 w-4 place-items-center", buttonClassName)} onClick={onClick}>
      <Star
        className={cn(
          "h-4 w-4 text-tertiary transition-all",
          {
            "fill-(--color-label-yellow-icon) stroke-(--color-label-yellow-icon)": selected,
          },
          iconClassName
        )}
      />
    </button>
  );
}
