/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the `current-user` types subfolder.
 *
 * Re-exports every public symbol declared in `./profile.ts` so the folder can be
 * imported as a single directory-level entrypoint.
 *
 * Public-API status:
 * - This folder is NOT re-exported from `packages/types/src/index.ts` (the master
 *   barrel) and the package's `exports` field in `package.json` does not expose a
 *   `./current-user` subpath — consumers outside the package therefore cannot reach
 *   any symbol declared here through normal `@plane/types` imports.
 * - The `TUserProfile` actively consumed by stores (e.g.
 *   `apps/web/core/store/user/profile.store.ts`) is the one declared in `../users.ts`
 *   (re-exported via the master barrel), not the leaner shape declared in
 *   `./profile.ts`.
 */
// INTENT UNCLEAR: this folder declares its own `TUserProfile` type but is not wired
// into the package's public exports, and no in-repo consumer imports from it.

export * from "./profile";
