/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `FilterOption` — single selectable row primitive used by every entity-specific filter and every
 * display-filter section.
 *
 * Rendered purpose: renders one row containing a checkbox or radio indicator + an optional leading
 * icon + a label; on click, invokes `onClick` so the parent toggles the value in / out of the active
 * filter set.
 *
 * Props (`Props`):
 *   - `isChecked` (`boolean`, required): selection state (drives the indicator's visual state).
 *   - `icon` (`ReactNode`, optional): leading icon (priority icon, label swatch, avatar, etc.).
 *   - `title` (`ReactNode`, required): the option label.
 *   - `onClick` (`() => void`, optional): row click handler; when omitted, the row is rendered
 *     non-interactive.
 *   - `multiple` (`boolean`, optional, default `true`): when `true`, renders a checkbox indicator
 *     (used for multi-select filter slots like assignees / labels / priorities); when `false`,
 *     renders a radio indicator (used for single-select slots like `group_by` / `order_by`).
 *   - `activePulse` (`boolean`, optional, default `false`): when `true`, renders a small pulsing
 *     accent dot at the row's trailing edge to signal an "active" state to the user.
 *
 * MobX stores read: none.
 *
 * Side effects: none — invokes `onClick`.
 *
 * Accessibility considerations: the row is rendered as a native `<button type="button">`, so focus
 * order, keyboard activation (Enter / Space), and screen-reader role are inherited from the platform.
 * Callers do not need to wire additional `role` or `onKeyDown` handlers.
 */

import { CheckIcon } from "@plane/propel/icons";

type Props = {
  icon?: React.ReactNode;
  isChecked: boolean;
  title: React.ReactNode;
  onClick?: () => void;
  multiple?: boolean;
  activePulse?: boolean;
};

export function FilterOption(props: Props) {
  const { icon, isChecked, multiple = true, onClick, title, activePulse = false } = props;

  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-sm p-1.5 hover:bg-layer-transparent-hover"
      onClick={onClick}
    >
      <div
        className={`grid h-3 w-3 flex-shrink-0 place-items-center border ${
          isChecked ? "border-accent-strong bg-accent-primary text-on-color" : "border-strong"
        } ${multiple ? "rounded-xs" : "rounded-full"}`}
      >
        {isChecked && <CheckIcon width={10} height={10} strokeWidth={3} />}
      </div>
      <div className="flex items-center gap-2 truncate">
        {icon && <div className="grid w-5 flex-shrink-0 place-items-center">{icon}</div>}
        <div className="flex-grow truncate text-caption-sm-regular text-secondary">{title}</div>
      </div>
      {activePulse && (
        <div className="ml-auto h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-accent-primary text-caption-sm-regular" />
      )}
    </button>
  );
}
