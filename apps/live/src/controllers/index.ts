/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { CollaborationController } from "./collaboration.controller";
import { DocumentController } from "./document.controller";
import { HealthController } from "./health.controller";
import { PdfExportController } from "./pdf-export.controller";

/**
 * Ordered list of decorator-driven controllers registered onto the live server.
 *
 * Consumed by `apps/live/src/server.ts:setupRoutes`, which iterates this array
 * and calls `registerController(router, controller, [hocuspocusServer])` from
 * `@plane/decorators` to attach each controller's routes to the Express router
 * mounted at `env.LIVE_BASE_PATH` (default `/live`).
 *
 * Registration order (preserve when modifying):
 *   1. `CollaborationController` → `/live/collaboration/*` (WebSocket gateway)
 *   2. `DocumentController`      → `/live/convert-document/*`
 *   3. `HealthController`        → `/live/health/*`
 *   4. `PdfExportController`     → `/live/pdf-export/*`
 *
 * The `[hocuspocusServer]` argument array is forwarded to each controller's
 * constructor; only `CollaborationController` consumes it, but the array shape
 * is shared across all entries so the registration loop stays uniform.
 *
 * Adding a new controller: import the class here and append it to this array.
 * Routing metadata is supplied by each controller's `@Controller`/`@Get`/`@Post`/
 * `@WebSocket` decorators — no additional wiring is required.
 */
export const CONTROLLERS = [CollaborationController, DocumentController, HealthController, PdfExportController];
