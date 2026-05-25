/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Unsplash API credential key consumed by the project/page cover-image picker
 * in `apps/web`; presence flips `IInstanceConfig.has_unsplash_configured` and
 * enables the Unsplash tab in the picker.
 */

/**
 * Storage key for the Unsplash Access Key (from the developer dashboard);
 * treated as sensitive in transport and masked by the API when read back.
 */
export type TInstanceImageConfigurationKeys = "UNSPLASH_ACCESS_KEY";
