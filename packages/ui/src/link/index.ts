/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Re-exports the link-preview block component.
 *
 * Public entry point for `packages/ui/src/link/`. Wildcard re-export keeps the
 * folder path as the stable import for consumers, so any new named export added
 * to `block.tsx` becomes available here automatically.
 */

export * from "./block";
