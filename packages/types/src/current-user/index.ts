/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for `current-user` — re-exports `./profile`, but the folder is NOT
 * wired into the master `packages/types/src/index.ts` barrel nor the package
 * `exports` field, so consumers reach the canonical `TUserProfile` via
 * `../users.ts` instead of the leaner shape declared in `./profile.ts`.
 */
// INTENT UNCLEAR: this folder declares its own `TUserProfile` type but is not wired
// into the package's public exports, and no in-repo consumer imports from it.

export * from "./profile";
