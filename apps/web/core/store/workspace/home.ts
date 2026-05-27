/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for workspace home dashboard widget configuration and quick-link composition.
 *
 * Workspace-scoped: persists user-configurable home page widget visibility
 * and ordering through `WorkspaceService.fetchWorkspaceWidgets` /
 * `updateWorkspaceWidget`. Distinct from the top-level
 * `apps/web/core/store/dashboard.store.ts`, which models read-only
 * project/global dashboards (issue distribution, recent activity, etc.) —
 * a separate domain, service surface, and consumer set.
 *
 * State slice (observables):
 *  - `loading: boolean` — true while `fetchWidgets` is in flight.
 *  - `showWidgetSettings: boolean` — UI flag for the widget settings panel,
 *    toggled via `toggleWidgetSettings`.
 *  - `widgetsMap: Record<string, TWidgetEntityData>` — widget entries keyed
 *    by widget key (`@plane/types`).
 *  - `widgets: THomeWidgetKeys[]` — ordered widget-key list materialized from
 *    `sort_order` at fetch time (the first-paint render order).
 *
 * Sub-store composition:
 *  - `quickLinks: IWorkspaceLinkStore` — a `WorkspaceLinkStore` constructed
 *    in the constructor; gives the home dashboard its own scoped link store
 *    for managing user quick-links independently of any other workspace link
 *    surface.
 *
 * Computed:
 *  - `isAnyWidgetEnabled` — true when any entry in `widgetsMap` has
 *    `is_enabled === true`. Recomputes when `widgetsMap` changes.
 *  - `orderedWidgets` — `widgetsMap` values sorted by `sort_order` descending,
 *    projected to widget keys. Recomputes when `widgetsMap` changes; used as
 *    the live render order after mutations (vs. the snapshot held in
 *    `widgets`).
 *
 * Actions:
 *  - `toggleWidgetSettings(value?: boolean)` — synchronous state mutation
 *    only; no API call. Sets to `value` when provided, otherwise flips the
 *    current value.
 *  - `fetchWidgets(workspaceSlug)` — GET via
 *    `WorkspaceService.fetchWorkspaceWidgets`; hydrates `widgets` (ordered
 *    keys) and `widgetsMap` (entries by key) inside `runInAction`. Sets and
 *    clears `loading`; logs and re-throws on error.
 *  - `toggleWidget(workspaceSlug, widgetKey, is_enabled)` — PATCH via
 *    `WorkspaceService.updateWorkspaceWidget`, then writes
 *    `widgetsMap[widgetKey].is_enabled` on success. No rollback is required
 *    because state is not optimistically mutated before the API call.
 *    Re-throws on error.
 *  - `reorderWidget(workspaceSlug, widgetKey, destinationId, edge)` —
 *    optimistic drag-and-drop reorder. Computes a `resultSequence`
 *    `sort_order` as the midpoint between the destination's `sort_order` and
 *    its previous sibling (for `reorder-above` with a prev) or as
 *    `destinationSequence ± 10000` for boundary cases. This midpoint-
 *    interleaving keeps sibling `sort_order`s stable so the backend never
 *    has to renumber on every move. Optimistically writes the new
 *    `sort_order` into `widgetsMap`, then PATCHes. ROLLBACK: a
 *    `sortOrderBeforeUpdate` snapshot captured before mutation is restored
 *    via `set(...)` on error before re-throwing.
 *
 * Wiring:
 *  - Composed as `home` on `BaseWorkspaceRootStore`
 *    (`apps/web/core/store/workspace/index.ts`) and accessed in components
 *    via the `useHome()` hook (`apps/web/core/hooks/store/use-home.ts`).
 *
 * Consumer components:
 *  - `apps/web/core/components/home/root.tsx`,
 *    `apps/web/core/components/home/home-dashboard-widgets.tsx`, and the
 *    widget management UIs under
 *    `apps/web/core/components/home/widgets/manage/` (`widget-item.tsx`,
 *    `widget-list.tsx`).
 *  - `apps/web/core/components/home/widgets/links/**`
 *    (`link-detail.tsx`, `root.tsx`, `links.tsx`, `use-links.tsx`) — consume
 *    the composed `home.quickLinks` sub-store specifically.
 */

import { orderBy, clone, set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
// plane imports
import type { THomeWidgetKeys, TWidgetEntityData } from "@plane/types";
// plane web services
import { WorkspaceService } from "@/services/workspace.service";
// store
import type { IWorkspaceLinkStore } from "./link.store";
import { WorkspaceLinkStore } from "./link.store";

export interface IHomeStore {
  // observables
  loading: boolean;
  showWidgetSettings: boolean;
  widgetsMap: Record<string, TWidgetEntityData>;
  widgets: THomeWidgetKeys[];
  // computed
  isAnyWidgetEnabled: boolean;
  orderedWidgets: THomeWidgetKeys[];
  //stores
  quickLinks: IWorkspaceLinkStore;
  // actions
  toggleWidgetSettings: (value?: boolean) => void;
  fetchWidgets: (workspaceSlug: string) => Promise<void>;
  reorderWidget: (
    workspaceSlug: string,
    widgetKey: string,
    destinationId: string,
    edge: string | undefined
  ) => Promise<void>;
  toggleWidget: (workspaceSlug: string, widgetKey: string, is_enabled: boolean) => void;
}

export class HomeStore implements IHomeStore {
  // observables
  showWidgetSettings = false;
  loading = false;
  widgetsMap: Record<string, TWidgetEntityData> = {};
  widgets: THomeWidgetKeys[] = [];
  // stores
  quickLinks: IWorkspaceLinkStore;
  // services
  workspaceService: WorkspaceService;

  constructor() {
    makeObservable(this, {
      // observables
      loading: observable,
      showWidgetSettings: observable,
      widgetsMap: observable,
      widgets: observable,
      // computed
      isAnyWidgetEnabled: computed,
      orderedWidgets: computed,
      // actions
      toggleWidgetSettings: action,
      fetchWidgets: action,
      reorderWidget: action,
      toggleWidget: action,
    });
    // services
    this.workspaceService = new WorkspaceService();

    // stores
    this.quickLinks = new WorkspaceLinkStore();
  }

  get isAnyWidgetEnabled() {
    return Object.values(this.widgetsMap).some((widget) => widget.is_enabled);
  }

  get orderedWidgets() {
    return orderBy(Object.values(this.widgetsMap), "sort_order", "desc").map((widget) => widget.key);
  }

  toggleWidgetSettings = (value?: boolean) => {
    this.showWidgetSettings = value !== undefined ? value : !this.showWidgetSettings;
  };

  fetchWidgets = async (workspaceSlug: string) => {
    try {
      this.loading = true;
      const widgets = await this.workspaceService.fetchWorkspaceWidgets(workspaceSlug);
      runInAction(() => {
        this.widgets = orderBy(Object.values(widgets), "sort_order", "desc").map((widget) => widget.key);
        widgets.forEach((widget) => {
          this.widgetsMap[widget.key] = widget;
        });
        this.loading = false;
      });
    } catch (error) {
      console.error("Failed to fetch widgets");
      this.loading = false;
      throw error;
    }
  };

  toggleWidget = async (workspaceSlug: string, widgetKey: string, is_enabled: boolean) => {
    try {
      await this.workspaceService.updateWorkspaceWidget(workspaceSlug, widgetKey, {
        is_enabled,
      });
      runInAction(() => {
        this.widgetsMap[widgetKey].is_enabled = is_enabled;
      });
    } catch (error) {
      console.error("Failed to toggle widget");
      throw error;
    }
  };

  reorderWidget = async (workspaceSlug: string, widgetKey: string, destinationId: string, edge: string | undefined) => {
    const sortOrderBeforeUpdate = clone(this.widgetsMap[widgetKey]?.sort_order);
    try {
      let resultSequence = 10000;
      if (edge) {
        const sortedIds = orderBy(Object.values(this.widgetsMap), "sort_order", "desc").map((widget) => widget.key);
        const destinationSequence = this.widgetsMap[destinationId]?.sort_order || undefined;
        if (destinationSequence) {
          const destinationIndex = sortedIds.findIndex((id) => id === destinationId);
          if (edge === "reorder-above") {
            const prevSequence = this.widgetsMap[sortedIds[destinationIndex - 1]]?.sort_order || undefined;
            if (prevSequence) {
              resultSequence = (destinationSequence + prevSequence) / 2;
            } else {
              resultSequence = destinationSequence + resultSequence;
            }
          } else {
            resultSequence = destinationSequence - resultSequence;
          }
        }
      }
      runInAction(() => {
        set(this.widgetsMap, [widgetKey, "sort_order"], resultSequence);
      });
      await this.workspaceService.updateWorkspaceWidget(workspaceSlug, widgetKey, {
        sort_order: resultSequence,
      });
    } catch (error) {
      console.error("Failed to move widget");
      runInAction(() => {
        set(this.widgetsMap, [widgetKey, "sort_order"], sortOrderBeforeUpdate);
      });
      throw error;
    }
  };
}
