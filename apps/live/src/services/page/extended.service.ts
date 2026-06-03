/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Page service extension boundary for the live collaboration server.
 *
 * This module exports the abstract `PageService` class — the OSS/enterprise
 * extension boundary in the page-service hierarchy. It sits between
 * `PageCoreService` (the shared HTTP foundation) and concrete subclasses
 * such as `ProjectPageService` so the enterprise repository can inject
 * additional behavior at this layer without modifying either the core
 * service (shared with OSS) or the project-scoped subclass.
 *
 * Inheritance chain: `APIService` (axios transport) ← `PageCoreService`
 * (abstract; page HTTP methods) ← `PageService` (this file; OSS/enterprise
 * boundary) ← `ProjectPageService` (concrete; project-scoped).
 *
 * In OSS this layer is intentionally minimal — a pass-through that only
 * forwards `super()` — so future engineers do not "fix" the empty class.
 * Implementation for this is found in the enterprise repository.
 */

import { PageCoreService } from "./core.service";

/**
 * This is the extended service for the page service.
 * It extends the core service and adds additional functionality.
 * Implementation for this is found in the enterprise repository.
 *
 * In OSS this class is a stub: the constructor defers entirely to
 * `super()` and no additional methods or state are declared. Subclasses
 * MUST call `super()` to inherit `PageCoreService`'s axios client and
 * header bag.
 *
 * Abstract members inherited:
 * - `basePath` — declared as `protected abstract basePath: string` on
 *   `PageCoreService`; concrete subclasses MUST assign it in their own
 *   constructors (see `ProjectPageService` in `project-page.service.ts`).
 *
 * Methods inherited from `PageCoreService` (all rely on the
 * subclass-assigned `basePath` and the inherited session cookie header):
 * - `fetchDetails(pageId)` — GET `<basePath>/pages/<id>/`
 * - `fetchDescriptionBinary(pageId)` — GET `<basePath>/pages/<id>/description/` as Buffer
 * - `updatePageProperties(pageId, params)` — PATCH `<basePath>/pages/<id>/`
 * - `updateDescriptionBinary(pageId, data)` — PATCH `<basePath>/pages/<id>/description/`
 * - `fetchUserMentions(pageId)` — GET `<basePath>/pages/<id>/mentions/`
 * - `resolveImageAssetUrl(workspaceSlug, assetId, projectId?)` — resolves a 302 redirect to a presigned S3 URL
 * - `resolveImageAssetUrls(workspaceSlug, assetIds, projectId?)` — batch variant returning a `Map<assetId, url>`
 */
export abstract class PageService extends PageCoreService {
  /**
   * Trivial pass-through to `super()` so concrete subclasses inherit the
   * axios client and header bag from `PageCoreService` / `APIService`. No
   * state initialization happens here in OSS; this constructor exists
   * solely to satisfy TypeScript's abstract-class instantiation rules and
   * to keep the OSS/enterprise extension contract stable.
   */
  constructor() {
    super();
  }
}
