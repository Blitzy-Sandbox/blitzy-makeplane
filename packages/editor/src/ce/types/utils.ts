/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Dropbar extension type placeholders for CE.
 */

/**
 * Names of additional dropbar extensions beyond the core set.
 *
 * Typed as `never` — empty extension slot for the dropbar UI's
 * active-extension union. CE contributes no extra dropbar entries; EE may
 * widen to register enterprise dropbar items. Consumed by
 * `core/extensions/utility.ts` to narrow union types over active dropbar
 * extensions; exhaustive switch statements over the union compile to no-ops
 * in CE without `default` branches.
 */
export type TAdditionalActiveDropbarExtensions = never;
