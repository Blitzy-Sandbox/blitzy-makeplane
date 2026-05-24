/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the `@plane/types/instance` subfolder — re-exports every
 * instance-related type definition under a single, layout-stable public namespace.
 *
 * Re-exported sub-modules:
 * - `./ai` — AI provider configuration key union (`TInstanceAIConfigurationKeys`).
 * - `./auth` — community-edition authentication provider configuration types
 *   (modes, method/feature flags, provider config keys, OAuth option/config shapes,
 *   `TCoreLoginMediums`).
 * - `./auth-ee` — enterprise-edition authentication extension stubs
 *   (`TExtendedLoginMediums`, `TExtendedInstanceAuthenticationModeKeys`); both are
 *   currently `never` in community edition.
 * - `./base` — core instance identity and configuration entities
 *   (`IInstance`, `IInstanceConfig`, `IInstanceInfo`, `IInstanceAdmin`,
 *   `IInstanceConfiguration`, `TInstanceConfigurationKeys`,
 *   `IFormattedInstanceConfiguration`, `TLoginMediums`).
 * - `./email` — email/SMTP provider configuration key union.
 * - `./image` — image provider (Unsplash) configuration key union.
 * - `./workspace` — instance-scoped workspace configuration key union
 *   (e.g. `DISABLE_WORKSPACE_CREATION`).
 *
 * Consumers: `apps/admin/` instance management screens, `apps/api/plane/license/`
 * (mirrors the runtime instance contract), `apps/api/plane/authentication/`, and
 * `apps/web` (read-only display).
 */

export * from "./ai";
export * from "./auth";
export * from "./auth-ee";
export * from "./base";
export * from "./email";
export * from "./image";
export * from "./workspace";
