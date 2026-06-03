/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the `Row` layout primitive folder.
 *
 * Star-re-exports every public symbol from `./row.tsx`:
 *   - `Row` — ref-forwarding `<div>` container that applies variant-controlled horizontal padding.
 *   - `RowProps` — typed props interface extending `React.HTMLAttributes<HTMLDivElement>`.
 *   - `ERowVariant` — variant enum (`REGULAR` for default page-edge padding, `HUGGING` for flush edges).
 *
 * Wildcard re-export means any future public exports added to `./row.tsx` automatically flow through
 * this entry point. Consumed transitively by `packages/ui/src/index.ts` and ultimately by `apps/web`,
 * `apps/admin`, and `apps/space` via the `@plane/ui` workspace dependency.
 */

export * from "./row";
