/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issues-domain timeline (Gantt) store adapter — wires the issues data slice into the
 * shared `BaseTimeLineStore` so the Gantt chart can render issue rows alongside the
 * parallel `ModulesTimeLineStore`.
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
 *   - `isDependencyEnabled: boolean` — declared on `IIssuesTimeLineStore` to signal
 *     that issue rows participate in cross-block dependency logic on the Gantt chart.
 *
 * Data source:
 *   - `rootStore.issue.issues.getIssueById` — the issues lookup function consumed by
 *     the autorun. The chart adapter does not own issue data; it reads through the root
 *     store so the issues domain remains the single source of truth.
 *
 * Reactivity:
 *   - The constructor installs a MobX `autorun` that reads
 *     `this.rootStore.issue.issues.getIssueById` and forwards it to the inherited
 *     `this.updateBlocks(getIssueById)` whenever any tracked observable changes,
 *     keeping the Gantt block index in sync with the issues store.
 *
 * Consumers:
 *   - `apps/web/ce/store/timeline/index.ts` — instantiates this class as
 *     `issuesTimeLineStore` on the aggregate `TimeLineStore`.
 *   - `apps/web/ce/hooks/use-timeline-chart.ts` and
 *     `apps/web/core/hooks/use-timeline-chart.ts` — `getTimelineStore` resolves to this
 *     adapter when `timelineType === GANTT_TIMELINE_TYPE.ISSUE`.
 *   - `apps/web/core/components/issues/issue-layouts/gantt/**` — issue Gantt views
 *     (`base-gantt-root.tsx`, `blocks.tsx`) consume the store via the
 *     `useTimeLineChart`/`useTimeLineChartStore` hooks.
 *   - `apps/web/core/components/gantt-chart/**` — shared Gantt chart UI
 *     (`sidebar/issues/*`, chart helpers, block resizables) consumes the store via the
 *     `useTimeLineChartStore` hook.
 */

import { autorun } from "mobx";
// Plane-web
import type { RootStore } from "@/plane-web/store/root.store";
import type { IBaseTimelineStore } from "@/plane-web/store/timeline/base-timeline.store";
import { BaseTimeLineStore } from "@/plane-web/store/timeline/base-timeline.store";

export interface IIssuesTimeLineStore extends IBaseTimelineStore {
  isDependencyEnabled: boolean;
}

export class IssuesTimeLineStore extends BaseTimeLineStore implements IIssuesTimeLineStore {
  constructor(_rootStore: RootStore) {
    super(_rootStore);

    autorun(() => {
      const getIssueById = this.rootStore.issue.issues.getIssueById;
      this.updateBlocks(getIssueById);
    });
  }
}
