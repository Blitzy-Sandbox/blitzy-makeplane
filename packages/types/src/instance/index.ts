/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for `@plane/types/instance` — re-exports the AI/auth/auth-ee/base/email/
 * image/workspace sub-modules under a single layout-stable namespace consumed
 * by `apps/admin/` and the API license + authentication layers.
 */

export * from "./ai";
export * from "./auth";
export * from "./auth-ee";
export * from "./base";
export * from "./email";
export * from "./image";
export * from "./workspace";
