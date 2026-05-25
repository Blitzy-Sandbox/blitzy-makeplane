/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core login-medium label registry. This module defines the base mapping of
 * the always-available `TCoreLoginMediums` keys to user-facing display
 * strings, merged with `EXTENDED_LOGIN_MEDIUM_LABELS` by the barrel
 * `index.ts` to produce the unified `LOGIN_MEDIUM_LABELS` map.
 *
 * Consumers: `packages/constants/src/auth/index.ts` (composition site);
 * downstream UI consumers read through `LOGIN_MEDIUM_LABELS` from the
 * `@plane/constants` barrel rather than this module directly.
 */

import type { TCoreLoginMediums } from "@plane/types";

/**
 * Display labels for the core authentication mediums always supported by the
 * platform (email/password, magic code, and the always-enabled OAuth
 * providers). Keys are typed by `TCoreLoginMediums` from `@plane/types` so a
 * missing or stale key surfaces as a compile-time error.
 *
 * Consumers: `packages/constants/src/auth/index.ts` (merged into
 * `LOGIN_MEDIUM_LABELS`), then transitively `apps/web/ce/components/workspace/settings/useMemberColumns.tsx`
 * and any other UI translating a normalized login-medium key into display
 * text.
 *
 * Values:
 * - `email`: "Email" — standard email + password login
 * - `magic-code`: "Magic code" — emailed one-time code login
 * - `github`: "GitHub" — GitHub OAuth
 * - `gitlab`: "GitLab" — GitLab OAuth
 * - `google`: "Google" — Google OAuth
 * - `gitea`: "Gitea" — Gitea OAuth
 */
export const CORE_LOGIN_MEDIUM_LABELS: Record<TCoreLoginMediums, string> = {
  email: "Email",
  "magic-code": "Magic code",
  github: "GitHub",
  gitlab: "GitLab",
  google: "Google",
  gitea: "Gitea",
};
