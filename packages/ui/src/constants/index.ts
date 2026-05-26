/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Re-exports the icon name registries used by Plane's icon-picker UIs.
 *
 * Consumers should import constants from this barrel rather than reaching
 * into individual files so the package can evolve its internal file layout
 * without breaking downstream import paths.
 */
export * from "./icons";
