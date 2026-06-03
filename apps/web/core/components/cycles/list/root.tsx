/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Screen-level component that assembles the canonical cycles page: a fixed-width
 * ContentWrapper containing a ListLayout with three optional sections (active,
 * upcoming, completed) and a side-mounted CyclePeekOverview. In archived mode it
 * collapses to a single CyclesListMap of archived cycle IDs.
 *
 * Props (ICyclesList):
 *   - completedCycleIds (string[], required): cycle IDs rendered under the
 *     "Completed" Disclosure section. May be empty.
 *   - cycleIds (string[], required): full cycle ID set used directly only when
 *     `isArchived` is true; otherwise the active/upcoming/completed splits come
 *     from the dedicated prop fields and this prop is unused by the active mode.
 *   - upcomingCycleIds (string[] | undefined, optional): cycle IDs rendered under
 *     the "Upcoming" Disclosure section when provided; when undefined the upcoming
 *     section is hidden entirely.
 *   - workspaceSlug (string, required): workspace slug threaded through to every
 *     child item for navigation and API key construction.
 *   - projectId (string, required): project ID threaded through to every child
 *     item for navigation, API key construction, and the peek panel.
 *   - isArchived (boolean, optional, default=false): when true, switches the
 *     layout to single-section archived rendering and changes the peek panel
 *     mode to archived.
 *
 * MobX stores read: NONE directly. This component is a pure composer — it reads
 * `useTranslation` for label text only. All store reads occur in the descendant
 * `ActiveCycleRoot`, `CyclesListMap` → `CyclesListItem`, and `CyclePeekOverview`
 * components.
 *
 * Side effects: NONE directly. No API calls, navigations, mutations, or toasts
 * originate in this component; data fetching is owned by parent route components
 * and by descendants.
 *
 * Conditional rendering:
 *   - When `isArchived` is true → only the archived CyclesListMap is mounted.
 *   - When `isArchived` is false → ActiveCycleRoot is always mounted; the
 *     upcoming Disclosure is mounted only when `upcomingCycleIds` is defined;
 *     the completed Disclosure is always mounted. Both Disclosures default to
 *     open and rotate their chevron via the `isExpanded` prop on
 *     CycleListGroupHeader.
 *
 * Consumers:
 *   - apps/web/core/components/cycles/cycles-view.tsx (main cycles screen)
 *   - apps/web/core/components/cycles/archived-cycles/view.tsx (archived view)
 */

import React from "react";
import { observer } from "mobx-react";
import { Disclosure } from "@headlessui/react";
// components
import { useTranslation } from "@plane/i18n";
import { ContentWrapper, ERowVariant } from "@plane/ui";
import { ListLayout } from "@/components/core/list";
import { ActiveCycleRoot } from "@/plane-web/components/cycles";
// local imports
import { CyclePeekOverview } from "../cycle-peek-overview";
import { CycleListGroupHeader } from "./cycle-list-group-header";
import { CyclesListMap } from "./cycles-list-map";

export interface ICyclesList {
  completedCycleIds: string[];
  upcomingCycleIds?: string[] | undefined;
  cycleIds: string[];
  workspaceSlug: string;
  projectId: string;
  isArchived?: boolean;
}

export const CyclesList = observer(function CyclesList(props: ICyclesList) {
  const { completedCycleIds, upcomingCycleIds, cycleIds, workspaceSlug, projectId, isArchived = false } = props;
  const { t } = useTranslation();

  return (
    <ContentWrapper variant={ERowVariant.HUGGING} className="flex-row">
      <ListLayout>
        {isArchived ? (
          <>
            <CyclesListMap cycleIds={cycleIds} projectId={projectId} workspaceSlug={workspaceSlug} />
          </>
        ) : (
          <>
            <ActiveCycleRoot workspaceSlug={workspaceSlug} projectId={projectId} />

            {upcomingCycleIds && (
              <Disclosure as="div" className="flex flex-shrink-0 flex-col" defaultOpen>
                {({ open }) => (
                  <>
                    <Disclosure.Button className="sticky top-0 z-[2] w-full flex-shrink-0 cursor-pointer border-b border-subtle bg-layer-1">
                      <CycleListGroupHeader
                        title={t("project_cycles.upcoming_cycle.label")}
                        type="upcoming"
                        count={upcomingCycleIds.length}
                        showCount
                        isExpanded={open}
                      />
                    </Disclosure.Button>
                    <Disclosure.Panel>
                      <CyclesListMap cycleIds={upcomingCycleIds} projectId={projectId} workspaceSlug={workspaceSlug} />
                    </Disclosure.Panel>
                  </>
                )}
              </Disclosure>
            )}
            <Disclosure as="div" className="flex flex-shrink-0 flex-col pb-7">
              {({ open }) => (
                <>
                  <Disclosure.Button className="sticky top-0 z-2 w-full flex-shrink-0 cursor-pointer border-b border-subtle bg-layer-1">
                    <CycleListGroupHeader
                      title={t("project_cycles.completed_cycle.label")}
                      type="completed"
                      count={completedCycleIds.length}
                      showCount
                      isExpanded={open}
                    />
                  </Disclosure.Button>
                  <Disclosure.Panel>
                    <CyclesListMap cycleIds={completedCycleIds} projectId={projectId} workspaceSlug={workspaceSlug} />
                  </Disclosure.Panel>
                </>
              )}
            </Disclosure>
          </>
        )}
      </ListLayout>
      <CyclePeekOverview projectId={projectId} workspaceSlug={workspaceSlug} isArchived={isArchived} />
    </ContentWrapper>
  );
});
