/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Maximum number of stickies fetched per pagination page from the stickies list endpoint.
 *
 * Consumers: `apps/web/core/components/stickies/**` and `apps/web/core/store/sticky/sticky.store.ts`
 * for windowed list rendering and infinite-scroll pagination.
 */
export const STICKIES_PER_PAGE = 30;
