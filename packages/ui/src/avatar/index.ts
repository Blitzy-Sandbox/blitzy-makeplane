/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the Avatar primitive module of `@plane/ui`.
 *
 * Re-exports the `Avatar` and `AvatarGroup` components so consumers can import
 * them from the folder path (`@plane/ui/avatar`, or transitively from `@plane/ui`)
 * without coupling to the underlying implementation file names.
 */

export * from "./avatar-group";
export * from "./avatar";
