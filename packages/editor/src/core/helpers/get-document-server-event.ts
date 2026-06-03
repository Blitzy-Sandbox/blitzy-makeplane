/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Server-action → realtime-event-name translator for the document collaborative event protocol.
 *
 * Used by client code that has a `TDocumentEventsClient` value (the user-facing name, e.g. `"locked"`, `"archived"`) and needs to look up the corresponding `TDocumentEventsServer` name (e.g. `"lock"`, `"archive"`) before emitting a stateless message through the Hocuspocus provider.
 *
 * The mapping itself lives in `core/constants/document-collaborative-events.ts`; the typed payloads live in `core/types/document-collaborative-events.ts`. This helper exists so consumers do not duplicate the table-lookup logic at every emit site.
 */

import { DocumentCollaborativeEvents } from "@/constants/document-collaborative-events";
import type {
  TDocumentEventKey,
  TDocumentEventsClient,
  TDocumentEventsServer,
} from "@/types/document-collaborative-events";

/**
 * Returns the server-side event name corresponding to a client-side `TDocumentEventsClient` value by linearly scanning `DocumentCollaborativeEvents` for a matching `client` field.
 *
 * The events constant currently has fewer than a dozen entries so the linear scan is cheap; if the table grows substantially, replace with a reverse-lookup map keyed by `client`.
 *
 * @param clientEvent - Client-side event name (e.g., `"locked"`, `"archived"`, `"unarchived"`).
 * @returns The matching server-side event name (e.g., `"lock"`, `"archive"`, `"unarchive"`) or `undefined` when no entry matches.
 */
export const getServerEventName = (clientEvent: TDocumentEventsClient): TDocumentEventsServer | undefined => {
  for (const key in DocumentCollaborativeEvents) {
    if (DocumentCollaborativeEvents[key as TDocumentEventKey].client === clientEvent) {
      return DocumentCollaborativeEvents[key as TDocumentEventKey].server;
    }
  }
  return undefined;
};
