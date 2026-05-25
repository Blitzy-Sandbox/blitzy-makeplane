/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Enterprise-edition auth extension hooks (`never` in CE, widened to
 * SSO/SAML/OIDC/SCIM unions by the EE overlay) consumed by `./base.ts`
 * to form `TLoginMediums` — inert at runtime in community builds.
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
