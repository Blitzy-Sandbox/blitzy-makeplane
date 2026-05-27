/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Home dashboard store: hydrates widget configurations, caches per-widget stats,
 * and applies optimistic widget/filter updates for the workspace home page.
 *
 * State slice:
 *   - homeDashboardId: string | null — id of the active workspace's home dashboard
 *   - widgetDetails: { [workspaceSlug]: { [dashboardId]: TWidget[] } } — per-dashboard
 *     widget configurations (filters live on each TWidget under widget_filters)
 *   - widgetStats: { [workspaceSlug]: { [dashboardId]: { [widgetKey]: TWidgetStatsResponse } } }
 *     — per-widget stats payloads, keyed by widget key
 *   - widgetStatsError: { [workspaceSlug]: { [dashboardId]: { [widgetKey]: any | null } } }
 *     — last fetch error per widget, paired one-to-one with widgetStats
 *
 * Actions:
 *   - fetchHomeDashboardWidgets(workspaceSlug) → DashboardService.getHomeDashboardWidgets
 *       Side effects: sets homeDashboardId and widgetDetails[ws][dashboardId]; clears
 *       homeDashboardId to null on failure and re-throws so callers can surface the error.
 *   - fetchWidgetStats(workspaceSlug, dashboardId, params) → DashboardService.getWidgetStats
 *       Side effects: when the response carries issues, forwards them into
 *       rootStore.issue.issues.addIssue so widget-rendered issue lists share the global
 *       issue cache rather than holding a detached copy; sets widgetStats[ws][dash][key]
 *       and clears the paired widgetStatsError slot; on failure records the error and
 *       re-throws.
 *   - updateDashboardWidget(workspaceSlug, dashboardId, widgetId, data) →
 *     DashboardService.updateDashboardWidget
 *       Side effects: optimistic merge into widgetDetails[ws][dash][widgetIndex] before
 *       the network call; reverts to the pre-call snapshot on error.
 *   - updateDashboardWidgetFilters(workspaceSlug, dashboardId, widgetId, data) — delegates
 *     to updateDashboardWidget after optimistically merging data.filters into the
 *     widget's widget_filters; reverts the optimistic mutation on error.
 *
 * Computed:
 *   - homeDashboardWidgets — TWidget[] for the active workspace's home dashboard;
 *     recomputes when routerStore.workspaceSlug, homeDashboardId, or widgetDetails change.
 *
 * Computed lookups (mobx-utils computedFn / arrow getters):
 *   - getWidgetDetails(workspaceSlug, dashboardId, widgetKey) — memoised single-widget
 *     lookup from widgetDetails; uses computedFn so identical argument tuples reuse the
 *     same computed cell.
 *   - getWidgetStats<T>(workspaceSlug, dashboardId, widgetKey) — typed accessor into
 *     widgetStats; callers supply the expected payload shape T.
 *   - getWidgetStatsError(workspaceSlug, dashboardId, widgetKey) — accessor into
 *     widgetStatsError returning null when no error is recorded.
 *
 * Cross-store wiring (constructor-injected from CoreRootStore):
 *   - rootStore.router → routerStore — read for workspaceSlug inside the
 *     homeDashboardWidgets computed.
 *   - rootStore.issue.issues → issueStore — receives forwarded issues from widget stats
 *     responses so a single shared issue cache backs both the issues domain and any
 *     dashboard widget that renders issue data.
 *
 * Consumers:
 *   - apps/web/core/hooks/store/use-dashboard.ts (React hook entrypoint exposing
 *     IDashboardStore via the StoreContext provider)
 *   - apps/web/core/components/home/** (workspace home widgets that surface dashboard
 *     data through the useDashboard hook)
 */

import { set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type {
  THomeDashboardResponse,
  TWidget,
  TWidgetFiltersFormData,
  TWidgetStatsResponse,
  TWidgetKeys,
  TWidgetStatsRequestParams,
} from "@plane/types";
// services
import { DashboardService } from "@/services/dashboard.service";
// plane web store
import type { CoreRootStore } from "./root.store";

export interface IDashboardStore {
  // error states
  widgetStatsError: { [workspaceSlug: string]: Record<string, Record<TWidgetKeys, any | null>> };
  // observables
  homeDashboardId: string | null;
  widgetDetails: { [workspaceSlug: string]: Record<string, TWidget[]> };
  // {
  //  workspaceSlug: {
  //    dashboardId: TWidget[]
  //   }
  // }
  widgetStats: { [workspaceSlug: string]: Record<string, Record<TWidgetKeys, TWidgetStatsResponse>> };
  //  {
  //    workspaceSlug: {
  //      dashboardId: {
  //        widgetKey: TWidgetStatsResponse;
  //        }
  //     }
  //  }
  // computed
  homeDashboardWidgets: TWidget[] | undefined;
  // computed actions
  getWidgetDetails: (workspaceSlug: string, dashboardId: string, widgetKey: TWidgetKeys) => TWidget | undefined;
  getWidgetStats: <T>(workspaceSlug: string, dashboardId: string, widgetKey: TWidgetKeys) => T | undefined;
  getWidgetStatsError: (workspaceSlug: string, dashboardId: string, widgetKey: TWidgetKeys) => any | null;
  // actions
  fetchHomeDashboardWidgets: (workspaceSlug: string) => Promise<THomeDashboardResponse>;
  fetchWidgetStats: (
    workspaceSlug: string,
    dashboardId: string,
    params: TWidgetStatsRequestParams
  ) => Promise<TWidgetStatsResponse>;
  updateDashboardWidget: (
    workspaceSlug: string,
    dashboardId: string,
    widgetId: string,
    data: Partial<TWidget>
  ) => Promise<any>;
  updateDashboardWidgetFilters: (
    workspaceSlug: string,
    dashboardId: string,
    widgetId: string,
    data: TWidgetFiltersFormData
  ) => Promise<any>;
}

export class DashboardStore implements IDashboardStore {
  // error states
  widgetStatsError: { [workspaceSlug: string]: Record<string, Record<TWidgetKeys, any>> } = {};
  // observables
  homeDashboardId: string | null = null;
  widgetDetails: { [workspaceSlug: string]: Record<string, TWidget[]> } = {};
  widgetStats: { [workspaceSlug: string]: Record<string, Record<TWidgetKeys, TWidgetStatsResponse>> } = {};
  // stores
  routerStore;
  issueStore;
  // services
  dashboardService;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      // error states
      widgetStatsError: observable,
      // observables
      homeDashboardId: observable.ref,
      widgetDetails: observable,
      widgetStats: observable,
      // computed
      homeDashboardWidgets: computed,
      // fetch actions
      fetchHomeDashboardWidgets: action,
      fetchWidgetStats: action,
      // update actions
      updateDashboardWidget: action,
      updateDashboardWidgetFilters: action,
    });

    // router store
    this.routerStore = _rootStore.router;
    this.issueStore = _rootStore.issue.issues;
    // services
    this.dashboardService = new DashboardService();
  }

  /**
   * @description get home dashboard widgets
   * @returns {TWidget[] | undefined}
   */
  get homeDashboardWidgets() {
    const workspaceSlug = this.routerStore.workspaceSlug;
    if (!workspaceSlug) return undefined;
    const { homeDashboardId, widgetDetails } = this;
    return homeDashboardId ? widgetDetails?.[workspaceSlug]?.[homeDashboardId] : undefined;
  }

  /**
   * @description get widget details
   * @param {string} workspaceSlug
   * @param {string} dashboardId
   * @param {TWidgetKeys} widgetKey
   * @returns {TWidget | undefined}
   */
  getWidgetDetails = computedFn((workspaceSlug: string, dashboardId: string, widgetKey: TWidgetKeys) => {
    const widgets = this.widgetDetails?.[workspaceSlug]?.[dashboardId];
    if (!widgets) return undefined;
    return widgets.find((widget) => widget.key === widgetKey);
  });

  /**
   * @description get widget stats
   * @param {string} workspaceSlug
   * @param {string} dashboardId
   * @param {TWidgetKeys} widgetKey
   * @returns {T | undefined}
   */
  getWidgetStats = <T>(workspaceSlug: string, dashboardId: string, widgetKey: TWidgetKeys): T | undefined =>
    (this.widgetStats?.[workspaceSlug]?.[dashboardId]?.[widgetKey] as unknown as T) ?? undefined;

  /**
   * @description get widget stats error
   * @param {string} workspaceSlug
   * @param {string} dashboardId
   * @param {TWidgetKeys} widgetKey
   * @returns {any | null}
   */
  getWidgetStatsError = (workspaceSlug: string, dashboardId: string, widgetKey: TWidgetKeys) =>
    this.widgetStatsError?.[workspaceSlug]?.[dashboardId]?.[widgetKey] ?? null;

  /**
   * @description fetch home dashboard details and widgets
   * @param {string} workspaceSlug
   * @returns {Promise<THomeDashboardResponse>}
   */
  fetchHomeDashboardWidgets = async (workspaceSlug: string): Promise<THomeDashboardResponse> => {
    try {
      const response = await this.dashboardService.getHomeDashboardWidgets(workspaceSlug);

      runInAction(() => {
        this.homeDashboardId = response.dashboard.id;
        set(this.widgetDetails, [workspaceSlug, response.dashboard.id], response.widgets);
      });

      return response;
    } catch (error) {
      runInAction(() => {
        this.homeDashboardId = null;
      });

      throw error;
    }
  };

  /**
   * @description fetch widget stats
   * @param {string} workspaceSlug
   * @param {string} dashboardId
   * @param {TWidgetStatsRequestParams} widgetKey
   * @returns widget stats
   */
  fetchWidgetStats = async (workspaceSlug: string, dashboardId: string, params: TWidgetStatsRequestParams) =>
    this.dashboardService
      .getWidgetStats(workspaceSlug, dashboardId, params)
      .then((res: any) => {
        runInAction(() => {
          if (res.issues) this.issueStore.addIssue(res.issues);
          set(this.widgetStats, [workspaceSlug, dashboardId, params.widget_key], res);
          set(this.widgetStatsError, [workspaceSlug, dashboardId, params.widget_key], null);
        });
        return res;
      })
      .catch((error) => {
        runInAction(() => {
          set(this.widgetStatsError, [workspaceSlug, dashboardId, params.widget_key], error);
        });

        throw error;
      });

  /**
   * @description update dashboard widget
   * @param {string} dashboardId
   * @param {string} widgetId
   * @param {Partial<TWidget>} data
   * @returns updated widget
   */
  updateDashboardWidget = async (
    workspaceSlug: string,
    dashboardId: string,
    widgetId: string,
    data: Partial<TWidget>
  ): Promise<any> => {
    // find all widgets in dashboard
    const widgets = this.widgetDetails?.[workspaceSlug]?.[dashboardId];
    if (!widgets) throw new Error("Dashboard not found");
    // find widget index
    const widgetIndex = widgets.findIndex((widget) => widget.id === widgetId);
    // get original widget
    const originalWidget = { ...widgets[widgetIndex] };
    if (widgetIndex === -1) throw new Error("Widget not found");

    try {
      runInAction(() => {
        this.widgetDetails[workspaceSlug][dashboardId][widgetIndex] = {
          ...widgets[widgetIndex],
          ...data,
        };
      });
      const response = await this.dashboardService.updateDashboardWidget(dashboardId, widgetId, data);
      return response;
    } catch (error) {
      // revert changes
      runInAction(() => {
        this.widgetDetails[workspaceSlug][dashboardId][widgetIndex] = originalWidget;
      });
      throw error;
    }
  };

  /**
   * @description update dashboard widget filters
   * @param {string} dashboardId
   * @param {string} widgetId
   * @param {TWidgetFiltersFormData} data
   * @returns updated widget
   */
  updateDashboardWidgetFilters = async (
    workspaceSlug: string,
    dashboardId: string,
    widgetId: string,
    data: TWidgetFiltersFormData
  ): Promise<TWidget> => {
    const widgetDetails = this.getWidgetDetails(workspaceSlug, dashboardId, data.widgetKey);
    if (!widgetDetails) throw new Error("Widget not found");
    try {
      const updatedWidget = {
        ...widgetDetails,
        widget_filters: {
          ...widgetDetails.widget_filters,
          ...data.filters,
        },
      };
      // update widget details optimistically
      runInAction(() => {
        set(
          this.widgetDetails,
          [workspaceSlug, dashboardId],
          this.widgetDetails?.[workspaceSlug]?.[dashboardId]?.map((w) => (w.id === widgetId ? updatedWidget : w))
        );
      });
      const response = await this.updateDashboardWidget(workspaceSlug, dashboardId, widgetId, {
        filters: {
          ...widgetDetails.widget_filters,
          ...data.filters,
        },
      }).then((res) => res);

      return response;
    } catch (error) {
      // revert changes
      runInAction(() => {
        this.widgetDetails[workspaceSlug][dashboardId] = this.widgetDetails?.[workspaceSlug]?.[dashboardId]?.map((w) =>
          w.id === widgetId ? widgetDetails : w
        );
      });
      throw error;
    }
  };
}
