/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Stateless presentational header for grouped cycle sections (active, upcoming,
 * completed) — renders a Row containing a CycleGroupIcon, the section title, an
 * optional count suffix, and a ChevronDownIcon that rotates 180deg when the
 * parent Disclosure is expanded.
 *
 * Props:
 *   - type (TCycleGroups, required): cycle group discriminant ("current",
 *     "upcoming", "completed", "draft") that drives the icon variant rendered
 *     by CycleGroupIcon.
 *   - title (string, required): localized section heading text (typically
 *     pre-translated by the parent via useTranslation).
 *   - count (number, optional): item count rendered after the title when
 *     showCount is true; falls back to "0" when undefined.
 *   - showCount (boolean, optional, default=false): when true, renders the count
 *     suffix beside the title; when false, the count is omitted entirely.
 *   - isExpanded (boolean, optional, default=false): when true, applies a
 *     `rotate-180` class to the chevron to indicate the section is open.
 *
 * MobX stores read: NONE — purely presentational, no observer wrapping needed.
 *
 * Side effects: NONE — no API calls, navigations, or mutations. The chevron
 * rotation and any collapse behavior are driven entirely by the parent's
 * controlled state (typically a Headless UI Disclosure).
 *
 * Consumers: cycles/list/root.tsx (upcoming + completed Disclosure sections);
 * sibling of `CycleListProjectGroupHeader` which is used for project-grouped
 * sections rather than status-grouped sections.
 */
import React from "react";
// types
import { CycleGroupIcon, ChevronDownIcon } from "@plane/propel/icons";
import type { TCycleGroups } from "@plane/types";
// icons
import { Row } from "@plane/ui";
// helpers
import { cn } from "@plane/utils";

type Props = {
  type: TCycleGroups;
  title: string;
  count?: number;
  showCount?: boolean;
  isExpanded?: boolean;
};

export function CycleListGroupHeader(props: Props) {
  const { type, title, count, showCount = false, isExpanded = false } = props;
  return (
    <Row className="flex items-center justify-between py-2.5">
      <div className="flex flex-shrink-0 items-center gap-5">
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-xs">
          <CycleGroupIcon cycleGroup={type} className="h-5 w-5" />
        </div>

        <div className="relative flex w-full flex-row items-center gap-1 overflow-hidden">
          <div className="line-clamp-1 inline-block truncate font-medium text-primary">{title}</div>
          {showCount && <div className="pl-2 text-13 font-medium text-tertiary">{`${count ?? "0"}`}</div>}
        </div>
      </div>
      <ChevronDownIcon
        className={cn("size-4 shrink-0 text-tertiary transition-transform", {
          "rotate-180": isExpanded,
        })}
      />
    </Row>
  );
}
