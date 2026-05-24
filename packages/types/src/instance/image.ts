/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Image provider configuration contracts for the `@plane/types/instance`
 * subfolder. Models the Unsplash API credential used to source cover images
 * for projects and pages.
 *
 * Consumers: `apps/admin/` image settings screen (writes the value) and the
 * project / page cover-image picker in `apps/web`. Boot-time presence of this
 * key flips `IInstanceConfig.has_unsplash_configured` to true and enables the
 * Unsplash tab in the cover-image picker.
 */

/**
 * Storage key for the Unsplash API credential persisted in the instance
 * configuration table.
 *
 * Field-level semantics:
 * - `UNSPLASH_ACCESS_KEY`: Unsplash Access Key (sometimes called Application
 *   Access Key) from the Unsplash developer dashboard. Treated as sensitive
 *   in transport; masked by the API when read back to the admin UI.
 */
export type TInstanceImageConfigurationKeys = "UNSPLASH_ACCESS_KEY";
