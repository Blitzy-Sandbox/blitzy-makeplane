/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core login-medium label registry merged with `EXTENDED_LOGIN_MEDIUM_LABELS` by
 * `./index.ts` to produce `LOGIN_MEDIUM_LABELS`.
 */

import type { TCoreLoginMediums } from "@plane/types";

/**
 * Display labels for always-available auth mediums (email, magic-code, github,
 * gitlab, google, gitea); typed by `TCoreLoginMediums` for compile-time enforcement.
 * Consumed via `LOGIN_MEDIUM_LABELS` in `apps/web/ce/components/workspace/settings/useMemberColumns.tsx`.
 */
export const CORE_LOGIN_MEDIUM_LABELS: Record<TCoreLoginMediums, string> = {
  email: "Email",
  "magic-code": "Magic code",
  github: "GitHub",
  gitlab: "GitLab",
  google: "Google",
  gitea: "Gitea",
};
