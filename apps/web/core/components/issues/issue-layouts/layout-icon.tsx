/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Layout icon dispatcher for issue layout selectors.
 *
 * Rendered purpose: maps an `EIssueLayoutTypes` value to its corresponding SVG icon component from
 * `@plane/propel/icons` (list, board, calendar, spreadsheet, or timeline). Returns `null` for any
 * unrecognised layout type so callers can short-circuit safely.
 *
 * Props:
 *   - layout (EIssueLayoutTypes, required): the layout key to render an icon for (LIST, KANBAN, CALENDAR,
 *     SPREADSHEET, GANTT)
 *   - size (number, optional): when provided, sets both `width` and `height` to enforce square sizing;
 *     omitting this prop falls back to the icon component's defaults
 *   - ...props (Omit<ISvgIcons, "width" | "height">, optional): forwarded SVG props (className, fill,
 *     stroke, onClick, etc.) — `width`/`height` are intentionally excluded so callers cannot bypass
 *     the square-sizing contract enforced by `size`
 *
 * MobX stores read: none.
 *
 * Side effects: none — pure presentational dispatcher.
 *
 * Accessibility notes:
 *   - SVG icons inherit `aria-*` attributes from the spread props; callers passing decorative-only icons
 *     should explicitly set `aria-hidden="true"`.
 */

import {
  ListLayoutIcon,
  BoardLayoutIcon,
  CalendarLayoutIcon,
  SheetLayoutIcon,
  TimelineLayoutIcon,
} from "@plane/propel/icons";
import type { ISvgIcons } from "@plane/propel/icons";
import { EIssueLayoutTypes } from "@plane/types";

/** Layout icon dispatcher; see the module-level JSDoc for full semantics. */
export function IssueLayoutIcon({
  layout,
  size,
  ...props
}: { layout: EIssueLayoutTypes; size?: number } & Omit<ISvgIcons, "width" | "height">) {
  const iconProps = {
    ...props,
    ...(size && { width: size, height: size }),
  };

  switch (layout) {
    case EIssueLayoutTypes.LIST:
      return <ListLayoutIcon {...iconProps} />;
    case EIssueLayoutTypes.KANBAN:
      return <BoardLayoutIcon {...iconProps} />;
    case EIssueLayoutTypes.CALENDAR:
      return <CalendarLayoutIcon {...iconProps} />;
    case EIssueLayoutTypes.SPREADSHEET:
      return <SheetLayoutIcon {...iconProps} />;
    case EIssueLayoutTypes.GANTT:
      return <TimelineLayoutIcon {...iconProps} />;
    default:
      return null;
  }
}
