/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Canonical environment-variable contract for the apps/live Node service.
 *
 * Loads `.env` eagerly via `dotenv.config()` at module-import time, validates `process.env`
 * against a Zod schema, and exports a fully-typed `env` object consumed throughout the
 * application (server, Hocuspocus manager, Redis client, controllers, services).
 *
 * Resolution timing: This is a Node service, NOT a Vite-bundled frontend, so all values are
 * resolved at RUNTIME (not baked in at build time). Changing any value requires a process
 * restart, not a rebuild; the `VITE_*` build-time-baked architectural rule does not apply here.
 *
 * Failure mode: Invalid or missing required env vars trigger `console.error` followed by
 * `process.exit(1)` at module load — the server cannot start without a valid environment.
 *
 * Defaults: `APP_VERSION`, `PORT`, `CORS_ALLOWED_ORIGINS`, `LIVE_BASE_PATH`, `COMPRESSION_LEVEL`,
 * `COMPRESSION_THRESHOLD`, and `REDIS_PORT` ship with defaults. `LIVE_SERVER_SECRET_KEY` and
 * `API_BASE_URL` are REQUIRED with no default.
 */

import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

/**
 * Zod schema describing the apps/live environment contract.
 *
 * Fields without `.default(...)` or `.optional()` are required and cause `process.exit(1)`
 * if absent. String-to-number coercion via `.transform(Number)` applies to `COMPRESSION_LEVEL`,
 * `COMPRESSION_THRESHOLD`, and `REDIS_PORT` so downstream consumers receive `number` types.
 */
const envSchema = z.object({
  /**
   * Semantic version string surfaced by `controllers/health.controller.ts` in the
   * health-check response `version` field. Default `"1.0.0"`.
   */
  APP_VERSION: z.string().default("1.0.0"),
  /**
   * Optional server identity used by `hocuspocus.ts` (`env.HOSTNAME || uuidv4()`) to
   * uniquely tag this instance in multi-node deployments for cluster-wide broadcasts.
   * Falls back to a generated UUID when unset.
   */
  HOSTNAME: z.string().optional(),
  /**
   * HTTP port the Express server binds to via `app.set("port", ...)` in `server.ts`.
   * Default `"3000"` (string here; coerced to number at the call site).
   */
  PORT: z.string().default("3000"),
  /**
   * URL of the upstream Plane API (`apps/api`). REQUIRED — must be a valid URL.
   * Used as the axios `baseURL` for all backend calls made from `services/api.service.ts`.
   */
  API_BASE_URL: z.string().url("API_BASE_URL must be a valid URL"),
  /**
   * Comma-separated list of allowed origins for browser-side WebSocket and HTTP requests.
   * Parsed by `server.ts.setupCors()`. Default `""` (no origins allowed by CORS middleware).
   */
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  /**
   * URL prefix where all live routes are mounted (e.g., `/live/health`). Consumed by
   * `server.ts` via `this.app.use(env.LIVE_BASE_PATH, this.router)`. Default `"/live"`.
   */
  LIVE_BASE_PATH: z.string().default("/live"),
  /**
   * Gzip compression level (0-9) applied to HTTP responses by `server.ts.setupMiddleware()`.
   * Coerced from its string env representation to `number`. Default `6` (balanced).
   */
  COMPRESSION_LEVEL: z.string().default("6").transform(Number),
  /**
   * Minimum response size in bytes before gzip compression kicks in. Coerced from its
   * string env representation to `number`. Default `5000`.
   */
  COMPRESSION_THRESHOLD: z.string().default("5000").transform(Number),
  /**
   * REQUIRED shared secret used by `lib/auth-middleware.ts.requireSecretKey` to validate
   * the `live-server-secret-key` header on protected HTTP routes (e.g., admin endpoints).
   * No default — the server fails to start without it.
   */
  LIVE_SERVER_SECRET_KEY: z.string(),
  /**
   * Redis server hostname used for `redis://${HOST}:${PORT}` URL construction in
   * `redis.ts.getRedisUrl()` when `REDIS_URL` is not provided. Optional.
   * Redis is used for caching and Hocuspocus pub/sub only — task queueing uses RabbitMQ via apps/api.
   */
  REDIS_HOST: z.string().optional(),
  /**
   * Redis port number paired with `REDIS_HOST`. Coerced from its string env representation
   * to `number`. Default `6379`.
   */
  REDIS_PORT: z.string().default("6379").transform(Number),
  /**
   * Full Redis URL (`redis://...` or `rediss://...`). Takes precedence over the
   * `REDIS_HOST`/`REDIS_PORT` pair when set. Optional.
   */
  REDIS_URL: z.string().optional(),
});

/**
 * Parses `process.env` against `envSchema` using `safeParse` (does not throw).
 *
 * On validation failure: logs the formatted Zod error via `console.error` and calls
 * `process.exit(1)` so the process cannot continue with an invalid environment. Returns
 * the parsed, type-coerced env object on success.
 */
const validateEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:", JSON.stringify(result.error.format(), null, 4));
    process.exit(1);
  }
  return result.data;
};

/**
 * Canonical, validated environment object for the apps/live service.
 *
 * Eagerly parsed at module load; downstream code can rely on all fields being present
 * (with defaults applied) and correctly typed (numbers coerced from their string forms).
 * This is the single source of env access in the service — no module re-exports it.
 */
export const env = validateEnv();
