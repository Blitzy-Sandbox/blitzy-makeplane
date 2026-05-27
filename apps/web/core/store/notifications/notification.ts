/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Single-notification entity wrapper used inside the workspace-scope notifications collection.
 *
 * This module exports the `INotification` interface and the `Notification` class. Each
 * `Notification` instance wraps a server-provided `TNotification` record from `@plane/types`
 * as a MobX-observable so the notification card / sidebar UI re-renders when individual
 * notification state transitions (read, unread, archived, snoozed) are applied.
 *
 * State slice (observable fields hydrated from the TNotification payload in the constructor):
 *   - `id: string` — primary key (observable.ref).
 *   - `title: string | undefined` — short summary line rendered on the notification card.
 *   - `data: TNotificationData | undefined` — structured payload (issue, comment, etc.) used
 *     by the card body and by `notificationLiteByNotificationId` in the parent store.
 *   - `entity_identifier`, `entity_name: string | undefined` — pointer to the entity that
 *     triggered the notification (e.g. an Issue id + "issue").
 *   - `message_html: string | undefined` plus the `message`, `message_stripped` undefined
 *     placeholders preserved on the type for API parity.
 *   - `sender`, `receiver`, `triggered_by: string | undefined` and
 *     `triggered_by_details: IUserLite | undefined` — actor metadata.
 *   - `read_at`, `archived_at`, `snoozed_till: string | undefined` — ISO timestamps that
 *     drive the read / archived / snoozed boolean filters in the parent store.
 *   - `is_inbox_issue`, `is_mentioned_notification: boolean | undefined` — discriminants
 *     consumed by the MENTIONS tab filter and the inbox-issue routing logic.
 *   - `workspace`, `project: string | undefined` — owning workspace id and project id.
 *   - `created_at`, `updated_at`, `created_by`, `updated_by: string | undefined` — audit
 *     timestamps and user ids.
 *
 * Computed:
 *   - `asJson` — recomputes a plain `TNotification` snapshot of the observable fields. It
 *     re-evaluates whenever any of the wrapped observable fields change. Consumers that
 *     need a non-reactive value (logging, serialization, prop drilling outside MobX) read
 *     this rather than the instance itself.
 *
 * Helper (non-action):
 *   - `mutateNotification(partial)` — applies a `Partial<TNotification>` to the instance
 *     using `lodash-es` `set`, used by the parent `WorkspaceNotificationStore` to absorb
 *     fetched payloads and by every action's optimistic update + rollback paths.
 *
 * Actions (all `@action`, all returning `Promise<TNotification | undefined>`):
 *   - `updateNotification(workspaceSlug, payload)` — `PATCH` via
 *     `workspaceNotificationService.updateNotificationById`; on success, merges the returned
 *     notification back into local state inside `runInAction`. Re-throws on failure.
 *   - `markNotificationAsRead(workspaceSlug)` — sets `read_at = new Date().toISOString()`
 *     optimistically, decrements the parent store's unread counter via
 *     `store.workspaceNotification.setUnreadNotificationsCount("decrement")`, then calls
 *     `workspaceNotificationService.markNotificationAsRead`. On error, restores the previous
 *     `read_at` AND increments the unread counter back. Non-idempotent in that the unread
 *     counter is adjusted unconditionally on each call.
 *   - `markNotificationAsUnRead(workspaceSlug)` — inverse of the above; sets `read_at` to
 *     `undefined`, increments the unread counter, calls
 *     `workspaceNotificationService.markNotificationAsUnread`, and rolls back on failure.
 *   - `archiveNotification(workspaceSlug)` — sets `archived_at` to now, calls
 *     `workspaceNotificationService.markNotificationAsArchived`, rolls back on failure.
 *     Does NOT touch the unread counter (archived notifications keep their read state).
 *   - `unArchiveNotification(workspaceSlug)` — sets `archived_at = undefined`, calls
 *     `workspaceNotificationService.markNotificationAsUnArchived`, rolls back on failure.
 *   - `snoozeNotification(workspaceSlug, snoozeTill)` — sets `snoozed_till` to the supplied
 *     `Date.toISOString()` and PATCHes via `updateNotificationById`. Rolls back on failure.
 *   - `unSnoozeNotification(workspaceSlug)` — sets `snoozed_till = undefined` and PATCHes
 *     via `updateNotificationById`. Rolls back on failure.
 *
 * Consumers:
 *   - `apps/web/core/store/notifications/workspace-notifications.store.ts`
 *     (`mutateNotifications` creates / updates `Notification` instances inside the
 *     workspace-scope `notifications` map and the `markAllNotificationsAsRead` action
 *     bulk-mutates them).
 *   - `apps/web/core/hooks/store/notifications/use-notification.ts`
 *     (returns the per-id `Notification` instance from
 *     `context.workspaceNotification.notifications[notificationId]`).
 *   - `apps/web/core/components/workspace-notifications/sidebar/notification-card/**`
 *     (read / archive / snooze controls on each card invoke the actions above).
 *
 * Async infrastructure: All persistence calls go through `workspaceNotificationService`
 * (REST against `apps/api`). This file does NOT enqueue Celery tasks directly — server-side
 * Celery routing to RabbitMQ is owned by the Django views called by the service layer.
 */

/* eslint-disable no-useless-catch */
import { set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import type { IUserLite, TNotification, TNotificationData } from "@plane/types";
// services
import workspaceNotificationService from "@/services/workspace-notification.service";
// store
import type { CoreRootStore } from "../root.store";

export interface INotification extends TNotification {
  // observables
  // computed
  asJson: TNotification;
  // computed functions
  // helper functions
  mutateNotification: (notification: Partial<TNotification>) => void;
  // actions
  updateNotification: (workspaceSlug: string, payload: Partial<TNotification>) => Promise<TNotification | undefined>;
  markNotificationAsRead: (workspaceSlug: string) => Promise<TNotification | undefined>;
  markNotificationAsUnRead: (workspaceSlug: string) => Promise<TNotification | undefined>;
  archiveNotification: (workspaceSlug: string) => Promise<TNotification | undefined>;
  unArchiveNotification: (workspaceSlug: string) => Promise<TNotification | undefined>;
  snoozeNotification: (workspaceSlug: string, snoozeTill: Date) => Promise<TNotification | undefined>;
  unSnoozeNotification: (workspaceSlug: string) => Promise<TNotification | undefined>;
}

export class Notification implements INotification {
  // observables
  id: string;
  title: string | undefined = undefined;
  data: TNotificationData | undefined = undefined;
  entity_identifier: string | undefined = undefined;
  entity_name: string | undefined = undefined;
  message_html: string | undefined = undefined;
  message: undefined = undefined;
  message_stripped: undefined = undefined;
  sender: string | undefined = undefined;
  receiver: string | undefined = undefined;
  triggered_by: string | undefined = undefined;
  triggered_by_details: IUserLite | undefined = undefined;
  read_at: string | undefined = undefined;
  archived_at: string | undefined = undefined;
  snoozed_till: string | undefined = undefined;
  is_inbox_issue: boolean | undefined = undefined;
  is_mentioned_notification: boolean | undefined = undefined;
  workspace: string | undefined = undefined;
  project: string | undefined = undefined;
  created_at: string | undefined = undefined;
  updated_at: string | undefined = undefined;
  created_by: string | undefined = undefined;
  updated_by: string | undefined = undefined;

  constructor(
    private store: CoreRootStore,
    private notification: TNotification
  ) {
    this.id = this.notification.id;
    makeObservable(this, {
      // observables
      id: observable.ref,
      title: observable.ref,
      data: observable,
      entity_identifier: observable.ref,
      entity_name: observable.ref,
      message_html: observable.ref,
      message: observable.ref,
      message_stripped: observable.ref,
      sender: observable.ref,
      receiver: observable.ref,
      triggered_by: observable.ref,
      triggered_by_details: observable,
      read_at: observable.ref,
      archived_at: observable.ref,
      snoozed_till: observable.ref,
      is_inbox_issue: observable.ref,
      is_mentioned_notification: observable.ref,
      workspace: observable.ref,
      project: observable.ref,
      created_at: observable.ref,
      updated_at: observable.ref,
      created_by: observable.ref,
      updated_by: observable.ref,
      // computed
      asJson: computed,
      // actions
      updateNotification: action,
      markNotificationAsRead: action,
      markNotificationAsUnRead: action,
      archiveNotification: action,
      unArchiveNotification: action,
      snoozeNotification: action,
      unSnoozeNotification: action,
    });
    this.title = this.notification.title;
    this.data = this.notification.data;
    this.entity_identifier = this.notification.entity_identifier;
    this.entity_name = this.notification.entity_name;
    this.message_html = this.notification.message_html;
    this.message = this.notification.message;
    this.message_stripped = this.notification.message_stripped;
    this.sender = this.notification.sender;
    this.receiver = this.notification.receiver;
    this.triggered_by = this.notification.triggered_by;
    this.triggered_by_details = this.notification.triggered_by_details;
    this.read_at = this.notification.read_at;
    this.archived_at = this.notification.archived_at;
    this.snoozed_till = this.notification.snoozed_till;
    this.is_inbox_issue = this.notification.is_inbox_issue;
    this.is_mentioned_notification = this.notification.is_mentioned_notification;
    this.workspace = this.notification.workspace;
    this.project = this.notification.project;
    this.created_at = this.notification.created_at;
    this.updated_at = this.notification.updated_at;
    this.created_by = this.notification.created_by;
    this.updated_by = this.notification.updated_by;
  }

  // computed
  /**
   * @description get notification as json
   */
  get asJson() {
    return {
      id: this.id,
      title: this.title,
      data: this.data,
      entity_identifier: this.entity_identifier,
      entity_name: this.entity_name,
      message_html: this.message_html,
      message: this.message,
      message_stripped: this.message_stripped,
      sender: this.sender,
      receiver: this.receiver,
      triggered_by: this.triggered_by,
      triggered_by_details: this.triggered_by_details,
      read_at: this.read_at,
      archived_at: this.archived_at,
      snoozed_till: this.snoozed_till,
      is_inbox_issue: this.is_inbox_issue,
      is_mentioned_notification: this.is_mentioned_notification,
      workspace: this.workspace,
      project: this.project,
      created_at: this.created_at,
      updated_at: this.updated_at,
      created_by: this.created_by,
      updated_by: this.updated_by,
    };
  }

  // computed functions

  // helper functions
  mutateNotification = (notification: Partial<TNotification>) => {
    Object.entries(notification).forEach(([key, value]) => {
      if (key in this) {
        set(this, key, value);
      }
    });
  };

  // actions
  /**
   * @description update notification
   * @param { string } workspaceSlug
   * @param { Partial<TNotification> } payload
   * @returns { TNotification | undefined }
   */
  updateNotification = async (
    workspaceSlug: string,
    payload: Partial<TNotification>
  ): Promise<TNotification | undefined> => {
    try {
      const notification = await workspaceNotificationService.updateNotificationById(workspaceSlug, this.id, payload);
      if (notification) {
        runInAction(() => this.mutateNotification(notification));
      }
      return notification;
    } catch (error) {
      throw error;
    }
  };

  /**
   * @description mark notification as read
   * @param { string } workspaceSlug
   * @returns { TNotification | undefined }
   */
  markNotificationAsRead = async (workspaceSlug: string): Promise<TNotification | undefined> => {
    const currentNotificationReadAt = this.read_at;
    try {
      const payload: Partial<TNotification> = {
        read_at: new Date().toISOString(),
      };
      this.store.workspaceNotification.setUnreadNotificationsCount("decrement");
      runInAction(() => this.mutateNotification(payload));
      const notification = await workspaceNotificationService.markNotificationAsRead(workspaceSlug, this.id);
      if (notification) {
        runInAction(() => this.mutateNotification(notification));
      }
      return notification;
    } catch (error) {
      runInAction(() => this.mutateNotification({ read_at: currentNotificationReadAt }));
      this.store.workspaceNotification.setUnreadNotificationsCount("increment");
      throw error;
    }
  };

  /**
   * @description mark notification as unread
   * @param { string } workspaceSlug
   * @returns { TNotification | undefined }
   */
  markNotificationAsUnRead = async (workspaceSlug: string): Promise<TNotification | undefined> => {
    const currentNotificationReadAt = this.read_at;
    try {
      const payload: Partial<TNotification> = {
        read_at: undefined,
      };
      this.store.workspaceNotification.setUnreadNotificationsCount("increment");
      runInAction(() => this.mutateNotification(payload));
      const notification = await workspaceNotificationService.markNotificationAsUnread(workspaceSlug, this.id);
      if (notification) {
        runInAction(() => this.mutateNotification(notification));
      }
      return notification;
    } catch (error) {
      this.store.workspaceNotification.setUnreadNotificationsCount("decrement");
      runInAction(() => this.mutateNotification({ read_at: currentNotificationReadAt }));
      throw error;
    }
  };

  /**
   * @description archive notification
   * @param { string } workspaceSlug
   * @returns { TNotification | undefined }
   */
  archiveNotification = async (workspaceSlug: string): Promise<TNotification | undefined> => {
    const currentNotificationArchivedAt = this.archived_at;
    try {
      const payload: Partial<TNotification> = {
        archived_at: new Date().toISOString(),
      };
      runInAction(() => this.mutateNotification(payload));
      const notification = await workspaceNotificationService.markNotificationAsArchived(workspaceSlug, this.id);
      if (notification) {
        runInAction(() => this.mutateNotification(notification));
      }
      return notification;
    } catch (error) {
      runInAction(() => this.mutateNotification({ archived_at: currentNotificationArchivedAt }));
      throw error;
    }
  };

  /**
   * @description unarchive notification
   * @param { string } workspaceSlug
   * @returns { TNotification | undefined }
   */
  unArchiveNotification = async (workspaceSlug: string): Promise<TNotification | undefined> => {
    const currentNotificationArchivedAt = this.archived_at;
    try {
      const payload: Partial<TNotification> = {
        archived_at: undefined,
      };
      runInAction(() => this.mutateNotification(payload));
      const notification = await workspaceNotificationService.markNotificationAsUnArchived(workspaceSlug, this.id);
      if (notification) {
        runInAction(() => this.mutateNotification(notification));
      }
      return notification;
    } catch (error) {
      runInAction(() => this.mutateNotification({ archived_at: currentNotificationArchivedAt }));
      throw error;
    }
  };

  /**
   * @description snooze notification
   * @param { string } workspaceSlug
   * @param { Date } snoozeTill
   * @returns { TNotification | undefined }
   */
  snoozeNotification = async (workspaceSlug: string, snoozeTill: Date): Promise<TNotification | undefined> => {
    const currentNotificationSnoozeTill = this.snoozed_till;
    try {
      const payload: Partial<TNotification> = {
        snoozed_till: snoozeTill.toISOString(),
      };
      runInAction(() => this.mutateNotification(payload));
      const notification = await workspaceNotificationService.updateNotificationById(workspaceSlug, this.id, payload);
      return notification;
    } catch (error) {
      runInAction(() => this.mutateNotification({ snoozed_till: currentNotificationSnoozeTill }));
      throw error;
    }
  };

  /**
   * @description un snooze notification
   * @param { string } workspaceSlug
   * @returns { TNotification | undefined }
   */
  unSnoozeNotification = async (workspaceSlug: string): Promise<TNotification | undefined> => {
    const currentNotificationSnoozeTill = this.snoozed_till;
    try {
      const payload: Partial<TNotification> = {
        snoozed_till: undefined,
      };
      runInAction(() => this.mutateNotification(payload));
      const notification = await workspaceNotificationService.updateNotificationById(workspaceSlug, this.id, payload);
      return notification;
    } catch (error) {
      runInAction(() => this.mutateNotification({ snoozed_till: currentNotificationSnoozeTill }));
      throw error;
    }
  };
}
