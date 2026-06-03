/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the intake-domain TypeScript types slice of `@plane/types`,
 * re-exporting every symbol declared in `./state` (`TIntakeStateGroups`,
 * `IIntakeState`) through a single stable folder entrypoint.
 *
 * Exists so consumers reach intake types via the `@plane/types` package root
 * (which re-exports `./intake` from `packages/types/src/index.ts`) without
 * coupling to the internal file layout of this slice.
 */

export * from "./state";
