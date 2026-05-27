/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Hocuspocus context wrappers and document conversion types for the
 * `apps/live` real-time collaboration layer.
 *
 * Type-only module (no runtime side effects) — every import from
 * `@hocuspocus/server` is in type position. The module extends the standard
 * Hocuspocus load / fetch / store payloads with a `context` field that
 * carries Plane-specific metadata (workspace slug, project ID, user ID,
 * document type, session cookie). That context is populated at
 * authentication time in `apps/live/src/lib/auth.ts` (the `onAuthenticate`
 * hook) and threaded through every downstream extension hook.
 */

import type { fetchPayload, onLoadDocumentPayload, storePayload } from "@hocuspocus/server";

/**
 * Request body shape for the `POST /convert-document` endpoint in
 * `apps/live/src/controllers/document.controller.ts` — parsed via the Zod
 * schema at line 14 and dispatched to the conversion service at line 32.
 *
 * @property description_html - HTML input to convert.
 * @property variant - Discriminant that selects which TipTap configuration
 *   is used for conversion: `"rich"` for the rich-text extension stack,
 *   `"document"` for the full-document extension stack.
 */
export type TConvertDocumentRequestBody = {
  description_html: string;
  variant: "rich" | "document";
};

/**
 * Extends the Hocuspocus `onLoadDocumentPayload` with the Plane-specific
 * `context` so that load-time extension hooks can read connection metadata
 * (workspace slug, project ID, document type, etc.) without re-parsing the
 * request.
 *
 * Consumer: `apps/live/src/extensions/title-sync.ts:23, 48` — the
 * `onLoadDocument` hook reads `context.workspaceSlug` / `context.projectId`
 * to backfill the Yjs `title` fragment from page metadata.
 */
export interface OnLoadDocumentPayloadWithContext extends onLoadDocumentPayload {
  context: HocusPocusServerContext;
}

/**
 * Extends Hocuspocus `fetchPayload` with the Plane-specific `context` so
 * the database extension's `fetchDocument` hook can resolve the correct
 * page service per workspace/project before reading persisted document
 * state.
 *
 * Consumer: `apps/live/src/extensions/database.ts:20, 26` — the
 * `fetchDocument` hook signature.
 */
export interface FetchPayloadWithContext extends fetchPayload {
  context: HocusPocusServerContext;
}

/**
 * Extends Hocuspocus `storePayload` with the Plane-specific `context` so
 * the database extension's `storeDocument` hook can route the persisted
 * binary / HTML / JSON forms back through the workspace-scoped page
 * service.
 *
 * Consumer: `apps/live/src/extensions/database.ts:20, 77` — the
 * `storeDocument` hook signature.
 */
export interface StorePayloadWithContext extends storePayload {
  context: HocusPocusServerContext;
}

/**
 * Discriminant for the supported collaborative document categories —
 * intentionally narrowed to `"project_page"` because the live server's
 * dispatch table currently maps only this value to a concrete service.
 *
 * Extending the union requires coordinated changes in
 * `apps/live/src/services/page/handler.ts` (service dispatch) and
 * `apps/live/src/lib/auth.ts` (parameter parsing); adding a value here
 * without those changes would break the dispatch table.
 *
 * Consumers: `services/pdf-export/pdf-export.service.ts:13`,
 * `services/page/handler.ts:8`, `lib/auth.ts:15`.
 */
export type TDocumentTypes = "project_page";

// Additional Hocuspocus types that are not exported from the main package
/**
 * Plane-specific metadata attached to every Hocuspocus connection at
 * authentication time in `apps/live/src/lib/auth.ts` (`onAuthenticate`) and
 * threaded through every downstream extension hook so that load / fetch /
 * store handlers can issue authenticated calls against `apps/api` without
 * re-parsing the request.
 *
 * @property projectId - Project UUID, nullable when the document is not
 *   project-scoped.
 * @property cookie - Session cookie passed through to `apps/api` for
 *   authenticated downstream service calls.
 * @property documentType - Discriminant for service dispatch; see
 *   `services/page/handler.ts`.
 * @property workspaceSlug - Workspace slug, nullable in edge cases such as
 *   pre-auth probes.
 * @property userId - Authenticated user UUID.
 *
 * Consumers: `services/page/handler.ts`, `utils/broadcast-error.ts`,
 * `extensions/title-update/title-update-manager.ts`,
 * `extensions/title-sync.ts`, `lib/auth.ts`.
 */
export type HocusPocusServerContext = {
  projectId: string | null;
  cookie: string;
  documentType: TDocumentTypes;
  workspaceSlug: string | null;
  userId: string;
};
