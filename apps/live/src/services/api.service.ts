/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared abstract HTTP client base for `apps/live` services targeting `apps/api`.
 *
 * Exports {@link APIService}, the foundational class extended by every concrete service in
 * `apps/live/src/services/`: `UserService` (current-user lookup) and the
 * `PageCoreService` → `PageService` → `ProjectPageService` chain (page CRUD + Yjs description
 * sync). Subclasses inherit a per-instance axios client, uniform error normalization, and an
 * in-memory header bag.
 *
 * Foundation: axios with `withCredentials: true` (cookie forwarding for session-based auth —
 * NOT JWT — which is the foundation of Plane's WebSocket-to-HTTP session handoff in
 * `apps/live`) and a 20-second request timeout. Base URL comes from the optional constructor
 * argument or falls back to `env.API_BASE_URL` (validated as a required URL in
 * `apps/live/src/env.ts`).
 *
 * Error normalization: the response interceptor installed in `setupInterceptors` rewrites every
 * axios failure into an {@link AppError} from `@/lib/errors`, preserving `statusCode` /
 * `method` / `url` / `code` while stripping sensitive request headers, cookies, and full
 * response payloads — bypassing this class (e.g., importing raw `axios`) would leak credentials
 * into log sinks.
 *
 * Header management: `setHeader(key, value)` / `getHeader()` maintain a per-instance mutable
 * `Record<string, string>` used by subclasses to attach the session `Cookie` once at
 * construction so subsequent calls reuse it (see `ProjectPageService.constructor`).
 *
 * HTTP wrappers (`get`, `post`, `put`, `patch`, `delete`, `request`) all return the raw axios
 * response (`Promise<AxiosResponse>`) so callers can destructure `.data` themselves.
 *
 * Lifecycle traceability: this is the HTTP boundary for `connect → edit → persist → disconnect`.
 * `UserService.currentUser(cookie)` validates the session at `connect`;
 * `PageCoreService.updateDescriptionBinary` / `updatePageProperties` write Yjs document state
 * at `edit` / `persist`.
 */

import type { AxiosInstance } from "axios";
import axios from "axios";
import { env } from "@/env";
import { AppError } from "@/lib/errors";

/**
 * Abstract base for all HTTP services in `apps/live` that communicate with `apps/api`.
 *
 * Subclasses:
 *   - `UserService` — current-user lookup (`GET /api/users/me/`) for session validation
 *   - `PageCoreService` (abstract) — page CRUD + Yjs description binary sync
 *   - `PageService` (abstract) — extension boundary; concrete implementation lives in the
 *     enterprise repository
 *   - `ProjectPageService` (concrete) — workspace + project-scoped page service used by
 *     Hocuspocus extensions and controllers
 *
 * Axios configuration: `withCredentials: true` (forwards the Cookie header on cross-origin
 * requests for session-based auth) and a 20-second request timeout (`timeout: 20000` ms).
 *
 * Response interceptor: installed in `setupInterceptors()` — passes successful responses
 * through unchanged and rejects every failure as an {@link AppError} so concrete services
 * receive a uniform, sanitized error shape. Bypassing this class with a raw axios import would
 * leak request headers, cookies, and bodies into log sinks (see `@/lib/errors`).
 *
 * Header reuse: in-memory `header` record populated via `setHeader(key, value)` — typically
 * used by subclasses to attach the session `Cookie` once at construction (see
 * `ProjectPageService.constructor`) so per-method axios configs can spread `getHeader()`
 * instead of repeating the cookie value.
 *
 * Concurrency: each instance owns its own axios client and header bag; multiple instances are
 * safe in concurrent contexts because Node's event loop serializes per-instance state.
 */
export abstract class APIService {
  protected baseURL: string;
  private axiosInstance: AxiosInstance;
  private header: Record<string, string> = {};

  /**
   * Initializes the per-instance axios client and installs the response-to-AppError interceptor.
   *
   * Stores the resolved base URL on `this.baseURL` (protected — subclasses use it for URL
   * building, e.g. `UserService.currentUserConfig()`), creates a per-instance `AxiosInstance`
   * configured with `withCredentials: true` and `timeout: 20000` ms, then wires the error
   * normalization via `setupInterceptors()`.
   *
   * @param baseURL Optional override for the `apps/api` base URL; defaults to
   *                `env.API_BASE_URL` (validated as a required URL in `apps/live/src/env.ts`)
   *                when omitted.
   */
  constructor(baseURL?: string) {
    this.baseURL = baseURL || env.API_BASE_URL;
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      withCredentials: true,
      timeout: 20000,
    });
    this.setupInterceptors();
  }

  /**
   * Installs the response interceptor that wraps every axios error into an {@link AppError}.
   *
   * On success the axios response passes through unchanged; on failure the chain returns
   * `Promise.reject(new AppError(error))`, and `AppError`'s constructor extracts `statusCode`,
   * `method`, `url`, and `code` while stripping verbose `config` / headers / body fields so
   * downstream logs do not leak cookies or tokens. Private and invoked only by the constructor;
   * centralizes error normalization so every concrete service inherits uniform `AppError`
   * semantics without duplicating try/catch blocks.
   */
  private setupInterceptors() {
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        return Promise.reject(new AppError(error));
      }
    );
  }

  /**
   * Stores a request header in the per-instance in-memory `header` record for reuse across calls.
   *
   * Subclasses typically call this during construction to attach the session `Cookie` once (see
   * `ProjectPageService.constructor`) so subsequent requests can spread `getHeader()` rather
   * than repeating the value. Overwrites any existing entry for `key`; does NOT merge
   * multi-value headers.
   *
   * @param key   Header name.
   * @param value Header value (replaces any prior value for `key`).
   */
  setHeader(key: string, value: string) {
    this.header[key] = value;
  }

  /**
   * Returns the in-memory `header` record so callers can spread it into the per-request axios
   * config.
   *
   * Consumed by `PageCoreService` methods (`fetchDetails`, `fetchDescriptionBinary`,
   * `updatePageProperties`, `updateDescriptionBinary`, `fetchUserMentions`,
   * `resolveImageAssetUrl`) to attach the session cookie. The returned reference points at the
   * live record — callers must mutate it only via `setHeader` to keep header semantics
   * consistent across calls.
   *
   * @returns The mutable `Record<string, string>` of headers stored on this instance.
   */
  getHeader() {
    return this.header;
  }

  /**
   * Thin wrapper around `axiosInstance.get`; errors flow through the interceptor as
   * {@link AppError}.
   *
   * The second and third arguments are both spread into a single axios request config (the
   * implementation merges them via `{ ...params, ...config }`), so `params` is treated as
   * additional axios config fields rather than the standard `params` (URL query) field —
   * callers like `UserService.currentUser` pass `{ headers: { Cookie: cookie } }` as `params`
   * to attach the session cookie. Returns the raw `Promise<AxiosResponse>`; consumers typically
   * destructure `.data` or chain `.then(r => r?.data)`.
   *
   * @param url    Relative or absolute URL appended to the configured `baseURL`.
   * @param params Axios config fields merged first into the request config.
   * @param config Additional axios config merged last; wins on key conflicts with `params`.
   */
  get(url: string, params = {}, config = {}) {
    return this.axiosInstance.get(url, {
      ...params,
      ...config,
    });
  }

  /**
   * Thin wrapper around `axiosInstance.post`; errors flow through the interceptor as
   * {@link AppError}.
   *
   * Returns the raw `Promise<AxiosResponse>` so callers can destructure `.data`; `data` is
   * serialized as JSON by axios's default `application/json` content-type unless overridden via
   * `config.headers`.
   *
   * @param url    Relative or absolute URL appended to the configured `baseURL`.
   * @param data   Request body (defaults to `{}`).
   * @param config Additional axios config such as `headers`, `responseType`, `signal`.
   */
  post(url: string, data = {}, config = {}) {
    return this.axiosInstance.post(url, data, config);
  }

  /**
   * Thin wrapper around `axiosInstance.put`; errors flow through the interceptor as
   * {@link AppError}.
   *
   * Used for idempotent full-resource replacements. Returns the raw `Promise<AxiosResponse>` so
   * callers can destructure `.data`.
   *
   * @param url    Relative or absolute URL appended to the configured `baseURL`.
   * @param data   Request body (defaults to `{}`).
   * @param config Additional axios config such as `headers`, `responseType`, `signal`.
   */
  put(url: string, data = {}, config = {}) {
    return this.axiosInstance.put(url, data, config);
  }

  /**
   * Thin wrapper around `axiosInstance.patch`; errors flow through the interceptor as
   * {@link AppError}.
   *
   * Used for partial-resource updates — the common case for page property updates and Yjs
   * description sync (see `PageCoreService.updatePageProperties` and `updateDescriptionBinary`).
   * Returns the raw `Promise<AxiosResponse>` so callers can destructure `.data`.
   *
   * @param url    Relative or absolute URL appended to the configured `baseURL`.
   * @param data   Request body (defaults to `{}`).
   * @param config Additional axios config such as `headers`, `responseType`, `signal`.
   */
  patch(url: string, data = {}, config = {}) {
    return this.axiosInstance.patch(url, data, config);
  }

  /**
   * Thin wrapper around `axiosInstance.delete`; errors flow through the interceptor as
   * {@link AppError}.
   *
   * Axios's `delete` carries the request body in the config's `data` field (unlike `post` /
   * `put` / `patch`), so this wrapper hoists `data` to a top-level parameter for ergonomic
   * call sites (`{ data, ...config }` is forwarded internally). Returns the raw
   * `Promise<AxiosResponse>`.
   *
   * @param url    Relative or absolute URL appended to the configured `baseURL`.
   * @param data   Optional request body — plain object, `null`, or raw string per axios's
   *               flexible `data` typing.
   * @param config Additional axios config such as `headers`, `responseType`, `signal`.
   */
  delete(url: string, data?: Record<string, unknown> | null | string, config = {}) {
    return this.axiosInstance.delete(url, { data, ...config });
  }

  /**
   * Generic axios request wrapper for verbs or configurations not covered by the verb helpers.
   *
   * Rarely used in tree — most call sites prefer `get` / `post` / `put` / `patch` / `delete`
   * for readability. Returns the raw `Promise<AxiosResponse>`; errors flow through the
   * interceptor as {@link AppError}.
   *
   * @param config Full axios request config including `method`, `url`, `headers`, `data`,
   *               `params`, `responseType`, etc.
   */
  request(config = {}) {
    return this.axiosInstance(config);
  }
}
