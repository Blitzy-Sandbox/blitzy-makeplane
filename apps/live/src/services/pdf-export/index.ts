/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel entry point for the `apps/live` PDF export feature.
 *
 * This module establishes the canonical import path `@/services/pdf-export`
 * (resolved via the apps/live tsconfig path alias `@/*` -> `./src/*`) for the
 * PDF export feature, preserving a stable module boundary so concrete file
 * names inside this folder can evolve without breaking consumers.
 *
 * Re-export surface (order preserved — named exports first, then wildcards):
 *  1. `PdfExportService`, `exportToPdf` from `./pdf-export.service` — the
 *     Effect-service runtime engine (`PdfExportService`) and the top-level
 *     orchestration function (`exportToPdf`) that converts a Plane page to a
 *     PDF buffer.
 *  2. `* from "./effect-utils"` — Effect-based resilience helpers used by the
 *     service: `withTimeoutAndRetry` (per-step timeout with exponential-backoff
 *     retry), `recoverWithDefault` (logged fallback for non-fatal failures),
 *     and `tryAsync` (Promise-to-Effect bridge with typed error mapping).
 *  3. `* from "./types"` — shared type contracts: `PdfExportInput`,
 *     `PdfExportResult`, `PageContent`, and `MetadataResult`.
 *
 * Consumer:
 *  - `apps/live/src/controllers/pdf-export.controller.ts` (lines 13-14) imports
 *    `PdfExportService`, `exportToPdf`, and `PdfExportInput` from this barrel
 *    via the `@/services/pdf-export` path alias.
 *
 * Pipeline context (synchronous HTTP — NOT Celery):
 *   The PDF export pipeline is invoked synchronously from an Express controller
 *   decorated with `@plane/decorators` (`@Controller("/pdf-export")`); it is
 *   NOT a queued background task. Per the platform architecture, Celery via
 *   RabbitMQ is reserved for the apps/api backend, and PDF export is a READ
 *   path against pages already persisted by `apps/live/src/extensions/database.ts`
 *   (the Yjs persistence hook that debounces and writes Y.Doc binary state back
 *   to apps/api during prior `connect -> edit -> persist` collaboration cycles).
 *
 * Document lifecycle traceability:
 *   `HTTP request -> fetch persisted page content -> render -> respond`. PDF
 *   export is an out-of-band lifecycle: the controller bypasses the WebSocket
 *   layer that otherwise primarily drives apps/live's real-time Yjs sync.
 *
 * Effect library scope:
 *   The Effect runtime is used ONLY within this folder. Its presence here
 *   reflects the per-step timeout / retry / recovery requirements (image
 *   processing, content fetch, PDF render) that would be cumbersome to express
 *   with raw Promises. Consumers outside this folder interact with the feature
 *   exclusively through `exportToPdf`, which returns a standard `Promise`.
 *
 * Document type scope:
 *   `PdfExportService.getDocumentType` is currently hardcoded to return
 *   `"project_page"` (see `./pdf-export.service.ts`). Only project pages are
 *   supported today; routing by input shape is reserved for future expansion.
 */

export { PdfExportService, exportToPdf } from "./pdf-export.service";
export * from "./effect-utils";
export * from "./types";
