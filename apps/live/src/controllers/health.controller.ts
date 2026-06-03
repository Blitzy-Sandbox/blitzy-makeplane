/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Request, Response } from "express";
import { Controller, Get } from "@plane/decorators";
import { env } from "@/env";

/**
 * Liveness/readiness controller exposing a single public health endpoint.
 *
 * Mount path:
 *   - Internal: `/health` (via `@Controller("/health")`)
 *   - External: `/live/health` (composed with `env.LIVE_BASE_PATH`, default `/live`)
 *
 * Decorators consumed from `@plane/decorators`:
 *   - `@Controller("/health")` — mounts the class on the live-server router
 *   - `@Get("/")` — registers the GET handler at the controller root
 *
 * Auth requirement: none. This is a public probe consumed by load balancers,
 * uptime monitors, and deployment verification jobs; gating it behind auth
 * would defeat its purpose.
 */
@Controller("/health")
export class HealthController {
  /**
   * Returns the live server's operational status snapshot.
   *
   * HTTP method: GET
   * Route: `/` (relative to controller mount — externally `/live/health`)
   * Request body: none
   * Response (200):
   *   - `status` (string): always `"OK"` when the process is serving requests
   *   - `timestamp` (string): ISO 8601 request-time stamp
   *   - `version` (string): build version sourced from `env.APP_VERSION`
   *
   * Used as the liveness/readiness probe; intentionally synchronous and
   * dependency-free so it succeeds even when Redis or the API are degraded.
   */
  @Get("/")
  async healthCheck(_req: Request, res: Response) {
    res.status(200).json({
      status: "OK",
      timestamp: new Date().toISOString(),
      version: env.APP_VERSION,
    });
  }
}
