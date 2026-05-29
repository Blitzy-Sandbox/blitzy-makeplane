/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX-observed row component for a single cycle in the cycles list. Renders a
 * shared ListItem with a circular progress indicator (or CheckIcon when 100%),
 * delegates inline metadata + actions to CycleListItemAction, and exposes a
 * mobile-only CycleQuickActions overflow menu. Archived rows open the peek
 * panel on click instead of navigating to the cycle detail page.
 *
 * Returns null when the cycle cannot be resolved from the cycle store, so
 * deleted-but-still-referenced cycle IDs render as empty rather than crashing.
 *
 * Props (TCyclesListItem):
 *   - cycleId (string, required): cycle ID resolved against the cycle store via
 *     getCycleById to obtain status, progress, archived state, and metadata.
 *   - workspaceSlug (string, required): workspace slug used for the row's
 *     navigation target and forwarded to CycleListItemAction + CycleQuickActions.
 *   - projectId (string, required): project ID used for the row's navigation
 *     target and forwarded to descendants.
 *   - className (string, optional, default=""): extra class name forwarded to
 *     the underlying ListItem wrapper.
 *   - handleEditCycle, handleDeleteCycle, handleAddToFavorites,
 *     handleRemoveFromFavorites (() => void, optional): destructured from props
 *     for type compatibility with TCyclesListItem; not consumed by this
 *     component (favorite + edit + delete are owned by CycleListItemAction and
 *     CycleQuickActions respectively).
 *
 * MobX stores read:
 *   - useCycle (cycle store): getCycleById to resolve the cycle entity for
 *     status, progress, and archived_at; reactive subscription via observer.
 *
 * Side effects:
 *   - Navigation: openCycleOverview pushes a query-string mutation onto the
 *     current pathname to toggle the `peekCycle` search param — sets it to the
 *     current cycleId on first click and clears it on second click. Driven by
 *     useAppRouter().push, useSearchParams, and usePathname from next/navigation.
 *   - Click behavior is conditional: archived rows (`cycleDetails.archived_at`
 *     truthy) call handleArchivedCycleClick → openCycleOverview (peek panel);
 *     non-archived rows use the underlying ListItem's default itemLink
 *     navigation to `/${workspaceSlug}/projects/${projectId}/cycles/${id}`.
 *   - Reads `usePlatformOS().isMobile` to forward to ListItem for mobile-specific
 *     interactions, and `searchParams.has("peekCycle")` to indicate sidebar-open
 *     state to ListItem.
 *   - No direct API calls — favorite/edit/delete/archive mutations originate in
 *     descendants (CycleListItemAction, CycleQuickActions).
 *
 * Derived state:
 *   - `cycleStatus`: lowercased cycle status (or "draft" when absent), narrowed
 *     to TCycleGroups. NOTE: existing TODO comment on line 56 notes this branch
 *     is a temporary workaround until the backend response shape is corrected.
 *   - `isActive`: derived from cycleStatus === "current"; forwarded to
 *     CycleListItemAction to switch its date-display rendering mode.
 *   - `progress`: result of calculateCycleProgress(cycleDetails) from
 *     @plane/utils — drives the CircularProgressIndicator.
 *
 * Consumers: cycles/list/cycles-list-map.tsx (which maps cycleIds → CyclesListItem
 * for active-cycle archive, upcoming, and completed sections).
 */

import type { MouseEvent } from "react";
import { useRef } from "react";
import { observer } from "mobx-react";
import { usePathname, useSearchParams } from "next/navigation";
import { CheckIcon } from "@plane/propel/icons";
// plane imports
import type { TCycleGroups } from "@plane/types";
import { CircularProgressIndicator } from "@plane/ui";
// components
import { generateQueryParams, calculateCycleProgress } from "@plane/utils";
import { ListItem } from "@/components/core/list";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useAppRouter } from "@/hooks/use-app-router";
import { usePlatformOS } from "@/hooks/use-platform-os";
// local imports
import { CycleQuickActions } from "../quick-actions";
import { CycleListItemAction } from "./cycle-list-item-action";

type TCyclesListItem = {
  cycleId: string;
  handleEditCycle?: () => void;
  handleDeleteCycle?: () => void;
  handleAddToFavorites?: () => void;
  handleRemoveFromFavorites?: () => void;
  workspaceSlug: string;
  projectId: string;
  className?: string;
};

export const CyclesListItem = observer(function CyclesListItem(props: TCyclesListItem) {
  const { cycleId, workspaceSlug, projectId, className = "" } = props;
  // refs
  const parentRef = useRef(null);
  // router
  const router = useAppRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // hooks
  const { isMobile } = usePlatformOS();
  // store hooks
  const { getCycleById } = useCycle();

  // derived values
  const cycleDetails = getCycleById(cycleId);

  if (!cycleDetails) return null;

  // computed
  // TODO: change this logic once backend fix the response
  const cycleStatus = cycleDetails.status ? (cycleDetails.status.toLocaleLowerCase() as TCycleGroups) : "draft";
  const isActive = cycleStatus === "current";

  // handlers
  const openCycleOverview = (e: MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const query = generateQueryParams(searchParams, ["peekCycle"]);
    if (searchParams.has("peekCycle") && searchParams.get("peekCycle") === cycleId) {
      router.push(`${pathname}?${query}`);
    } else {
      router.push(`${pathname}?${query && `${query}&`}peekCycle=${cycleId}`);
    }
  };

  // handlers
  const handleArchivedCycleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    openCycleOverview(e);
  };

  const handleItemClick = cycleDetails.archived_at ? handleArchivedCycleClick : undefined;

  const progress = calculateCycleProgress(cycleDetails);

  return (
    <ListItem
      title={cycleDetails?.name ?? ""}
      itemLink={`/${workspaceSlug}/projects/${projectId}/cycles/${cycleDetails.id}`}
      onItemClick={handleItemClick}
      className={className}
      prependTitleElement={
        <CircularProgressIndicator size={30} percentage={progress} strokeWidth={3}>
          {progress === 100 ? (
            <CheckIcon className="h-3 w-3 stroke-2" />
          ) : (
            <span className="text-9 text-primary">{`${progress}%`}</span>
          )}
        </CircularProgressIndicator>
      }
      actionableItems={
        <CycleListItemAction
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          cycleId={cycleId}
          cycleDetails={cycleDetails}
          parentRef={parentRef}
          isActive={isActive}
        />
      }
      quickActionElement={
        <div className="block md:hidden">
          <CycleQuickActions
            parentRef={parentRef}
            cycleId={cycleId}
            projectId={projectId}
            workspaceSlug={workspaceSlug}
          />
        </div>
      }
      isMobile={isMobile}
      parentRef={parentRef}
      isSidebarOpen={searchParams.has("peekCycle")}
    />
  );
});
