/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Modules-domain timeline (Gantt) store adapter — wires the modules data slice into the
 * shared `BaseTimeLineStore` so the Gantt chart can render module rows alongside the
 * parallel `IssuesTimeLineStore`.
 *
 * Base class extended:
 *   - `BaseTimeLineStore` from `@/plane-web/store/timeline/base-timeline.store` provides
 *     all observable state (`blocksMap`, `blockIds`, `isDragging`, `currentView`,
 *     `currentViewData`, `activeBlockId`, `renderView`) and actions (`updateBlocks`,
 *     `setBlockIds`, `initGantt`, `updateBlockPosition`, `getUpdatedPositionAfterDrag`,
 *     `getNumberOfDaysFromPosition`, `getPositionFromDateOnGantt`,
 *     `getDateFromPositionOnGantt`). This adapter does not add observables of its own.
 *
 * State slice (added by this adapter):
 *   - `isDependencyEnabled: boolean` — declared on `IModulesTimeLineStore` to signal
 *     that module rows participate in cross-block dependency logic on the Gantt chart.
 *
 * Data source:
 *   - `rootStore.module.getModuleById` — the module lookup function consumed by the
 *     autorun. The chart adapter does not own module data; it reads through the root
 *     store so the modules domain remains the single source of truth.
 *
 * Reactivity:
 *   - The constructor installs a MobX `autorun` that reads
 *     `this.rootStore.module.getModuleById` and forwards it to the inherited
 *     `this.updateBlocks(getModuleById)` whenever any tracked observable changes,
 *     keeping the Gantt block index in sync with the modules store.
 *
 * Consumers:
 *   - `apps/web/ce/store/timeline/index.ts` — instantiates this class as
 *     `modulesTimeLineStore` on the aggregate `TimeLineStore`.
 *   - `apps/web/ce/hooks/use-timeline-chart.ts` and
 *     `apps/web/core/hooks/use-timeline-chart.ts` — `getTimelineStore` resolves to this
 *     adapter when `timelineType === GANTT_TIMELINE_TYPE.MODULE`.
 *   - `apps/web/core/components/gantt-chart/sidebar/modules/**` — modules Gantt sidebar
 *     (`block.tsx`, `sidebar.tsx`) reads timeline blocks from this store.
 *   - `apps/web/core/components/gantt-chart/**` — shared Gantt chart UI (chart helpers,
 *     block resizables) consume the store via the `useTimeLineChartStore` hook.
 */

import { autorun } from "mobx";
// Store
import type { RootStore } from "@/plane-web/store/root.store";
import { BaseTimeLineStore } from "@/plane-web/store/timeline/base-timeline.store";
import type { IBaseTimelineStore } from "@/plane-web/store/timeline/base-timeline.store";

export interface IModulesTimeLineStore extends IBaseTimelineStore {
  isDependencyEnabled: boolean;
}

export class ModulesTimeLineStore extends BaseTimeLineStore implements IModulesTimeLineStore {
  constructor(_rootStore: RootStore) {
    super(_rootStore);

    autorun(() => {
      const getModuleById = this.rootStore.module.getModuleById;
      this.updateBlocks(getModuleById);
    });
  }
}
