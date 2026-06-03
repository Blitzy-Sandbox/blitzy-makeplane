/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared core page service -- the HTTP boundary between apps/live and apps/api for ALL
 * page-related REST operations. Exports {@link TUserMention} (the user-mention shape
 * returned by the mentions endpoint) and {@link PageCoreService} (the abstract base
 * class that encapsulates the page REST surface).
 *
 * Architectural role: this layer knows page REST endpoints and error semantics; it does
 * NOT know about workspace/project scoping. Scoping is supplied by concrete subclasses
 * (notably `ProjectPageService` in `./project-page.service.ts`) via the abstract
 * `basePath` field -- e.g., `/api/workspaces/${slug}/projects/${id}`.
 *
 * Inherited capabilities (from `APIService` in `../api.service.ts`):
 *   - axios client created with `withCredentials: true` and a 20-second timeout.
 *   - `setHeader(key, value)` / `getHeader()` used by `ProjectPageService` to attach the
 *     forwarded session cookie ONCE in its constructor so all methods below pick it up
 *     automatically via `this.getHeader()`.
 *   - response interceptor that wraps axios failures in `AppError` so every reject is a
 *     uniform error shape.
 *
 * Methods provided:
 *   - `fetchDetails(pageId)` -- `GET ${basePath}/pages/${pageId}/` -> `TPage`.
 *   - `fetchDescriptionBinary(pageId)` -- `GET ${basePath}/pages/${pageId}/description/`
 *     with `Content-Type: application/octet-stream` and `responseType: "arraybuffer"`;
 *     returns the raw Yjs binary state as a Node.js `Buffer`.
 *   - `updatePageProperties(pageId, { data, abortSignal })` --
 *     `PATCH ${basePath}/pages/${pageId}/` with cooperative cancellation via
 *     `AbortSignal`.
 *   - `updateDescriptionBinary(pageId, data)` --
 *     `PATCH ${basePath}/pages/${pageId}/description/` for Yjs binary updates.
 *   - `fetchUserMentions(pageId)` --
 *     `GET ${basePath}/pages/${pageId}/mentions/?mention_type=user_mention` ->
 *     `TUserMention[]`. INTENT UNCLEAR: no matching OSS route was found in
 *     `apps/api/plane/app/urls/page.py` -- this endpoint is either provided by an
 *     enterprise-only URL config or is pending implementation; the contract here
 *     reflects the request the live server emits, not a verified backend route.
 *   - `resolveImageAssetUrl(workspaceSlug, assetId, projectId?)` -- resolves an asset
 *     UUID to its presigned S3 URL by intercepting the apps/api 302 redirect (the
 *     binary asset itself is NOT downloaded by apps/live).
 *   - `resolveImageAssetUrls(workspaceSlug, assetIds[], projectId?)` -- batch wrapper
 *     using `Promise.allSettled`; failures are silently dropped from the returned map.
 *
 * Document lifecycle role (per AAP Directive 4 -- connect -> edit -> persist ->
 * disconnect): this file is the HTTP boundary for the `connect` (Y.Doc seed via
 * `fetchDescriptionBinary`), `persist` (Y.Doc write-back via `updateDescriptionBinary`),
 * `title sync` (`updatePageProperties` with abort signal), and `read` (PDF export
 * pipeline) phases. The debounced 10-second persistence loop lives in
 * `extensions/database.ts` -- this module only owns the HTTP wire calls.
 *
 * Cross-reference: page descriptions are stored as Yjs binary state in apps/api;
 * `extensions/database.ts` uses `fetchDescriptionBinary` + `updateDescriptionBinary` to
 * implement the 10-second debounced persistence loop described in tech spec section
 * 5.2.5.4.
 */

import { logger } from "@plane/logger";
import type { TDocumentPayload, TPage } from "@plane/types";
// services
import { AppError } from "@/lib/errors";
import { APIService } from "../api.service";

/**
 * Shape of a single user mention returned by the apps/api endpoint
 * `${basePath}/pages/${pageId}/mentions/?mention_type=user_mention`.
 *
 * Fields:
 *   - `id` -- user UUID.
 *   - `display_name` -- full name or username for rendering.
 *   - `avatar_url` -- optional URL to the user's avatar image (absent for users
 *     without an uploaded avatar; consumers must handle the `undefined` case).
 */
export type TUserMention = {
  id: string;
  display_name: string;
  avatar_url?: string;
};

/**
 * Abstract base class for project/workspace-scoped page services -- encapsulates ALL
 * page REST endpoints in a single place so subclasses only need to supply the scoping
 * prefix.
 *
 * Abstract member:
 *   - `protected abstract basePath: string` -- concrete subclasses MUST assign the
 *     workspace/project-scoped REST prefix (e.g.,
 *     `/api/workspaces/${slug}/projects/${id}`).
 *
 * Inheritance chain: `APIService` <- `PageCoreService` <- `PageService` (the OSS/
 * enterprise boundary in `./extended.service.ts`) <- `ProjectPageService` (the
 * concrete instantiation in `./project-page.service.ts`).
 *
 * Error handling pattern (uniform across every public method): caught errors are
 * wrapped in `AppError` with `context: { operation: <methodName>, pageId }`, logged
 * via `@plane/logger`, and rethrown -- so callers see one consistent error shape
 * regardless of the underlying axios / DOMException / native Error origin.
 */
export abstract class PageCoreService extends APIService {
  protected abstract basePath: string;

  /**
   * Pass-through to `super()` -- `PageCoreService` itself has no state to initialize.
   * Subclasses (`ProjectPageService`) are responsible for assigning `basePath` and
   * calling `setHeader("Cookie", ...)` so all inherited methods automatically attach
   * the forwarded session cookie via `this.getHeader()`.
   */
  constructor() {
    super();
  }

  /**
   * Retrieves the full `TPage` shape (title, properties, metadata, etc.) for a given
   * page via `GET ${this.basePath}/pages/${pageId}/`. The inherited session-cookie
   * header is attached via `this.getHeader()`.
   *
   * @param pageId - The page UUID.
   * @returns The full `TPage` shape (defined in `@plane/types`).
   * @throws `AppError` with `context: { operation: "fetchDetails", pageId }` on
   *   network/HTTP failure; the error is logged via
   *   `logger.error("Failed to fetch page details", appError)` before rethrow.
   */
  async fetchDetails(pageId: string): Promise<TPage> {
    try {
      const response = await this.get(`${this.basePath}/pages/${pageId}/`, {
        headers: this.getHeader(),
      });
      return response?.data as TPage;
    } catch (error) {
      const appError = new AppError(error, {
        context: { operation: "fetchDetails", pageId },
      });
      logger.error("Failed to fetch page details", appError);
      throw appError;
    }
  }

  /**
   * Retrieves the page description as a raw Yjs binary state via
   * `GET ${this.basePath}/pages/${pageId}/description/`. Called by
   * `extensions/database.ts.fetchDocument` to seed the Y.Doc on WebSocket connect, and
   * by the PDF export service when rendering page content.
   *
   * HTTP request specifics:
   *   - inherited session-cookie header,
   *   - explicit `Content-Type: application/octet-stream`,
   *   - `responseType: "arraybuffer"` -- forces axios to return the raw binary instead
   *     of attempting JSON deserialization.
   *
   * @param pageId - The page UUID.
   * @returns A Node.js `Buffer` containing the raw Yjs binary state.
   * @throws `Error("Expected response to be a Buffer")` if axios returns a non-Buffer
   *   body (defensive check that should never fire with `responseType: "arraybuffer"`).
   *   All other failures are wrapped in `AppError` with
   *   `context: { operation: "fetchDescriptionBinary", pageId }`, logged, then
   *   rethrown.
   */
  async fetchDescriptionBinary(pageId: string): Promise<Buffer> {
    try {
      const response = await this.get(`${this.basePath}/pages/${pageId}/description/`, {
        headers: {
          ...this.getHeader(),
          "Content-Type": "application/octet-stream",
        },
        responseType: "arraybuffer",
      });
      const data = response?.data;
      if (!Buffer.isBuffer(data)) {
        throw new Error("Expected response to be a Buffer");
      }
      return data;
    } catch (error) {
      const appError = new AppError(error, {
        context: { operation: "fetchDescriptionBinary", pageId },
      });
      logger.error("Failed to fetch page description binary", appError);
      throw appError;
    }
  }

  /**
   * Updates the title of a page
   *
   * Implementation actually performs a generic PATCH of any `Partial<TPage>` -- the
   * "title" framing in the original JSDoc reflects the dominant caller
   * (`extensions/title-update/title-update-manager.ts` for title sync), but the
   * endpoint accepts any subset of page fields (name, properties JSON, etc.).
   *
   * HTTP: `PATCH ${this.basePath}/pages/${pageId}/` with inherited session-cookie
   * header and axios `signal` field (so axios cancels its own pending request when
   * the signal fires).
   *
   * Abort-signal handling:
   *   - Early-abort check -- if `abortSignal.aborted` is already `true` on entry,
   *     immediately throws `AppError(new DOMException("Aborted", "AbortError"))`
   *     without dispatching the HTTP request.
   *   - Race-based cancellation -- a side-promise is built that rejects with the same
   *     `AppError(AbortError)` when the signal fires; `Promise.race` is used so
   *     cancellation rejects the awaited result immediately rather than waiting for
   *     axios's own abort to propagate.
   *   - Cleanup -- the `finally` block removes the abort listener to prevent leaks
   *     (critical because the same `AbortSignal` is reused across many
   *     `updatePageProperties` calls in `title-update-manager.ts`).
   *
   * Error code semantics: when `appError.code === "ABORT_ERROR"` the error is
   * rethrown WITHOUT being logged -- abort is an expected control-flow signal, not an
   * incident. All other errors are logged via
   * `logger.error("Failed to update page properties", appError)` before rethrow.
   *
   * @param pageId - The page UUID.
   * @param params - PATCH parameters:
   *   - `data: Partial<TPage>` -- the partial update payload.
   *   - `abortSignal?: AbortSignal` -- optional signal for cooperative cancellation.
   *     `title-update-manager.ts` uses this to cancel in-flight title updates the
   *     moment the user resumes typing.
   * @returns The updated `TPage`.
   */
  async updatePageProperties(
    pageId: string,
    params: { data: Partial<TPage>; abortSignal?: AbortSignal }
  ): Promise<TPage> {
    const { data, abortSignal } = params;

    // Early abort check
    if (abortSignal?.aborted) {
      throw new AppError(new DOMException("Aborted", "AbortError"));
    }

    // Create an abort listener that will reject the pending promise
    let abortListener: (() => void) | undefined;
    const abortPromise = new Promise((_, reject) => {
      if (abortSignal) {
        abortListener = () => {
          reject(new AppError(new DOMException("Aborted", "AbortError")));
        };
        abortSignal.addEventListener("abort", abortListener);
      }
    });

    try {
      return await Promise.race([
        this.patch(`${this.basePath}/pages/${pageId}/`, data, {
          headers: this.getHeader(),
          signal: abortSignal,
        })
          .then((response) => response?.data)
          .catch((error) => {
            const appError = new AppError(error, {
              context: { operation: "updatePageProperties", pageId },
            });

            if (appError.code === "ABORT_ERROR") {
              throw appError;
            }

            logger.error("Failed to update page properties", appError);
            throw appError;
          }),
        abortPromise,
      ]);
    } finally {
      // Clean up abort listener
      if (abortSignal && abortListener) {
        abortSignal.removeEventListener("abort", abortListener);
      }
    }
  }

  /**
   * PATCHes the page's description binary via
   * `PATCH ${this.basePath}/pages/${pageId}/description/`. Called by
   * `extensions/database.ts.storeDocument` after the 10-second debounce window
   * expires.
   *
   * Cross-reference: tech spec section 5.2.5.4 -- the 10-second debounce +
   * HTML->binary backfill behavior lives in `extensions/database.ts`, not here. This
   * method is the HTTP boundary only.
   *
   * @param pageId - The page UUID.
   * @param data - `TDocumentPayload` from `@plane/types` -- contains the Yjs binary,
   *   JSON, HTML, and stripped text representations. apps/api stores all four so
   *   legacy HTML->binary backfill (per tech spec section 5.2.5.4) can run
   *   idempotently on subsequent loads.
   * @returns The server response data (typed as `any` because callers do not inspect
   *   it; the operation is fire-and-acknowledge).
   * @throws `AppError` with `context: { operation: "updateDescriptionBinary", pageId }`
   *   on failure; logged via
   *   `logger.error("Failed to update page description binary", appError)` before
   *   rethrow.
   */
  async updateDescriptionBinary(pageId: string, data: TDocumentPayload): Promise<any> {
    try {
      const response = await this.patch(`${this.basePath}/pages/${pageId}/description/`, data, {
        headers: this.getHeader(),
      });
      return response?.data as unknown;
    } catch (error) {
      const appError = new AppError(error, {
        context: { operation: "updateDescriptionBinary", pageId },
      });
      logger.error("Failed to update page description binary", appError);
      throw appError;
    }
  }

  /**
   * Fetches user mentions for a page
   *
   * Retrieves the list of users mentioned (`@user` references) in the page's
   * description; consumed by PDF export
   * (`services/pdf-export/pdf-export.service.ts`) to render mention chips inside the
   * exported PDF.
   *
   * HTTP: `GET ${this.basePath}/pages/${pageId}/mentions/?mention_type=user_mention`
   * with the inherited session-cookie header.
   *
   * INTENT UNCLEAR: no matching route exists in `apps/api/plane/app/urls/page.py`
   * (the only `user_mention` reference in the OSS apps/api is the search ViewSet
   * `apps/api/plane/app/views/search/base.py`, which has different request semantics).
   * The endpoint may be provided by an enterprise-only URL config or be pending
   * implementation. The contract here reflects what the live server emits, not a
   * verified backend route. Callers must tolerate failure -- the PDF export
   * pipeline already recovers with `[]` via `recoverWithDefault` in
   * `services/pdf-export/pdf-export.service.ts`.
   *
   * Empty-list semantics: returns `[]` when the response data is `null` or
   * `undefined` (`?? []`) -- a page with no mentions is a normal state, not an error.
   *
   * Error handling: failures wrapped in `AppError` with
   * `context: { operation: "fetchUserMentions", pageId }`, logged via
   * `logger.error("Failed to fetch user mentions", appError)`, and rethrown.
   *
   * @param pageId - The page ID
   * @returns Array of user mentions
   */
  async fetchUserMentions(pageId: string): Promise<TUserMention[]> {
    try {
      // INTENT UNCLEAR: no OSS apps/api route found for page mentions endpoint
      const response = await this.get(`${this.basePath}/pages/${pageId}/mentions/`, {
        headers: this.getHeader(),
        params: {
          mention_type: "user_mention",
        },
      });
      return (response?.data as TUserMention[]) ?? [];
    } catch (error) {
      const appError = new AppError(error, {
        context: { operation: "fetchUserMentions", pageId },
      });
      logger.error("Failed to fetch user mentions", appError);
      throw appError;
    }
  }

  /**
   * Resolves an image asset ID to its actual URL by following the 302 redirect
   *
   * The redirect is intercepted, NOT followed -- the binary asset itself is never
   * downloaded by apps/live; only its presigned URL is returned for downstream
   * consumers (e.g., the PDF exporter) to fetch directly.
   *
   * Endpoint paths:
   *   - Project-scoped:
   *     `/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/${assetId}/?disposition=inline`
   *   - Workspace-scoped (no `projectId`):
   *     `/api/assets/v2/workspaces/${workspaceSlug}/${assetId}/?disposition=inline`
   *
   * Critical axios config:
   *   - `maxRedirects: 0` -- prevents axios from following the redirect, otherwise
   *     it would fetch the presigned URL and we would never observe the URL itself.
   *   - `validateStatus: (status) => status >= 200 && status < 400` -- accepts 3xx
   *     as success (302 is the expected happy path).
   *
   * Return value:
   *   - On 302/301 captured as a normal response: returns
   *     `response.headers?.location` (the presigned S3 URL) or `null` if the
   *     `Location` header is missing.
   *   - On 200 (apps/api returned content directly without redirecting): returns
   *     `null`.
   *   - On axios throwing for 3xx with `maxRedirects: 0`: the catch block extracts
   *     `error.response.headers.location` for the same effect.
   *   - On any other failure: logs metadata via
   *     `logger.error("Failed to resolve image asset URL", { assetId, workspaceSlug, error: message })`
   *     (intentionally NOT an `AppError` log -- the failure is recoverable; the
   *     caller substitutes a placeholder) and returns `null`.
   *
   * @param workspaceSlug - The workspace slug
   * @param assetId - The asset UUID
   * @param projectId - Optional project ID for project-specific assets
   * @returns The resolved image URL (presigned S3 URL)
   */
  async resolveImageAssetUrl(
    workspaceSlug: string,
    assetId: string,
    projectId?: string | null
  ): Promise<string | null> {
    const path = projectId
      ? `/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/${assetId}/?disposition=inline`
      : `/api/assets/v2/workspaces/${workspaceSlug}/${assetId}/?disposition=inline`;

    try {
      const response = await this.get(path, {
        headers: this.getHeader(),
        maxRedirects: 0,
        validateStatus: (status: number) => status >= 200 && status < 400,
      });
      // If we get a 302, the Location header contains the presigned URL
      if (response.status === 302 || response.status === 301) {
        return response.headers?.location || null;
      }
      return null;
    } catch (error) {
      // Axios throws on 3xx when maxRedirects is 0, so we need to handle the redirect from the error
      if ((error as any).response?.status === 302 || (error as any).response?.status === 301) {
        return (error as any).response.headers?.location || null;
      }
      logger.error("Failed to resolve image asset URL", {
        assetId,
        workspaceSlug,
        error: (error as any).message,
      });
      return null;
    }
  }

  /**
   * Resolves multiple image asset IDs to their actual URLs
   *
   * Batch wrapper around {@link resolveImageAssetUrl} for processing many assets in
   * one shot. Typically called by PDF export to resolve every image asset URL in a
   * single pass before fetching the actual images for embedding.
   *
   * Concurrency: uses `Promise.allSettled` so a per-asset failure does NOT abort the
   * batch -- failed (or `null`-resolving) assets are silently dropped from the
   * returned map. Partial results are intentionally acceptable; callers that need
   * to detect drops must compare `urlMap.size` to `assetIds.length`.
   *
   * @param workspaceSlug - The workspace slug
   * @param assetIds - Array of asset UUIDs
   * @param projectId - Optional project ID for project-specific assets
   * @returns Map of assetId to resolved URL
   */
  async resolveImageAssetUrls(
    workspaceSlug: string,
    assetIds: string[],
    projectId?: string | null
  ): Promise<Map<string, string>> {
    const urlMap = new Map<string, string>();

    // Resolve all asset URLs in parallel
    const results = await Promise.allSettled(
      assetIds.map(async (assetId) => {
        const url = await this.resolveImageAssetUrl(workspaceSlug, assetId, projectId);
        return { assetId, url };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.url) {
        urlMap.set(result.value.assetId, result.value.url);
      }
    }

    return urlMap;
  }
}
