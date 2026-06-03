/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Additional editor asset type placeholder for CE.
 */

/**
 * Type for additional editor asset values beyond the core asset set.
 *
 * Typed as `never` — explicit empty-set discriminator. CE forbids
 * contributing extra asset values; EE may widen this type to register
 * enterprise asset kinds. Consumers can safely write exhaustive switch
 * statements over union types that include `TAdditionalEditorAsset` without
 * `default` branches in CE.
 *
 * Consumed by `core/types/asset.ts` via `@/plane-editor/types/asset`.
 */
export type TAdditionalEditorAsset = never;
