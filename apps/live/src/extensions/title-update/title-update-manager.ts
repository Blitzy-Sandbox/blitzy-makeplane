/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * TitleUpdateManager - document-scoped debounce orchestrator for page title persistence
 * in the apps/live real-time collaboration server.
 *
 * Composition:
 *   - Wraps a `DebounceManager` (from `./debounce`) with a 5-second debounce window per
 *     instance (caller may override the wait via the constructor).
 *   - Resolves the appropriate page service via `getPageService(context.documentType,
 *     context)` from `@/services/page/handler` (currently supports
 *     `documentType: "project_page"`).
 *   - Routes the persisted title through `service.updatePageProperties(documentName,
 *     { data: { name: title }, abortSignal })`.
 *
 * Lifecycle: one instance is created per active Hocuspocus document by
 * `apps/live/src/extensions/title-sync.ts.afterLoadDocument` and destroyed by
 * `beforeUnloadDocument` (force-save) / `afterUnloadDocument` (cancel).
 *
 * Architectural notes:
 *   - Title persistence is a DIRECT HTTP PATCH to apps/api -- NOT routed through
 *     Celery/RabbitMQ. Title updates are user-feedback-critical and tolerate the
 *     synchronous HTTP latency.
 *   - Redis is NOT involved in this code path. Redis is used elsewhere in the apps/live
 *     stack (cross-server awareness via `extensions/redis.ts`, admin commands via
 *     `extensions/force-close-handler.ts`) but title sync goes directly to apps/api.
 *   - The 5-second title debounce is intentionally independent of (and shorter than)
 *     the 10-second Hocuspocus document persistence debounce wired in
 *     `apps/live/src/hocuspocus.ts`; titles are user-visible feedback while document
 *     binary persistence is internal state.
 *   - Yjs CRDT auto-merge applies to the `title` fragment with no explicit conflict
 *     resolver (HocusPocus 2.15.2 + Y.js 13.6.20, tech spec §3.2.6).
 *
 * Document lifecycle traceability (title fragment):
 *   - edit:                Yjs `title` fragment changes -> `title-sync.handleTitleChange`
 *                          -> `TitleUpdateManager.scheduleUpdate` ->
 *                          `DebounceManager.schedule`.
 *   - persist:             `DebounceManager.timerExpired` after 5 s ->
 *                          `TitleUpdateManager.updateTitle` -> direct PATCH to apps/api.
 *   - disconnect (graceful):
 *                          `title-sync.beforeUnloadDocument` ->
 *                          `TitleUpdateManager.forceSave` -> `DebounceManager.flush`
 *                          (immediate persist).
 *   - disconnect (defense-in-depth):
 *                          `title-sync.afterUnloadDocument` ->
 *                          `TitleUpdateManager.cancel` -> `DebounceManager.cancel`
 *                          (discard pending).
 */

import { logger } from "@plane/logger";
import { AppError } from "@/lib/errors";
import { getPageService } from "@/services/page/handler";
import type { HocusPocusServerContext } from "@/types";
import { DebounceManager } from "./debounce";

/**
 * Manages title update operations for a single document
 * Handles debouncing, aborting, and force saving title updates
 *
 * State slice:
 *   - documentName: string                  -- Hocuspocus document name (typically the
 *                                              page id).
 *   - context: HocusPocusServerContext      -- authentication + workspace context
 *                                              propagated from the WebSocket connection
 *                                              (workspaceSlug, projectId, cookie,
 *                                              documentType, userId).
 *   - debounceManager: DebounceManager      -- the per-document debounce engine
 *                                              (default 5-second wait, trailing-edge
 *                                              invocation).
 *   - lastTitle: string | null              -- the latest pending title; nulled after a
 *                                              successful persistence ONLY when no
 *                                              newer update arrived during the
 *                                              in-flight PATCH.
 *
 * Public API:
 *   - scheduleUpdate(title)  -- enqueue a title update (5-second trailing-edge debounce).
 *   - forceSave()            -- flush any pending update immediately; awaited from
 *                               `title-sync.beforeUnloadDocument`.
 *   - cancel()               -- discard pending updates; invoked from
 *                               `title-sync.afterUnloadDocument` as defense-in-depth
 *                               cleanup.
 *
 * Consumer: only `apps/live/src/extensions/title-sync.ts.TitleSyncExtension`.
 */
export class TitleUpdateManager {
  private documentName: string;
  private context: HocusPocusServerContext;
  private debounceManager: DebounceManager;
  private lastTitle: string | null = null;

  /**
   * Create a new TitleUpdateManager instance
   *
   * The default `wait` of 5000 ms is intentionally shorter than the 10-second
   * Hocuspocus document persistence debounce wired in `apps/live/src/hocuspocus.ts`;
   * title changes are user-visible feedback while document binary persistence is
   * internal state, so title sync is allowed to fire more frequently.
   *
   * The inner `DebounceManager` receives `logPrefix:
   * "TitleManager[<first-8-chars-of-documentName>]"` so concurrent per-document
   * managers stay distinguishable in operator logs.
   *
   * No side effects beyond field assignment and `DebounceManager` instantiation.
   *
   * @param documentName  Hocuspocus document name (typically the page id).
   * @param context       Authentication + workspace context from the WebSocket
   *                      connection.
   * @param wait          Debounce window in milliseconds (default 5000).
   */
  constructor(documentName: string, context: HocusPocusServerContext, wait: number = 5000) {
    this.documentName = documentName;
    this.context = context;

    // Set up debounce manager with logging
    this.debounceManager = new DebounceManager({
      wait,
      logPrefix: `TitleManager[${documentName.substring(0, 8)}]`,
    });
  }

  /**
   * Schedule a debounced title update
   *
   * Stores `title` in `this.lastTitle` and schedules `this.updateTitle` via
   * `this.debounceManager.schedule(...)`. The `.bind(this)` is required so the
   * debounce manager preserves the correct `this` context when it eventually
   * invokes the private method.
   *
   * Trailing-edge debounce: rapid successive calls collapse -- only the LATEST
   * `title` is persisted after the configured wait window has elapsed since the
   * last call.
   *
   * @param title  New title to persist; replaces any previously pending title.
   */
  scheduleUpdate(title: string): void {
    // Store the latest title
    this.lastTitle = title;

    // Schedule the update with the debounce manager
    this.debounceManager.schedule(this.updateTitle.bind(this), title);
  }

  /**
   * Update the title - will be called by the debounce manager
   *
   * State write: invokes `service.updatePageProperties(this.documentName, { data:
   * { name: title }, abortSignal: signal })` -- the direct HTTP PATCH to apps/api
   * (NOT routed through Celery/RabbitMQ or Redis).
   *
   * Service resolution: `getPageService(this.context.documentType, this.context)`
   * is called per invocation (lazy) so changes to `documentType` are honored.
   *
   * Capability guard: if the resolved service does not implement
   * `updatePageProperties`, logs a warning and returns silently -- this preserves
   * forward compatibility with new `documentType` values that may not support
   * title editing.
   *
   * Abort signal: appended by `DebounceManager.performFunction` as the LAST
   * argument and forwarded to `updatePageProperties` so the in-flight axios
   * request can be cancelled when a newer scheduling call arrives.
   *
   * Idempotency: `this.lastTitle` is cleared ONLY if it still matches the title
   * we just persisted; if a newer title arrived during the PATCH, `lastTitle` is
   * preserved so the next debounce cycle picks it up.
   *
   * Error handling: failures are wrapped in `AppError(error, { context: {
   * operation: "updateTitle", documentName } })` and logged via `@plane/logger`.
   * Errors are NOT rethrown -- title updates are non-critical (the title is
   * reconstructed on next document load) so we deliberately suppress the debounce
   * engine's retry path.
   *
   * @param title   Title to persist.
   * @param signal  Abort signal supplied by `DebounceManager.performFunction`.
   */
  private async updateTitle(title: string, signal?: AbortSignal): Promise<void> {
    const service = getPageService(this.context.documentType, this.context);
    if (!service.updatePageProperties) {
      logger.warn(`No updateTitle method found for document ${this.documentName}`);
      return;
    }

    try {
      await service.updatePageProperties(this.documentName, {
        data: { name: title },
        abortSignal: signal,
      });

      // Clear last title only if it matches what we just updated
      if (this.lastTitle === title) {
        this.lastTitle = null;
      }
    } catch (error) {
      const appError = new AppError(error, {
        context: { operation: "updateTitle", documentName: this.documentName },
      });
      logger.error("Error updating title", appError);
    }
  }

  /**
   * Force save the current title immediately
   *
   * Early-return: if `this.lastTitle` is null there is nothing to save, so
   * returns immediately.
   *
   * Otherwise calls `this.debounceManager.flush(this.updateTitle.bind(this))` to
   * bypass the debounce window and persist immediately.
   *
   * Caller: `apps/live/src/extensions/title-sync.ts.beforeUnloadDocument`. The
   * caller awaits this method -- awaiting is critical because without it the
   * document could be unloaded before the PATCH completes, losing the latest
   * title.
   */
  async forceSave(): Promise<void> {
    // Ensure we have the current title
    if (!this.lastTitle) {
      return;
    }

    // Use the debounce manager to flush the operation
    await this.debounceManager.flush(this.updateTitle.bind(this));
  }

  /**
   * Cancel any pending updates
   *
   * Invokes `this.debounceManager.cancel()` (which clears any pending timer and
   * aborts an in-progress execution) and resets `this.lastTitle = null` so a
   * subsequent `forceSave` does nothing.
   *
   * Caller: `apps/live/src/extensions/title-sync.ts.afterUnloadDocument` -- used
   * as a defense-in-depth cleanup when `beforeUnloadDocument` did not run
   * (abrupt shutdown path).
   */
  cancel(): void {
    this.debounceManager.cancel();
    this.lastTitle = null;
  }
}
