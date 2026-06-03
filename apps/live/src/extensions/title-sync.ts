/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Hocuspocus extension that synchronizes document titles between the in-memory Yjs `title`
 * XmlFragment and the persisted page metadata in apps/api.
 *
 * Wiring: registered as the fourth extension by `getExtensions()` in
 * `apps/live/src/extensions/index.ts` -- load order is `Logger`, `Database`, `Redis`,
 * `TitleSyncExtension`, `ForceCloseHandler`. `ForceCloseHandler` is intentionally last so it
 * can receive broadcasts, and this extension's broadcast path piggybacks on the `Redis`
 * extension's cluster pub/sub channel.
 *
 * Hook composition (document lifecycle `connect -> edit -> persist -> disconnect`):
 *   - `onLoadDocument`        -- one-time legacy migration that backfills a missing Yjs
 *                                `title` fragment from persisted page metadata.
 *   - `afterLoadDocument`     -- registers a deep observer on the `title` fragment and
 *                                creates a per-document `TitleUpdateManager`.
 *   - `beforeUnloadDocument`  -- force-flushes any pending debounced title update so the
 *                                latest title is durable before the document leaves memory.
 *   - `afterUnloadDocument`   -- unobserves the `title` fragment and clears the per-document
 *                                Maps to prevent memory leaks.
 *
 * Persistence path: title edits are debounced (default 5 s per
 * `./title-update/title-update-manager.ts:26`) and then persisted via
 * `PageService.updatePageProperties()` as a **direct HTTP PATCH** to apps/api -- persistence
 * is NOT routed through Redis or the RabbitMQ-backed Celery queue.
 *
 * Broadcast path: title changes also emit a realtime `property_updated` event to the
 * document's **parent page** (only when `parentId` is known) via `broadcastMessageToPage`
 * from `@/utils/broadcast-message`. That helper relays the event through the `Redis`
 * extension's cluster pub/sub channel -- Redis is used here purely for awareness fan-out
 * across `apps/live` replicas; task queueing in this project uses Celery on RabbitMQ from
 * apps/api.
 *
 * Memory-leak guards: per-document observer callbacks live in `titleObservers`, debounce
 * engines live in `titleUpdateManagers`, and the minimal data the observer needs
 * (`userId`, `workspaceSlug`, `instance`, optional `parentId`) lives in `titleObserverData`
 * -- kept off the closure to avoid capturing the heavyweight `Document` and Hocuspocus
 * `context` references. All three Maps are cleaned up in `afterUnloadDocument`.
 *
 * Stack: HocusPocus 2.15.2 + Y.js 13.6.20 (see tech spec §3.2.6).
 */

// hocuspocus
import type { Extension, Hocuspocus, Document } from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import type { AnyExtension, JSONContent } from "@tiptap/core";
import type * as Y from "yjs";
// editor extensions
import {
  TITLE_EDITOR_EXTENSIONS,
  createRealtimeEvent,
  extractTextFromHTML,
  generateTitleProsemirrorJson,
} from "@plane/editor";
import { logger } from "@plane/logger";
import { AppError } from "@/lib/errors";
// helpers
import { getPageService } from "@/services/page/handler";
import type { HocusPocusServerContext, OnLoadDocumentPayloadWithContext } from "@/types";
import { broadcastMessageToPage } from "@/utils/broadcast-message";
import { TitleUpdateManager } from "./title-update/title-update-manager";

/**
 * Hocuspocus extension for synchronizing document titles
 *
 * Hooks contributed:
 *   - `onLoadDocument`       -- backfill the Yjs `title` fragment from persisted page
 *                               metadata on load (one-time migration; no-op when the
 *                               fragment is already populated).
 *   - `afterLoadDocument`    -- register a deep observer on the Yjs `title` fragment and
 *                               instantiate a per-document `TitleUpdateManager`.
 *   - `beforeUnloadDocument` -- force-save any pending debounced title update via
 *                               `TitleUpdateManager.forceSave()` so the latest title is
 *                               durable before the document leaves memory.
 *   - `afterUnloadDocument`  -- unobserve the `title` fragment and delete the per-document
 *                               Maps to prevent memory leaks.
 *
 * Internal state slices:
 *   - `titleObservers: Map<documentName, observerCallback>`             -- bound observer
 *     callbacks per document, registered on the Yjs `title` XmlFragment.
 *   - `titleUpdateManagers: Map<documentName, TitleUpdateManager>`      -- debounced
 *     persistence engines per document.
 *   - `titleObserverData: Map<documentName, { parentId?, userId, workspaceSlug, instance }>`
 *     -- minimal closure-free data the observer reads on each title change.
 *
 * Memory-leak guards: observer data is stored in `titleObserverData` rather than captured
 * in the observer callback closure, and `handleTitleChange` is reached via
 * `bind(this, documentName)` -- so the observer callback does not retain the heavyweight
 * `Document` or Hocuspocus `context` arguments and the `Document` can be garbage-collected
 * on unload.
 *
 * Persistence path: title changes -> `TitleUpdateManager.scheduleUpdate` (5 s debounce per
 * `./title-update/title-update-manager.ts:26`) -> direct HTTP PATCH to
 * `PageService.updatePageProperties()` on apps/api.
 *
 * Broadcast path: title changes -> `createRealtimeEvent({ action: "property_updated", ... })`
 * -> `broadcastMessageToPage(instance, parentId, event)`. Only emitted when `parentId` is
 * known (see `handleTitleChange`); the helper relays through the Redis extension's pub/sub.
 */
export class TitleSyncExtension implements Extension {
  // Maps document names to their observers and update managers
  private titleObservers: Map<string, (events: Y.YEvent<any>[]) => void> = new Map();
  private titleUpdateManagers: Map<string, TitleUpdateManager> = new Map();
  // Store minimal data needed for each document's title observer (prevents closure memory leaks)
  private titleObserverData: Map<
    string,
    {
      parentId?: string | null;
      userId: string;
      workspaceSlug: string | null;
      instance: Hocuspocus;
    }
  > = new Map();

  /**
   * Handle document loading - migrate old titles if needed
   *
   * Trigger: Hocuspocus invokes this on document load, before clients receive the initial
   * Y.Doc state.
   *
   * State read: `document.isEmpty("title")` checks whether the Yjs `title` fragment is
   * empty. If so, fetches `pageDetails.name` from apps/api via
   * `service.fetchDetails(documentName)`.
   *
   * State write: when the persisted title is non-null, converts it to a ProseMirror JSON
   * tree (`generateTitleProsemirrorJson`), then to a Yjs document scoped to the `title`
   * field (`TiptapTransformer.toYdoc(..., "title", TITLE_EDITOR_EXTENSIONS)`), then merges
   * that field into the live `document` via `document.merge(titleField)`. This is the
   * on-demand migration path for legacy pages whose page metadata carries a `name` but
   * whose Yjs binary has no `title` fragment.
   *
   * Error handling: any thrown error is wrapped in `AppError` with the `onLoadDocument`
   * operation context and logged via `@plane/logger`. Errors are **not** rethrown --
   * document load proceeds even when title backfill fails.
   *
   * Idempotency: re-invoking this hook on a document whose `title` fragment is no longer
   * empty is a no-op.
   */
  async onLoadDocument({ context, document, documentName }: OnLoadDocumentPayloadWithContext) {
    try {
      // initially for on demand migration of old titles to a new title field
      // in the yjs binary
      if (document.isEmpty("title")) {
        const service = getPageService(context.documentType, context);
        const pageDetails = await service.fetchDetails(documentName);
        const title = pageDetails.name;
        if (title == null) return;
        const titleJson = (generateTitleProsemirrorJson as (text: string) => JSONContent)(title);
        const titleField = TiptapTransformer.toYdoc(titleJson, "title", TITLE_EDITOR_EXTENSIONS as AnyExtension[]);
        document.merge(titleField);
      }
    } catch (error) {
      const appError = new AppError(error, {
        context: { operation: "onLoadDocument", documentName },
      });
      logger.error("Error loading document title", appError);
    }
  }
  /**
   * Set up title synchronization for a document after it's loaded
   *
   * Trigger: Hocuspocus invokes this immediately after `onLoadDocument` completes -- the
   * in-memory Y.Doc has been seeded.
   *
   * State write:
   *   1. Constructs a `TitleUpdateManager` for this document (default 5 s debounce per
   *      `./title-update/title-update-manager.ts:26`).
   *   2. Registers the manager in `titleUpdateManagers` so `handleTitleChange` and
   *      `beforeUnloadDocument` can reach it.
   *   3. Caches minimal observer data (`userId`, `workspaceSlug`, `instance`) in
   *      `titleObserverData` -- the `document` and `context` arguments are deliberately
   *      omitted to keep them out of the observer closure (memory-leak guard).
   *   4. Binds `handleTitleChange` to a per-document callback and attaches it via
   *      `document.getXmlFragment("title").observeDeep(...)`.
   *   5. Registers the bound observer in `titleObservers` so `afterUnloadDocument` can
   *      detach it later.
   */
  async afterLoadDocument({
    document,
    documentName,
    context,
    instance,
  }: {
    document: Document;
    documentName: string;
    context: HocusPocusServerContext;
    instance: Hocuspocus;
  }) {
    // Create a title update manager for this document
    const updateManager = new TitleUpdateManager(documentName, context);

    // Store the manager
    this.titleUpdateManagers.set(documentName, updateManager);

    // Store minimal data needed for the observer (prevents closure memory leak)
    this.titleObserverData.set(documentName, {
      userId: context.userId,
      workspaceSlug: context.workspaceSlug,
      instance: instance,
    });

    // Create observer using bound method to avoid closure capturing heavy objects
    const titleObserver = this.handleTitleChange.bind(this, documentName);

    // Observe the title field
    document.getXmlFragment("title").observeDeep(titleObserver);
    this.titleObservers.set(documentName, titleObserver);
  }

  /**
   * Handle title changes for a document
   * This is a separate method to avoid closure memory leaks
   *
   * Implementation note: the method is reached via `bind(this, documentName)` so the
   * observer callback does NOT capture the heavyweight `Document` or Hocuspocus `context`
   * references, allowing the `Document` to be garbage-collected after unload.
   *
   * Trigger: invoked by the deep observer registered in `afterLoadDocument` whenever the
   * Yjs `title` fragment changes.
   *
   * State read:
   *   - Iterates `events: Y.YEvent<any>[]` and extracts plain text from each event's
   *     `currentTarget.toJSON()` via `extractTextFromHTML`. Only the last event's title
   *     is retained.
   *   - Resolves the per-document `TitleUpdateManager` from `titleUpdateManagers` and the
   *     cached observer data from `titleObserverData`.
   *
   * Broadcast side effect: when `parentId`, `workspaceSlug`, and `instance` are all
   * present in the cached data, builds a realtime `property_updated` event
   * (`createRealtimeEvent({ page_id: documentName, data: { name: title }, ... })`) and
   * broadcasts it via `broadcastMessageToPage(instance, parentId, event)` so subscribers
   * of the **parent page** see the nested page's new title in real time. The broadcast
   * is best-effort and is relayed across cluster replicas through the Redis extension's
   * pub/sub channel (Redis is used here for awareness fan-out only -- task queueing
   * remains RabbitMQ via apps/api).
   *
   * Persistence side effect: when a manager exists, calls `manager.scheduleUpdate(title)`
   * to enqueue a debounced PATCH via `TitleUpdateManager`.
   */
  private handleTitleChange(documentName: string, events: Y.YEvent<any>[]) {
    let title = "";
    events.forEach((event) => {
      title = extractTextFromHTML(event.currentTarget.toJSON() as string);
    });

    // Get the manager for this document
    const manager = this.titleUpdateManagers.get(documentName);

    // Get the stored data for this document
    const data = this.titleObserverData.get(documentName);

    // Broadcast to parent page if it exists
    if (data?.parentId && data.workspaceSlug && data.instance) {
      const event = createRealtimeEvent({
        user_id: data.userId,
        workspace_slug: data.workspaceSlug,
        action: "property_updated",
        page_id: documentName,
        data: { name: title },
        descendants_ids: [],
      });

      // Use the instance from stored data (guaranteed to be set)
      broadcastMessageToPage(data.instance, data.parentId, event);
    }

    // Schedule the title update
    if (manager) {
      manager.scheduleUpdate(title);
    }
  }

  /**
   * Force save title before unloading the document
   *
   * Trigger: Hocuspocus invokes this immediately before unloading a document from memory
   * (after all clients have disconnected or during graceful shutdown).
   *
   * State read: resolves the per-document `TitleUpdateManager` from `titleUpdateManagers`.
   *
   * State write: when a manager exists, `await`s `updateManager.forceSave()` to flush any
   * pending debounced PATCH **immediately**. The `await` is critical -- without it the
   * manager would be deleted before the PATCH completes and the latest title would be
   * lost.
   *
   * Cleanup: the manager is removed from `titleUpdateManagers` after the flush so the per-
   * document map does not retain stale references.
   */
  async beforeUnloadDocument({ documentName }: { documentName: string }) {
    const updateManager = this.titleUpdateManagers.get(documentName);
    if (updateManager) {
      // Force immediate save and wait for it to complete
      await updateManager.forceSave();
      // Clean up the manager
      this.titleUpdateManagers.delete(documentName);
    }
  }

  /**
   * Remove observers after document unload
   *
   * Trigger: Hocuspocus invokes this after the document has been unloaded from memory.
   *
   * Observer cleanup: looks up the per-document observer in `titleObservers` and, when
   * the `document` argument is provided, calls
   * `document.getXmlFragment("title").unobserveDeep(observer)` to detach the observer
   * from the Yjs document -- without this the observer would keep a reference to the
   * document and prevent it from being garbage-collected. Unobserve failures are wrapped
   * in `AppError` and logged but **not rethrown**. The observer entry is then deleted
   * from `titleObservers`.
   *
   * Observer data cleanup: deletes the cached entry in `titleObserverData` so the
   * retained `userId`, `workspaceSlug`, and `instance` references are released.
   *
   * Defense-in-depth manager cleanup: if `beforeUnloadDocument` somehow did not run
   * (e.g. abrupt shutdown), explicitly `cancel()` any pending debounced update and drop
   * the manager from `titleUpdateManagers` to guarantee no stale entries remain.
   */
  async afterUnloadDocument({ documentName, document }: { documentName: string; document?: Document }) {
    // Clean up observer when document is unloaded
    const observer = this.titleObservers.get(documentName);
    if (observer) {
      // unregister observer from Y.js document to prevent memory leak
      if (document) {
        try {
          document.getXmlFragment("title").unobserveDeep(observer);
        } catch (error) {
          logger.error("Failed to unobserve title field", new AppError(error, { context: { documentName } }));
        }
      }
      this.titleObservers.delete(documentName);
    }

    // Clean up the observer data map to prevent memory leak
    this.titleObserverData.delete(documentName);

    // Ensure manager is cleaned up if beforeUnloadDocument somehow didn't run
    if (this.titleUpdateManagers.has(documentName)) {
      const manager = this.titleUpdateManagers.get(documentName)!;
      manager.cancel();
      this.titleUpdateManagers.delete(documentName);
    }
  }
}
