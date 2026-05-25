/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the `@plane/types/favorite` namespace.
 *
 * Re-exports the favorite (bookmark) entity contracts defined in `./favorite.ts`
 * so that consumers can import from `@plane/types/favorite` rather than the
 * deeper implementation file. Type-only surface — erased at build time.
 *
 * Consumers:
 * - `apps/web/core/store/favorite.store.ts` (MobX store for favorites)
 * - `apps/web/core/components/workspace/sidebar/favorites/` (sidebar UI tree)
 * - `apps/web/core/services/favorite/favorite.service.ts` (REST client)
 * - `apps/web/core/hooks/use-favorite-item-details.tsx`
 * - `apps/web/core/hooks/store/use-favorite.ts`
 * - `apps/web/core/constants/sidebar-favorites.ts`
 * - `packages/services/src/user/favorite.service.ts`
 */

export * from "./favorite";
