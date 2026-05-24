/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Enterprise-edition authentication extension hooks for the
 * `@plane/types/instance` subfolder. Provides the `never`-valued union members
 * that the enterprise build widens to add SSO / SAML / OIDC / SCIM provider
 * support without modifying community code.
 *
 * CE vs EE: community-edition builds resolve both exports to `never`, so any
 * `T | TExtendedLoginMediums` simplifies to `T`. Enterprise builds replace
 * these declarations with concrete unions inside a separate enterprise overlay.
 *
 * Consumers: `apps/admin/` enterprise auth settings (only when the EE build is
 * active) and `./base.ts` (`TLoginMediums = TCoreLoginMediums |
 * TExtendedLoginMediums`).
 *
 * Included here for type-completeness — community edition itself does NOT
 * consume these types at runtime; the `never` values are inert.
 */

/**
 * Enterprise-only login medium extensions (SAML / OIDC / SCIM). `never` in
 * community edition; widened by the enterprise overlay to a string-literal
 * union of additional medium identifiers. Unioned with `TCoreLoginMediums`
 * to produce `TLoginMediums` in `./base.ts`.
 */
export type TExtendedLoginMediums = never;

/**
 * Enterprise-only auth-mode key extensions. `never` in community edition;
 * widened by the enterprise overlay to additional mode keys
 * (`saml`, `oidc`, etc.) used by the enterprise auth settings UI.
 */
export type TExtendedInstanceAuthenticationModeKeys = never;
