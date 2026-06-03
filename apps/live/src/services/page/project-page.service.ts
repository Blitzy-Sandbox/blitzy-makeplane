/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Concrete project-scoped page service for `apps/live` → `apps/api` HTTP calls.
 *
 * Exports {@link ProjectPageService}, the sole concrete class in the page-service
 * inheritance chain: `APIService` (abstract HTTP base — per-instance axios client,
 * cookie-forwarding interceptor, `AppError` normalization) ← `PageCoreService`
 * (abstract; page CRUD + description-binary sync + mention/image helpers) ←
 * `PageService` (abstract; OSS/enterprise extension boundary) ← `ProjectPageService`
 * (concrete; this file).
 *
 * Construction trigger: instantiated by `getPageService("project_page", context)`
 * in `services/page/handler.ts` once per consumer — either a HocusPocus extension
 * hook (e.g. `extensions/database.ts.fetchDocument` / `storeDocument`,
 * `extensions/title-sync.ts`) or an Express controller request (PDF export,
 * document fetch). Not pooled or cached.
 *
 * Validation contract: the constructor throws {@link AppError} at construction time
 * if `workspaceSlug`, `projectId`, or `cookie` is missing — these fields are required
 * for every downstream API call, so failing fast prevents downstream 4xx noise from
 * the inherited page CRUD methods.
 *
 * Cookie semantics: the session cookie is stored ONCE in the inherited header bag
 * via `setHeader("Cookie", cookie)` so every subsequent inherited call
 * (`fetchDetails`, `fetchDescriptionBinary`, `updatePageProperties`,
 * `updateDescriptionBinary`, `fetchUserMentions`, `resolveImageAssetUrl`) attaches
 * it automatically. Plane uses session cookies for WebSocket-to-HTTP handoff — NOT
 * JWT (per AAP architectural context).
 *
 * Base path: `basePath` is `/api/workspaces/<workspaceSlug>/projects/<projectId>` —
 * the project-scoped page REST prefix on `apps/api`. All inherited methods compose
 * this prefix with the endpoint suffix (e.g. `<basePath>/pages/<pageId>/`).
 *
 * Document lifecycle map (Directive 4 traceability — the connect → edit → persist →
 * disconnect chain is readable here without entering any inherited method body):
 *   - connect (Y.Doc init):    `extensions/database.ts.fetchDocument`        → `fetchDescriptionBinary`
 *   - persist (10 s debounce): `extensions/database.ts.storeDocument`        → `updateDescriptionBinary`
 *   - title sync:              `extensions/title-sync.ts` / `title-update-manager.ts` → `updatePageProperties`
 *   - read (PDF export):       `services/pdf-export/pdf-export.service.ts`   → `fetchDescriptionBinary` + `fetchUserMentions` + `resolveImageAssetUrl`
 */

import { AppError } from "@/lib/errors";
import { PageService } from "./extended.service";

/**
 * Constructor parameter shape for {@link ProjectPageService}.
 *
 * Accepts nullable identifiers because they originate from `HocusPocusServerContext`
 * (which permits `null` until the authentication hook resolves them) plus an open
 * `[key: string]: unknown` index signature so callers may forward the full
 * `HocusPocusServerContext` object — typically via `handler.ts.getPageService` —
 * without TypeScript errors.
 *
 * Field semantics:
 *   - `workspaceSlug` — required; `null` / empty throws `AppError("Missing required fields.")`.
 *   - `projectId` — required; `null` / empty throws `AppError("Missing required fields.")`.
 *   - `cookie` — required; `null` / empty throws `AppError("Cookie is required.")`. Validated
 *     separately from the routing identifiers because cookie absence indicates an
 *     authentication failure, not a missing route.
 *   - `[key: string]: unknown` — index signature; lets the caller pass the full
 *     HocusPocus context without listing every property explicitly.
 */
interface ProjectPageServiceParams {
  workspaceSlug: string | null;
  projectId: string | null;
  cookie: string | null;
  [key: string]: unknown;
}

/**
 * Project-scoped page service — handles every page-related `apps/api` call for a
 * specific workspace + project + session.
 *
 * Inheritance: extends `PageService` (the abstract OSS/enterprise extension
 * boundary) which extends `PageCoreService` (page CRUD + description-binary sync +
 * mention/image helpers) which extends `APIService` (per-instance axios client +
 * cookie-forwarding interceptor + `AppError` normalization).
 *
 * State: stores the project-scoped REST prefix in `protected basePath` for use by
 * all inherited methods in `PageCoreService` — each method composes `this.basePath`
 * with its endpoint suffix.
 *
 * Lifecycle: short-lived. Typically constructed per HocusPocus extension-hook
 * invocation or per controller request, then discarded; not pooled or cached.
 *
 * Thread safety: safe under Node's single-threaded event loop because each
 * instance owns its own axios client and header bag — no shared mutable state
 * across instances.
 */
export class ProjectPageService extends PageService {
  protected basePath: string;

  /**
   * Validates the required context fields, attaches the session cookie to the
   * inherited header bag, and assigns the project-scoped REST prefix.
   *
   * Validation chain:
   *   1. Extract `workspaceSlug` and `projectId`; if either is missing (null/empty),
   *      throws `AppError("Missing required fields.")`. The generic message is
   *      intentional — the caller (typically an extension hook) is responsible for
   *      surfacing a user-facing error.
   *   2. Validate `cookie` separately; if missing, throws
   *      `AppError("Cookie is required.")`. Validated separately because cookie
   *      absence indicates an authentication failure rather than a missing routing
   *      identifier.
   *
   * Side effects on success:
   *   - `setHeader("Cookie", params.cookie)` — stores the cookie in the inherited
   *     in-memory header bag so every subsequent inherited HTTP call attaches it
   *     automatically (canonical cookie-reuse pattern across multiple calls).
   *   - `setHeader("X-CSRFToken", <csrftoken>)` — echoes the session's `csrftoken`
   *     cookie value back as the header `apps/api` expects, so unsafe (PATCH) calls
   *     pass Django's restored CSRF enforcement instead of being rejected with 403.
   *   - Assigns `this.basePath = /api/workspaces/<workspaceSlug>/projects/<projectId>`
   *     — the REST prefix for all project-scoped page endpoints on `apps/api`.
   *
   * @param params - HocusPocus context fields, typically forwarded by
   *   `handler.ts.getPageService`.
   * @throws {AppError} `"Missing required fields."` if `workspaceSlug` or `projectId` is missing.
   * @throws {AppError} `"Cookie is required."` if `cookie` is missing.
   */
  constructor(params: ProjectPageServiceParams) {
    super();
    const { workspaceSlug, projectId } = params;
    if (!workspaceSlug || !projectId) throw new AppError("Missing required fields.");
    // validate cookie
    if (!params.cookie) throw new AppError("Cookie is required.");
    // set cookie
    this.setHeader("Cookie", params.cookie);
    // apps/api restored DRF CSRF enforcement, so unsafe service-to-service PATCHes are
    // rejected with 403 unless the session's csrftoken is echoed in the X-CSRFToken header.
    const csrfToken = ProjectPageService.extractCsrfToken(params.cookie);
    if (csrfToken) {
      this.setHeader("X-CSRFToken", csrfToken);
    }
    // set base path
    this.basePath = `/api/workspaces/${workspaceSlug}/projects/${projectId}`;
  }

  /**
   * Extract Django's CSRF token from a forwarded `Cookie` header value.
   *
   * `apps/api` uses Django's default CSRF configuration (cookie `csrftoken`, header
   * `X-CSRFToken`, `CSRF_USE_SESSIONS` disabled), so the cookie value can be echoed
   * verbatim as the header value to satisfy CSRF on unsafe (PATCH) requests. The
   * `csrftoken` cookie is `HttpOnly` but is still present in the cookie string this
   * service forwards from the WebSocket handshake (HttpOnly blocks browser JS reads,
   * not server-side transmission).
   *
   * @param cookie - The raw `Cookie` header string forwarded from the WebSocket handshake.
   * @returns The `csrftoken` value, or `null` when the cookie is absent.
   */
  private static extractCsrfToken(cookie: string): string | null {
    // Anchor on a cookie boundary (start or "; ") so a key like "csrftoken_x" cannot match.
    const match = cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? match[1] : null;
  }
}
