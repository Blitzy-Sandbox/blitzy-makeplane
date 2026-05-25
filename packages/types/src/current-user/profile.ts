/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Leaner alternative `TUserProfile` declared in the `current-user` subfolder;
 * NOT re-exported from the master barrel — the canonical/richer `TUserProfile`
 * lives in `../users.ts` and is the one consumed by stores.
 */
// INTENT UNCLEAR: a separate, leaner `TUserProfile` lives in this folder while a
// richer same-named type lives in `../users.ts`; the canonical/active definition
// is the one in `../users.ts` (no in-repo consumer imports this folder).

/**
 * Current-viewer profile record (leaner alternative to `TUserProfile` in
 * `../users.ts`); `Date | string` timestamps admit both hydrated `Date`
 * objects and serialized ISO strings.
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
