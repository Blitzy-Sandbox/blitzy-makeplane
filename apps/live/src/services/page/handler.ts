/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Page service dispatcher — selects the concrete page service implementation
 * for a given collaborative document type and HocusPocus connection context.
 *
 * Architectural role: this module is the dispatch boundary between Hocuspocus
 * extensions / Express controllers (which carry the connection `context`
 * populated by `apps/live/src/lib/auth.ts.onAuthenticate` but are agnostic to
 * which concrete service class to instantiate) and the underlying `PageService`
 * inheritance chain (which performs the actual `apps/api` HTTP calls). Isolating
 * dispatch here lets callers route by `documentType` without coupling to any
 * concrete service constructor signature.
 *
 * Consumers (document lifecycle entry points — Directive 4 traceability):
 *   - `apps/live/src/extensions/database.ts` — page persistence (the
 *     Hocuspocus `fetch` hook seeds the Y.Doc on connect; the `store` hook
 *     writes the 10-second-debounced binary state on persist).
 *   - `apps/live/src/extensions/title-sync.ts` — title synchronization between
 *     the Y.Doc and the page record on `apps/api`.
 *   - `apps/live/src/extensions/title-update/title-update-manager.ts` —
 *     debounced title updates pushed back to `apps/api`.
 *   - `apps/live/src/services/pdf-export/pdf-export.service.ts` — PDF export
 *     pipeline (reads description binary, user mentions, and image asset URLs).
 *
 * Supported document types: `"project_page"` is the only value currently
 * dispatched (mapped to {@link ProjectPageService}). The single-branch design
 * is intentional — the `if` chain is the canonical extension point for
 * additional collaborative document types (e.g. workspace-level pages) so new
 * branches plug in here without restructuring callers.
 *
 * Error handling: unsupported `documentType` values throw {@link AppError}
 * carrying the offending value in the message for diagnostic clarity.
 */

import { AppError } from "@/lib/errors";
import type { HocusPocusServerContext, TDocumentTypes } from "@/types";
// services
import { ProjectPageService } from "./project-page.service";

/**
 * Resolve the concrete page service instance for a HocusPocus connection.
 *
 * Pure factory — no DB writes, no API calls, no logging. The factory only
 * routes by `documentType`; final validation of `workspaceSlug`, `projectId`,
 * and `cookie` is delegated to {@link ProjectPageService}'s constructor, which
 * throws {@link AppError} on missing fields. Centralizing validation in the
 * concrete service avoids duplicating null/empty checks across every dispatch
 * branch as new document types are added.
 *
 * Context forwarding: the factory accepts the full {@link HocusPocusServerContext}
 * (rather than pre-destructured fields) so callers — typically Hocuspocus
 * extension hooks — can pass `context` straight through without listing the
 * three identifier fields explicitly at every call site.
 *
 * @param documentType - Collaborative document type discriminant. Defined as
 *   the `TDocumentTypes` union in `apps/live/src/types/index.ts`; currently
 *   always `"project_page"`.
 * @param context - Mutable Hocuspocus connection context populated by
 *   `apps/live/src/lib/auth.ts.onAuthenticate`. Only `workspaceSlug`,
 *   `projectId`, and `cookie` are read by this factory; the remaining fields
 *   (`documentType`, `userId`) are consumed by callers and inner services.
 * @returns A concrete page service instance — currently always a
 *   {@link ProjectPageService} — ready for `apps/api` calls.
 * @throws {AppError} When `documentType` does not match a known dispatch
 *   branch; the message embeds the invalid value.
 */
export const getPageService = (documentType: TDocumentTypes, context: HocusPocusServerContext) => {
  if (documentType === "project_page") {
    return new ProjectPageService({
      workspaceSlug: context.workspaceSlug,
      projectId: context.projectId,
      cookie: context.cookie,
    });
  }

  throw new AppError(`Invalid document type ${documentType} provided.`);
};
