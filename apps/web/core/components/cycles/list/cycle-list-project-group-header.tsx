/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX-observed collapsible header for groups of cycles that belong to a single
 * project — renders the project's logo, name, and (optionally) the cycle count,
 * with a chevron that rotates based on the parent Disclosure's open state.
 *
 * Returns null when the project cannot be resolved from the project store, so
 * deleted-but-still-referenced project IDs render as empty rather than crashing.
 *
 * Props:
 *   - projectId (string, required): project ID resolved against the project store
 *     to look up the project's name and logo_props.
 *   - count (number, optional): cycle count shown to the right of the project name.
 *     Falls back to "0" when undefined and showCount is true.
 *   - showCount (boolean, optional, default=false): when true, renders the count
 *     suffix; when false, the count is omitted entirely.
 *   - isExpanded (boolean, optional, default=false): when true, rotates the
 *     ChevronRightIcon 90deg to visually indicate the section is open.
 *
 * MobX stores read:
 *   - useProject (project store): getProjectById to resolve the project entity;
 *     reading `project.logo_props` and `project.name`.
 *
 * Side effects: NONE — purely presentational, no API calls, navigations, or
 * mutations. The chevron rotation and Disclosure open/close behavior are driven
 * entirely by the parent component's controlled state.
 *
 * Consumers: rendered as the header for project-grouped cycle Disclosure
 * sections; sibling of `CycleListGroupHeader` which handles cycle-status grouping
 * (active / upcoming / completed) rather than project-based grouping.
 */

import React from "react";
import { observer } from "mobx-react";
import { Logo } from "@plane/propel/emoji-icon-picker";
import { ChevronRightIcon } from "@plane/propel/icons";
// icons
import { Row } from "@plane/ui";
// helpers
import { cn } from "@plane/utils";
import { useProject } from "@/hooks/store/use-project";

type Props = {
  projectId: string;
  count?: number;
  showCount?: boolean;
  isExpanded?: boolean;
};

export const CycleListProjectGroupHeader = observer(function CycleListProjectGroupHeader(props: Props) {
  const { projectId, count, showCount = false, isExpanded = false } = props;
  // store hooks
  const { getProjectById } = useProject();
  // derived values
  const project = getProjectById(projectId);

  if (!project) return null;
  return (
    <Row className="flex flex-shrink-0 items-center gap-2 py-2.5">
      <ChevronRightIcon
        className={cn("h-4 w-4 text-tertiary duration-300", {
          "rotate-90": isExpanded,
        })}
        strokeWidth={2}
      />
      <div className="flex size-4 flex-shrink-0 items-center justify-center overflow-hidden">
        <Logo logo={project.logo_props} size={16} />
      </div>
      <div className="relative flex w-full flex-row items-center gap-1 overflow-hidden">
        <div className="line-clamp-1 inline-block truncate font-medium text-primary">{project.name}</div>
        {showCount && <div className="pl-2 text-13 font-medium text-tertiary">{`${count ?? "0"}`}</div>}
      </div>
    </Row>
  );
});
