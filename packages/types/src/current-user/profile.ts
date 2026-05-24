/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Current-viewer profile shape declaration for the `@plane/types/current-user`
 * subfolder.
 *
 * Models identity references, theme preference, onboarding-step booleans, opt-in
 * billing / marketing flags, and audit timestamps for the signed-in viewer's
 * profile.
 *
 * Architectural note — DISTINCT from `../users.ts`'s `TUserProfile`:
 * - `../users.ts` (line 62) declares a richer `TUserProfile` carrying additional
 *   `theme.primary` / `background` / `darkPalette`, `language`,
 *   `start_of_the_week`, and uses the shared `TOnboardingSteps` alias.
 * - That richer type is the one re-exported via the master barrel
 *   (`packages/types/src/index.ts` — `export * from "./users"`) and consumed by
 *   `apps/web/core/store/user/profile.store.ts` (line 13).
 * - The shape declared HERE is leaner and is NOT re-exported from the master
 *   barrel; the package's `exports` field in `package.json` does not expose a
 *   `./current-user` subpath either, so this declaration is effectively
 *   unreachable from outside the package.
 */
// INTENT UNCLEAR: a separate, leaner `TUserProfile` lives in this folder while a
// richer same-named type lives in `../users.ts`; the canonical/active definition
// is the one in `../users.ts` (no in-repo consumer imports this folder).

/**
 * Current-viewer profile record (leaner alternative to `TUserProfile` in
 * `../users.ts`).
 *
 * Field groups:
 * - Identity / relations (`id`, `user`, `role`, `last_workspace_id`) — all
 *   `string | undefined` to allow lazily-hydrated rows.
 * - Theme preference (`theme.theme`) — just the theme-mode key; the richer
 *   palette fields (primary / background / darkPalette) live on `IUserTheme`
 *   in `../users.ts`.
 * - Onboarding state (`onboarding_step.*`, `is_onboarded`, `is_tour_completed`)
 *   — inline booleans rather than a reference to `TOnboardingSteps`.
 * - Use-case (`use_case`) — free-form string captured during onboarding
 *   (e.g. "engineering", "design"); `undefined` when not yet answered.
 * - Billing / marketing-consent (`billing_address_country`, `billing_address`,
 *   `has_billing_address`, `has_marketing_email_consent`).
 * - Audit timestamps (`created_at`, `updated_at`) typed `Date | string` to
 *   admit both in-memory `Date` objects and serialized ISO strings.
 *
 * Conceptual consumers (per AAP intent; no in-repo import sites resolve to
 * this declaration today): `apps/web/core/store/user/profile.store.ts` and the
 * profile settings pages under `apps/web/app/(authenticated)/profile/`.
 */
export type TUserProfile = {
  id: string | undefined;

  user: string | undefined;
  role: string | undefined;
  last_workspace_id: string | undefined;

  theme: {
    /** Theme-mode key (e.g. "light" / "dark" / "custom"); legal values live in UI code, not in the type. */
    theme: string | undefined;
  };

  onboarding_step: {
    workspace_join: boolean;
    profile_complete: boolean;
    workspace_create: boolean;
    workspace_invite: boolean;
  };
  is_onboarded: boolean;
  is_tour_completed: boolean;

  /** Free-form intent captured during onboarding (e.g. "engineering", "design"); `undefined` when not yet answered. */
  use_case: string | undefined;

  billing_address_country: string | undefined;
  billing_address: string | undefined;
  has_billing_address: boolean;
  has_marketing_email_consent: boolean;

  /** `Date` object after client-side hydration; ISO string when freshly deserialized from JSON. */
  created_at: Date | string;
  /** `Date` object after client-side hydration; ISO string when freshly deserialized from JSON. */
  updated_at: Date | string;
};
