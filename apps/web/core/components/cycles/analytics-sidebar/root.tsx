/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * CycleDetailsSidebar — the orchestrator that composes the cycle peek-overview sidebar.
 *
 * Rendered purpose:
 *   Top-level container that resolves the active cycle record via `useCyclesDetails`,
 *   shows a skeleton until data is available, then lays out the header, metadata, and
 *   analytics progress sections.
 *
 * Props:
 *   - workspaceSlug: string (required) — current workspace slug, forwarded to child sections.
 *   - projectId: string (required) — current project id, forwarded to child sections.
 *   - cycleId: string (required) — id of the cycle whose details are rendered.
 *   - handleClose: () => void (required) — invoked by the header's close affordance.
 *   - isArchived?: boolean (optional) — when true, child sections disable edit affordances.
 *
 * MobX stores read (indirectly via `useCyclesDetails`):
 *   - Cycle store (`useCycle`) — supplies the `cycleDetails` record used by all child sections.
 *   - Work item filters and issues stores — consumed by `useCyclesDetails` for cycle-scoped data.
 *
 * Side effects:
 *   - None directly. All mutations are delegated to child sections (CycleSidebarHeader,
 *     CycleSidebarDetails, CycleAnalyticsProgress).
 *
 * Consumers:
 *   - `apps/web/core/components/cycles/cycle-peek-overview.tsx` (imports via the barrel
 *     `./analytics-sidebar` and renders this component as the peek-overview body).
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import { Loader } from "@plane/ui";
// local imports
import useCyclesDetails from "../active-cycle/use-cycles-details";
import { CycleAnalyticsProgress } from "./issue-progress";
import { CycleSidebarDetails } from "./sidebar-details";
import { CycleSidebarHeader } from "./sidebar-header";

type Props = {
  handleClose: () => void;
  isArchived?: boolean;
  cycleId: string;
  projectId: string;
  workspaceSlug: string;
};

export const CycleDetailsSidebar = observer(function CycleDetailsSidebar(props: Props) {
  const { handleClose, isArchived, projectId, workspaceSlug, cycleId } = props;

  // store hooks
  const { cycle: cycleDetails } = useCyclesDetails({
    workspaceSlug,
    projectId,
    cycleId,
  });

  if (!cycleDetails)
    return (
      <Loader className="px-5">
        <div className="space-y-2">
          <Loader.Item height="15px" width="50%" />
          <Loader.Item height="15px" width="30%" />
        </div>
        <div className="mt-8 space-y-3">
          <Loader.Item height="30px" />
          <Loader.Item height="30px" />
          <Loader.Item height="30px" />
        </div>
      </Loader>
    );

  return (
    <div className="relative pb-2">
      <div className="flex w-full flex-col gap-5">
        <CycleSidebarHeader
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          cycleDetails={cycleDetails}
          isArchived={isArchived}
          handleClose={handleClose}
        />
        <CycleSidebarDetails projectId={projectId} cycleDetails={cycleDetails} />
      </div>

      {workspaceSlug && projectId && cycleDetails?.id && (
        <CycleAnalyticsProgress workspaceSlug={workspaceSlug} projectId={projectId} cycleId={cycleDetails?.id} />
      )}
    </div>
  );
});
