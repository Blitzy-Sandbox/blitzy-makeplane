/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace-scope notifications collection store — composes `Notification` entity wrappers
 * into the reactive list backing the workspace inbox, unread badge, and per-card UI.
 *
 * Registered on the root store as `workspaceNotification: IWorkspaceNotificationStore`
 * (see `apps/web/core/store/root.store.ts`).
 *
 * State slice:
 *   - `paginatedCount: number = 300` — constant page size used by every cursor query.
 *   - `loader: TNotificationLoader` — `ENotificationLoader` value or `undefined`. Drives
 *     `INIT_LOADER`, `PAGINATION_LOADER`, `MARK_ALL_AS_READY` UI states (observable.ref).
 *   - `unreadNotificationsCount: TUnreadNotificationsCount` — `{ total_unread_notifications_count,
 *     mention_unread_notifications_count }`. Per-tab counter; mutated by
 *     `setUnreadNotificationsCount` and zeroed by `markAllNotificationsAsRead`.
 *   - `notifications: Record<string, INotification>` — `notification_id -> Notification`
 *     instance map. Populated by `mutateNotifications` from fetched results.
 *   - `currentNotificationTab: TNotificationTab` — `ENotificationTab.ALL` by default; flips
 *     to `MENTIONS` to filter to `is_mentioned_notification` items only (observable.ref).
 *   - `currentSelectedNotificationId: string | undefined` — currently focused notification
 *     in the card list (drives the right-rail preview if any).
 *   - `paginationInfo: Omit<TNotificationPaginatedInfo, "results"> | undefined` — server-
 *     supplied cursor state (`next_cursor`, etc.) consumed by `generateNotificationQueryParams`.
 *   - `filters: TNotificationFilter` — `{ type: { assigned, created, subscribed }, snoozed,
 *     archived, read }`. The `type.*` sub-flags are joined into a CSV `type=` query param;
 *     `snoozed` / `archived` mutate the `notificationIdsByWorkspaceId` filter result; `read`
 *     is intentionally squashed to `false | undefined` at query time (see inline NOTE on
 *     line 205-206 about the all-read-and-unread-together UX decision).
 *
 * Computed (`computedFn` from `mobx-utils`):
 *   - `notificationIdsByWorkspaceId(workspaceId)` — returns the ordered list of notification
 *     ids belonging to `workspaceId`, sorted by `created_at` descending (via `convertToEpoch`),
 *     filtered by the active tab (MENTIONS vs. ALL) and the archived/snoozed flags. Recomputes
 *     when `notifications`, `currentNotificationTab`, or `filters` change, or when the input
 *     `workspaceId` differs from the last memoized key.
 *   - `notificationLiteByNotificationId(notificationId)` — returns a compact
 *     `TNotificationLite` projection `{ workspace_slug, project_id, notification_id, issue_id,
 *     is_inbox_issue }` for the routing layer. Recomputes when the underlying notification or
 *     `store.router.workspaceSlug` changes.
 *
 * Helper functions:
 *   - `generateNotificationQueryParams(paramType)` — pure derivation from `filters`,
 *     `paginatedCount`, `paginationInfo`, and `currentNotificationTab`. Returns the
 *     `TNotificationPaginatedInfoQueryParams` payload for the API. `paramType=INIT|CURRENT`
 *     resets the cursor to `paginatedCount:0:0`; `paramType=NEXT` uses `paginationInfo.next_cursor`.
 *
 * Helper actions (synchronous, `@action`):
 *   - `mutateNotifications(notifications)` — for each `TNotification`, either calls
 *     `existing.mutateNotification(payload)` if the id is already present, or constructs a
 *     new `Notification(this.store, payload)` instance keyed by id.
 *   - `updateFilters(key, value)` / `updateBulkFilters(filters)` — set the filter slice,
 *     then clear `notifications` and re-fetch with `INIT_LOADER` + `INIT` cursor when a
 *     workspace slug is available from `store.router`. This is why these are actions
 *     (mutation + side effect, not pure setters).
 *
 * Actions (`@action`, async unless noted):
 *   - `setCurrentNotificationTab(tab)` (sync) — same pattern as `updateFilters`: set tab,
 *     clear notifications, re-fetch from the cursor head.
 *   - `setCurrentSelectedNotificationId(notificationId)` (sync) — single-field setter.
 *   - `setUnreadNotificationsCount(type, newCount=1)` (sync) — increments or decrements the
 *     correct counter based on `currentNotificationTab` (ALL → `total_unread_notifications_count`,
 *     MENTIONS → `mention_unread_notifications_count`). Clamps to `>= 0` via `Math.max(0, …)`.
 *   - `getUnreadNotificationsCount(workspaceSlug)` (async) — `GET` via
 *     `workspaceNotificationService.fetchUnreadNotificationsCount`; sets
 *     `unreadNotificationsCount` inside `runInAction`. Re-throws on failure.
 *   - `getNotifications(workspaceSlug, loader=INIT_LOADER, queryParamType=INIT)` (async) —
 *     sets `loader`, calls `getUnreadNotificationsCount` first, then
 *     `workspaceNotificationService.fetchNotifications(workspaceSlug, queryParams)`; merges
 *     `results` via `mutateNotifications` and stores `paginationInfo` from the response.
 *     Always clears `loader` in `finally`. Re-throws on failure.
 *   - `markAllNotificationsAsRead(workspaceSlug)` (async) — sets `loader =
 *     ENotificationLoader.MARK_ALL_AS_READY`, calls
 *     `workspaceNotificationService.markAllNotificationsAsRead(workspaceSlug, params)`,
 *     zeros the active tab's unread counter, and bulk-mutates every notification's `read_at`
 *     to `new Date().toUTCString()` inside `runInAction`. Re-throws on failure.
 *
 * Consumers (read this store via `useWorkspaceNotifications` from
 * `@/hooks/store/notifications`):
 *   - `apps/web/core/components/workspace-notifications/root.tsx` — top-level inbox container.
 *   - `apps/web/core/components/workspace-notifications/notification-app-sidebar-option.tsx` —
 *     sidebar bell + unread badge; reads `unreadNotificationsCount` and calls
 *     `getUnreadNotificationsCount`.
 *   - `apps/web/core/components/workspace-notifications/sidebar/root.tsx`,
 *     `sidebar/header/options/root.tsx`, `sidebar/header/options/menu-option/root.tsx`,
 *     `sidebar/filters/applied-filter.tsx`, `sidebar/filters/menu/menu-option-item.tsx` —
 *     sidebar shell, filter menu, applied-filter chips.
 *   - `apps/web/core/components/workspace-notifications/sidebar/notification-card/item.tsx`
 *     and its `options/{read, archive, snooze}.tsx` — per-card selection, read/archive/snooze
 *     buttons (the card mostly proxies to the `Notification` entity actions, but reads
 *     `currentSelectedNotificationId` and calls `setCurrentSelectedNotificationId` here).
 *   - `apps/web/core/hooks/store/notifications/use-notification.ts` — id-to-instance lookup
 *     into `this.notifications`.
 *
 * Async infrastructure: All persistence flows through `workspaceNotificationService` (REST
 * against `apps/api`). This store is purely client-side; server-side Celery routing to
 * RabbitMQ for downstream notification fan-out is owned by the Django views called by the
 * service layer (architectural context per AAP §0.2.2).
 */

import { orderBy, isEmpty, update, set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import type { TNotificationTab } from "@plane/constants";
import { ENotificationTab, ENotificationLoader, ENotificationQueryParamType } from "@plane/constants";
import type {
  TNotification,
  TNotificationFilter,
  TNotificationLite,
  TNotificationPaginatedInfo,
  TNotificationPaginatedInfoQueryParams,
  TUnreadNotificationsCount,
} from "@plane/types";
// helpers
import { convertToEpoch } from "@plane/utils";
// services
import workspaceNotificationService from "@/services/workspace-notification.service";
// store
import type { INotification } from "@/store/notifications/notification";
import { Notification } from "@/store/notifications/notification";
import type { CoreRootStore } from "@/store/root.store";

type TNotificationLoader = ENotificationLoader | undefined;
type TNotificationQueryParamType = ENotificationQueryParamType;

export interface IWorkspaceNotificationStore {
  // observables
  loader: TNotificationLoader;
  unreadNotificationsCount: TUnreadNotificationsCount;
  notifications: Record<string, INotification>; // notification_id -> notification
  currentNotificationTab: TNotificationTab;
  currentSelectedNotificationId: string | undefined;
  paginationInfo: Omit<TNotificationPaginatedInfo, "results"> | undefined;
  filters: TNotificationFilter;
  // computed
  // computed functions
  notificationIdsByWorkspaceId: (workspaceId: string) => string[] | undefined;
  notificationLiteByNotificationId: (notificationId: string | undefined) => TNotificationLite;
  // helper actions
  mutateNotifications: (notifications: TNotification[]) => void;
  updateFilters: <T extends keyof TNotificationFilter>(key: T, value: TNotificationFilter[T]) => void;
  updateBulkFilters: (filters: Partial<TNotificationFilter>) => void;
  // actions
  setCurrentNotificationTab: (tab: TNotificationTab) => void;
  setCurrentSelectedNotificationId: (notificationId: string | undefined) => void;
  setUnreadNotificationsCount: (type: "increment" | "decrement", newCount?: number) => void;
  getUnreadNotificationsCount: (workspaceSlug: string) => Promise<TUnreadNotificationsCount | undefined>;
  getNotifications: (
    workspaceSlug: string,
    loader?: TNotificationLoader,
    queryCursorType?: TNotificationQueryParamType
  ) => Promise<TNotificationPaginatedInfo | undefined>;
  markAllNotificationsAsRead: (workspaceId: string) => Promise<void>;
}

export class WorkspaceNotificationStore implements IWorkspaceNotificationStore {
  // constants
  paginatedCount = 300;
  // observables
  loader: TNotificationLoader = undefined;
  unreadNotificationsCount: TUnreadNotificationsCount = {
    total_unread_notifications_count: 0,
    mention_unread_notifications_count: 0,
  };
  notifications: Record<string, INotification> = {};
  currentNotificationTab: TNotificationTab = ENotificationTab.ALL;
  currentSelectedNotificationId: string | undefined = undefined;
  paginationInfo: Omit<TNotificationPaginatedInfo, "results"> | undefined = undefined;
  filters: TNotificationFilter = {
    type: {
      assigned: false,
      created: false,
      subscribed: false,
    },
    snoozed: false,
    archived: false,
    read: false,
  };

  constructor(protected store: CoreRootStore) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      unreadNotificationsCount: observable,
      notifications: observable,
      currentNotificationTab: observable.ref,
      currentSelectedNotificationId: observable,
      paginationInfo: observable,
      filters: observable,
      // computed
      // helper actions
      setCurrentNotificationTab: action,
      setCurrentSelectedNotificationId: action,
      setUnreadNotificationsCount: action,
      mutateNotifications: action,
      updateFilters: action,
      updateBulkFilters: action,
      // actions
      getUnreadNotificationsCount: action,
      getNotifications: action,
      markAllNotificationsAsRead: action,
    });
  }

  // computed

  // computed functions
  /**
   * @description get notification ids by workspace id
   * @param { string } workspaceId
   */
  notificationIdsByWorkspaceId = computedFn((workspaceId: string) => {
    if (!workspaceId || isEmpty(this.notifications)) return undefined;
    const workspaceNotifications = orderBy(
      Object.values(this.notifications || []),
      (n) => convertToEpoch(n.created_at),
      ["desc"]
    );
    const workspaceNotificationIds = workspaceNotifications
      .filter((n) => n.workspace === workspaceId)
      .filter((n) =>
        this.currentNotificationTab === ENotificationTab.MENTIONS
          ? n.is_mentioned_notification
          : !n.is_mentioned_notification
      )
      .filter((n) => {
        if (!this.filters.archived && !this.filters.snoozed) {
          if (n.archived_at) {
            return false;
          } else if (n.snoozed_till) {
            return false;
          } else {
            return true;
          }
        } else {
          if (this.filters.snoozed) {
            return n.snoozed_till ? true : false;
          } else if (this.filters.archived) {
            return n.archived_at ? true : false;
          } else {
            return true;
          }
        }
      })
      // .filter((n) => (this.filters.read ? (n.read_at ? true : false) : n.read_at ? false : true))
      .map((n) => n.id);
    return workspaceNotificationIds;
  });

  /**
   * @description get notification lite by notification id
   * @param { string } notificationId
   */
  notificationLiteByNotificationId = computedFn((notificationId: string | undefined) => {
    if (!notificationId) return {} as TNotificationLite;
    const { workspaceSlug } = this.store.router;
    const notification = this.notifications[notificationId];
    if (!notification || !workspaceSlug) return {} as TNotificationLite;
    return {
      workspace_slug: workspaceSlug,
      project_id: notification.project,
      notification_id: notification.id,
      issue_id: notification.data?.issue?.id,
      is_inbox_issue: notification.is_inbox_issue || false,
    };
  });

  // helper functions
  /**
   * @description generate notification query params
   * @returns { object }
   */
  generateNotificationQueryParams = (paramType: TNotificationQueryParamType): TNotificationPaginatedInfoQueryParams => {
    const queryParamsType =
      Object.entries(this.filters.type)
        .filter(([, value]) => value)
        .map(([key]) => key)
        .join(",") || undefined;

    const queryCursorNext =
      paramType === ENotificationQueryParamType.INIT
        ? `${this.paginatedCount}:0:0`
        : paramType === ENotificationQueryParamType.CURRENT
          ? `${this.paginatedCount}:${0}:0`
          : paramType === ENotificationQueryParamType.NEXT && this.paginationInfo
            ? this.paginationInfo?.next_cursor
            : `${this.paginatedCount}:${0}:0`;

    const queryParams: TNotificationPaginatedInfoQueryParams = {
      type: queryParamsType,
      snoozed: this.filters.snoozed || false,
      archived: this.filters.archived || false,
      read: undefined,
      per_page: this.paginatedCount,
      cursor: queryCursorNext,
    };

    // NOTE: This validation is required to show all the read and unread notifications in a single place it may change in future.
    queryParams.read = this.filters.read === true ? false : undefined;

    if (this.currentNotificationTab === ENotificationTab.MENTIONS) queryParams.mentioned = true;

    return queryParams;
  };

  // helper actions
  /**
   * @description mutate and validate current existing and new notifications
   * @param { TNotification[] } notifications
   */
  mutateNotifications = (notifications: TNotification[]) => {
    (notifications || []).forEach((notification) => {
      if (!notification.id) return;
      if (this.notifications[notification.id]) {
        this.notifications[notification.id].mutateNotification(notification);
      } else {
        set(this.notifications, notification.id, new Notification(this.store, notification));
      }
    });
  };

  /**
   * @description update filters
   * @param { T extends keyof TNotificationFilter } key
   * @param { TNotificationFilter[T] } value
   */
  updateFilters = <T extends keyof TNotificationFilter>(key: T, value: TNotificationFilter[T]) => {
    set(this.filters, key, value);
    const { workspaceSlug } = this.store.router;
    if (!workspaceSlug) return;

    set(this, "notifications", {});
    this.getNotifications(workspaceSlug, ENotificationLoader.INIT_LOADER, ENotificationQueryParamType.INIT);
  };

  /**
   * @description update bulk filters
   * @param { Partial<TNotificationFilter> } filters
   */
  updateBulkFilters = (filters: Partial<TNotificationFilter>) => {
    Object.entries(filters).forEach(([key, value]) => {
      set(this.filters, key, value);
    });

    const { workspaceSlug } = this.store.router;
    if (!workspaceSlug) return;

    set(this, "notifications", {});
    this.getNotifications(workspaceSlug, ENotificationLoader.INIT_LOADER, ENotificationQueryParamType.INIT);
  };

  // actions
  /**
   * @description set notification tab
   * @returns { void }
   */
  setCurrentNotificationTab = (tab: TNotificationTab): void => {
    set(this, "currentNotificationTab", tab);

    const { workspaceSlug } = this.store.router;
    if (!workspaceSlug) return;

    set(this, "notifications", {});
    this.getNotifications(workspaceSlug, ENotificationLoader.INIT_LOADER, ENotificationQueryParamType.INIT);
  };

  /**
   * @description set current selected notification
   * @param { string | undefined } notificationId
   * @returns { void }
   */
  setCurrentSelectedNotificationId = (notificationId: string | undefined): void => {
    set(this, "currentSelectedNotificationId", notificationId);
  };

  /**
   * @description set unread notifications count
   * @param { "increment" | "decrement" } type
   * @returns { void }
   */
  setUnreadNotificationsCount = (type: "increment" | "decrement", newCount: number = 1): void => {
    const validCount = Math.max(0, Math.abs(newCount));

    switch (this.currentNotificationTab) {
      case ENotificationTab.ALL:
        update(
          this.unreadNotificationsCount,
          "total_unread_notifications_count",
          (count: number) => +Math.max(0, type === "increment" ? count + validCount : count - validCount)
        );
        break;
      case ENotificationTab.MENTIONS:
        update(
          this.unreadNotificationsCount,
          "mention_unread_notifications_count",
          (count: number) => +Math.max(0, type === "increment" ? count + validCount : count - validCount)
        );
        break;
      default:
        break;
    }
  };

  /**
   * @description get unread notifications count
   * @param { string } workspaceSlug,
   * @param { TNotificationQueryParamType } queryCursorType,
   * @returns { number | undefined }
   */
  getUnreadNotificationsCount = async (workspaceSlug: string): Promise<TUnreadNotificationsCount | undefined> => {
    try {
      const unreadNotificationCount = await workspaceNotificationService.fetchUnreadNotificationsCount(workspaceSlug);
      if (unreadNotificationCount)
        runInAction(() => {
          set(this, "unreadNotificationsCount", unreadNotificationCount);
        });
      return unreadNotificationCount || undefined;
    } catch (error) {
      console.error("WorkspaceNotificationStore -> getUnreadNotificationsCount -> error", error);
      throw error;
    }
  };

  /**
   * @description get all workspace notification
   * @param { string } workspaceSlug,
   * @param { TNotificationLoader } loader,
   * @returns { TNotification | undefined }
   */
  getNotifications = async (
    workspaceSlug: string,
    loader: TNotificationLoader = ENotificationLoader.INIT_LOADER,
    queryParamType: TNotificationQueryParamType = ENotificationQueryParamType.INIT
  ): Promise<TNotificationPaginatedInfo | undefined> => {
    this.loader = loader;
    try {
      const queryParams = this.generateNotificationQueryParams(queryParamType);
      await this.getUnreadNotificationsCount(workspaceSlug);
      const notificationResponse = await workspaceNotificationService.fetchNotifications(workspaceSlug, queryParams);
      if (notificationResponse) {
        const { results, ...paginationInfo } = notificationResponse;
        runInAction(() => {
          if (results) {
            this.mutateNotifications(results);
          }
          set(this, "paginationInfo", paginationInfo);
        });
      }
      return notificationResponse;
    } catch (error) {
      console.error("WorkspaceNotificationStore -> getNotifications -> error", error);
      throw error;
    } finally {
      runInAction(() => (this.loader = undefined));
    }
  };

  /**
   * @description mark all notifications as read
   * @param { string } workspaceSlug,
   * @returns { void }
   */
  markAllNotificationsAsRead = async (workspaceSlug: string): Promise<void> => {
    try {
      this.loader = ENotificationLoader.MARK_ALL_AS_READY;
      const queryParams = this.generateNotificationQueryParams(ENotificationQueryParamType.INIT);
      const params = {
        type: queryParams.type,
        snoozed: queryParams.snoozed,
        archived: queryParams.archived,
        read: queryParams.read,
      };
      await workspaceNotificationService.markAllNotificationsAsRead(workspaceSlug, params);
      runInAction(() => {
        update(
          this.unreadNotificationsCount,
          this.currentNotificationTab === ENotificationTab.ALL
            ? "total_unread_notifications_count"
            : "mention_unread_notifications_count",
          () => 0
        );
        Object.values(this.notifications).forEach((notification) =>
          notification.mutateNotification({
            read_at: new Date().toUTCString(),
          })
        );
      });
    } catch (error) {
      console.error("WorkspaceNotificationStore -> markAllNotificationsAsRead -> error", error);
      throw error;
    } finally {
      runInAction(() => (this.loader = undefined));
    }
  };
}
