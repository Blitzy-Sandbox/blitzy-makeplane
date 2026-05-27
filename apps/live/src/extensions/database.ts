/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Custom Hocuspocus database extension for the apps/live real-time collaboration server.
 *
 * This module subclasses `@hocuspocus/extension-database.Database` and wires two handlers
 * into the Hocuspocus lifecycle: {@link fetchDocument} loads the initial Yjs state from
 * apps/api when a document is first opened, and {@link storeDocument} persists the
 * debounced Yjs state back to apps/api after collaborative edits accumulate.
 *
 * Document lifecycle role (per AAP Directive 4 — `connect → edit → persist → disconnect`):
 *   - `connect`    — Hocuspocus calls {@link fetchDocument} which loads
 *                    `description_binary` from the apps/api page service.
 *   - `edit`       — in-memory Y.Doc CRDT updates accumulate (not handled here).
 *   - `persist`    — {@link storeDocument} fires every ~10 seconds (controlled by
 *                    `debounce: 10000` configured in `apps/live/src/hocuspocus.ts`) and
 *                    PATCHes the binary/HTML/JSON forms back to apps/api.
 *   - `disconnect` — failure modes can trigger {@link forceCloseDocumentAcrossServers}
 *                    from `./force-close-handler.ts`; voluntary disconnects are handled
 *                    by Hocuspocus core.
 *
 * Conflict resolution: Yjs CRDT auto-merge with NO explicit resolver callback. Concurrent
 * edits from multiple clients converge structurally via Yjs Y.Doc state encoding — the
 * persisted state always reflects the already-merged view by the time `storeDocument`
 * runs.
 *
 * HTML→binary backfill (tech spec §5.2.5.4): when apps/api returns an empty
 * `description_binary` (legacy pages predating Yjs persistence), the existing
 * `description_html` is converted into Yjs binary via
 * `getBinaryDataFromDocumentEditorHTMLString` and written back so subsequent loads skip
 * this one-time conversion.
 *
 * Error broadcasting: load and persist failures invoke {@link broadcastError}, which
 * relays a structured error event to all connected clients of the affected document via
 * the Redis pub/sub extension. Redis is used here for caching, session, and pub/sub
 * awareness fan-out only — task queueing in Plane is done via RabbitMQ from apps/api.
 *
 * Force-close coordination: oversized documents (HTTP 413 from apps/api) trigger
 * {@link forceCloseDocumentAcrossServers} so every server in the cluster terminates the
 * affected document session simultaneously via the Redis admin channel.
 *
 * Cross-references: HocusPocus 2.15.2 + Y.js 13.6.20 (tech spec §3.2.6); real-time
 * collaboration sequence (tech spec §5.2.5.4).
 */

import { Database as HocuspocusDatabase } from "@hocuspocus/extension-database";
// plane imports
import {
  getAllDocumentFormatsFromDocumentEditorBinaryData,
  getBinaryDataFromDocumentEditorHTMLString,
} from "@plane/editor";
import type { TDocumentPayload } from "@plane/types";
import { logger } from "@plane/logger";
// lib
import { AppError } from "@/lib/errors";
// services
import { getPageService } from "@/services/page/handler";
// type
import type { FetchPayloadWithContext, StorePayloadWithContext } from "@/types";
import { ForceCloseReason, CloseCode } from "@/types/admin-commands";
import { broadcastError } from "@/utils/broadcast-error";
// force close utility
import { forceCloseDocumentAcrossServers } from "./force-close-handler";

/**
 * Hocuspocus `fetch` hook — loads the initial Yjs document state from apps/api.
 *
 * Trigger: Hocuspocus invokes this callback the first time a client requests a document
 * (one-shot per `documentName`); subsequent connections share the in-memory Y.Doc and
 * skip this path until the document is unloaded from server memory.
 *
 * State reads:
 *   - {@link getPageService} resolves the page service implementation for
 *     `context.documentType` (currently only `"project_page"`).
 *   - `service.fetchDescriptionBinary(pageId)` returns a `Buffer` of Yjs state
 *     (`GET /api/workspaces/<slug>/projects/<projectId>/pages/<id>/description/`,
 *     served as `application/octet-stream` — the route path is `description/`; the
 *     "binary" qualifier refers to the payload encoding, not the URL segment).
 *   - `service.fetchDetails(pageId)` is consulted only when the binary is empty, to
 *     obtain `description_html` and `name` for the backfill path.
 *
 * HTML→binary backfill: when `binaryData.byteLength === 0`, the legacy
 * `description_html` is converted via `getBinaryDataFromDocumentEditorHTMLString` from
 * `@plane/editor`, the three formats are derived via
 * `getAllDocumentFormatsFromDocumentEditorBinaryData`, and the converted payload is
 * written back via `service.updateDescriptionBinary` so the next load is a fast binary
 * read. Backfill write failures are logged but do NOT block the document load — the
 * converted in-memory binary is still returned so the user can edit immediately.
 *
 * Returns: a `Uint8Array` representing the Yjs Y.Doc binary state. Hocuspocus uses this
 * to seed the in-memory Y.Doc shared by all subsequent collaborators of this document.
 *
 * Error handling: any exception is wrapped in {@link AppError} (which preserves
 * `statusCode`/`method`/`url`/`code` and strips sensitive Axios config), logged via
 * `@plane/logger`, broadcast to connected clients through {@link broadcastError} with
 * the `"fetch"` error type, and then rethrown so Hocuspocus marks the document load as
 * failed.
 *
 * Idempotency: the read itself is naturally idempotent. The backfill write is also
 * idempotent — repeated invocations on the same HTML produce the same binary, so a
 * partial backfill followed by retry is safe.
 */
const fetchDocument = async ({ context, documentName: pageId, instance }: FetchPayloadWithContext) => {
  try {
    const service = getPageService(context.documentType, context);
    // fetch details
    const response = (await service.fetchDescriptionBinary(pageId)) as Buffer;
    const binaryData = new Uint8Array(response);
    // if binary data is empty, convert HTML to binary data
    if (binaryData.byteLength === 0) {
      const pageDetails = await service.fetchDetails(pageId);
      const convertedBinaryData = getBinaryDataFromDocumentEditorHTMLString(
        pageDetails.description_html ?? "<p></p>",
        pageDetails.name
      );
      if (convertedBinaryData) {
        // save the converted binary data back to the database
        try {
          const { contentBinaryEncoded, contentHTML, contentJSON } = getAllDocumentFormatsFromDocumentEditorBinaryData(
            convertedBinaryData,
            true
          );
          const payload: TDocumentPayload = {
            description_binary: contentBinaryEncoded,
            description_html: contentHTML,
            description_json: contentJSON,
          };
          await service.updateDescriptionBinary(pageId, payload);
        } catch (e) {
          const error = new AppError(e);
          logger.error("Failed to save binary after first conversion from html:", error);
        }
        return convertedBinaryData;
      }
    }
    // return binary data
    return binaryData;
  } catch (error) {
    const appError = new AppError(error, { context: { pageId } });
    logger.error("Error in fetching document", appError);

    // Broadcast error to frontend for user document types
    await broadcastError(instance, pageId, "Unable to load the page. Please try refreshing.", "fetch", context);

    throw appError;
  }
};

/**
 * Hocuspocus `store` hook — persists the debounced Yjs document state back to apps/api.
 *
 * Trigger: Hocuspocus invokes this callback after the 10-second persistence debounce
 * configured by `debounce: 10000` in `apps/live/src/hocuspocus.ts`. The debounce batches
 * rapid collaborative edits so `storeDocument` runs at most once every 10 seconds per
 * document, even under heavy concurrent editing (cross-reference tech spec §5.2.5.4).
 *
 * State reads:
 *   - `state: pageBinaryData` is the current in-memory Y.Doc binary state (a
 *     `Uint8Array`) provided by Hocuspocus.
 *   - {@link getPageService} resolves the page service implementation for the
 *     `context.documentType` so the correct apps/api endpoint receives the PATCH.
 *
 * State writes: binary is decoded into all three formats via
 * `getAllDocumentFormatsFromDocumentEditorBinaryData(pageBinaryData, true)` → the
 * resulting `{ description_binary, description_html, description_json }` payload (typed
 * as `TDocumentPayload`) is sent via `service.updateDescriptionBinary` which PATCHes
 * apps/api at
 * `PATCH /api/workspaces/<slug>/projects/<projectId>/pages/<id>/description/`
 * (the route path is `description/`; the "binary" qualifier in the method name refers
 * to the payload encoding, not the URL segment).
 *
 * Idempotency: the PATCH is idempotent — the same `pageBinaryData` always produces the
 * same persisted representation, so Hocuspocus may safely retry on transient failures
 * without producing duplicate state.
 *
 * Conflict resolution: Yjs CRDT auto-merge — no explicit resolver. Concurrent edits from
 * multiple clients are merged into a single Y.Doc state by Yjs's CRDT algorithm before
 * this handler runs; the persisted state already reflects the converged view.
 *
 * Error handling: any exception is wrapped in {@link AppError} and logged, then branches
 * on `statusCode`:
 *   - `413 Content Too Large` → `shouldDisconnect = true`,
 *     `errorCode = "content_too_large"`, and the client-facing message asks the user to
 *     reduce content size.
 *   - any other error → `shouldDisconnect = false`, generic save-failure message.
 *
 * In all cases {@link broadcastError} is called with the `"store"` error type so every
 * client on the document receives a structured error event.
 *
 * Force-close path: when `shouldDisconnect === true`, `errorCode` is mapped to a
 * `ForceCloseReason` / `CloseCode` pair (`DOCUMENT_TOO_LARGE` for content-too-large,
 * `CRITICAL_ERROR` / `FORCE_CLOSE` otherwise) and
 * {@link forceCloseDocumentAcrossServers} is invoked. That helper sends the
 * `force_close` stateless message to all local clients, closes local connections,
 * publishes `AdminCommand.FORCE_CLOSE` to the Redis `hocuspocus:admin` channel so peer
 * servers terminate the same document session, and unloads the document from local
 * memory after an 800ms grace period. The handler then returns WITHOUT rethrowing
 * because the document is already unloaded — see the preserved inline comment below.
 *
 * Default error path: any non-413 error rethrows the `AppError` so Hocuspocus
 * reschedules the store on the next debounce cycle.
 */
const storeDocument = async ({
  context,
  state: pageBinaryData,
  documentName: pageId,
  instance,
}: StorePayloadWithContext) => {
  try {
    const service = getPageService(context.documentType, context);
    // convert binary data to all formats
    const { contentBinaryEncoded, contentHTML, contentJSON } = getAllDocumentFormatsFromDocumentEditorBinaryData(
      pageBinaryData,
      true
    );
    // create payload
    const payload: TDocumentPayload = {
      description_binary: contentBinaryEncoded,
      description_html: contentHTML,
      description_json: contentJSON,
    };
    await service.updateDescriptionBinary(pageId, payload);
  } catch (error) {
    const appError = new AppError(error, { context: { pageId } });
    logger.error("Error in updating document:", appError);

    // Check error types
    const isContentTooLarge = appError.statusCode === 413;

    // Determine if we should disconnect and unload
    const shouldDisconnect = isContentTooLarge;

    // Determine error message and code
    let errorMessage: string;
    let errorCode: "content_too_large" | "page_locked" | "page_archived" | undefined;

    if (isContentTooLarge) {
      errorMessage = "Document is too large to save. Please reduce the content size.";
      errorCode = "content_too_large";
    } else {
      errorMessage = "Unable to save the page. Please try again.";
    }

    // Broadcast error to frontend for user document types
    await broadcastError(instance, pageId, errorMessage, "store", context, errorCode, shouldDisconnect);

    // If we should disconnect, close connections and unload document
    if (shouldDisconnect) {
      // Map error code to ForceCloseReason with proper types
      const reason =
        errorCode === "content_too_large" ? ForceCloseReason.DOCUMENT_TOO_LARGE : ForceCloseReason.CRITICAL_ERROR;

      const closeCode = errorCode === "content_too_large" ? CloseCode.DOCUMENT_TOO_LARGE : CloseCode.FORCE_CLOSE;

      // force close connections and unload document
      await forceCloseDocumentAcrossServers(instance, pageId, reason, closeCode);

      // Don't throw after force close - document is already unloaded
      // Throwing would cause hocuspocus's finally block to access the null document
      return;
    }

    throw appError;
  }
};

/**
 * Hocuspocus extension that persists collaborative Yjs documents to apps/api.
 *
 * Wraps `@hocuspocus/extension-database` and binds the module-level
 * {@link fetchDocument} (for document load) and {@link storeDocument} (for debounced
 * persistence) handlers to the base class via the `{ fetch, store }` super call.
 *
 * Registration: instantiated as the second extension in
 * `apps/live/src/extensions/index.ts.getExtensions()` (after `Logger`, before `Redis`).
 * Ordering ensures persistence is operational before `Redis` propagates broadcast
 * events that may reference persisted state.
 *
 * Hooks contributed:
 *   - `fetch` → {@link fetchDocument} — initial document load (tech spec §5.2.5.4).
 *   - `store` → {@link storeDocument} — debounced persistence on the 10-second window
 *     configured in `apps/live/src/hocuspocus.ts`.
 *   - All other behavior is inherited unchanged from `@hocuspocus/extension-database`.
 *
 * Conflict resolution: this extension does NOT implement an explicit resolver. Yjs CRDT
 * auto-merge handles concurrency structurally, so the persisted state is always the
 * already-merged view.
 *
 * Failure escalation: oversized documents (HTTP 413 from apps/api) trigger
 * {@link forceCloseDocumentAcrossServers}, which uses Redis pub/sub on the
 * `hocuspocus:admin` channel to coordinate cluster-wide termination of the offending
 * document session.
 */
export class Database extends HocuspocusDatabase {
  constructor() {
    super({ fetch: fetchDocument, store: storeDocument });
  }
}
