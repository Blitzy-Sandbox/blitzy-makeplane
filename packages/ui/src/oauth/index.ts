/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel entry point for the `@plane/ui` OAuth presentation surface.
 *
 * Re-exports the public OAuth UI API — the `TOAuthOption` type alias and
 * the `OAuthOptions` renderer component — from `./oauth-options`. The
 * `OAuthButton` primitive in `./oauth-button` is intentionally kept
 * unexported here because it is an internal building block consumed by
 * `OAuthOptions`; surfacing it would widen the public API and couple
 * downstream callers to the single-button rendering primitive.
 *
 * Consumers should import from `@plane/ui` rather than reaching into this
 * folder directly so that the OAuth surface can evolve without churning
 * call sites (e.g., `apps/web/core/components/account/auth-forms/auth-root.tsx`).
 */

export * from "./oauth-options";
