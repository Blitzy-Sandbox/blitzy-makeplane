/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * API token contracts for the `@plane/types` package.
 *
 * Models personal/workspace API token records issued for programmatic access to the
 * Plane HTTP API. Mirrors `apps/api/plane/db/models/api.py::APIToken` and is consumed
 * by workspace API-token settings screens in `apps/web`.
 */

/**
 * Single API token record.
 *
 * Consumers:
 * - `apps/web/core/store/workspace/api-token.store.ts` (workspace API tokens)
 * - workspace settings → API tokens panel
 *
 * Fields with non-obvious semantics:
 * - `token`: optional because it is only returned at creation time; subsequent reads
 *   omit it for security (the raw token is never persisted in clear text).
 * - `expired_at`: null when the token never expires (server enforces lifetime).
 * - `last_used`: null until the token has been used in at least one request.
 * - `user_type`: numeric discriminant identifying the owning principal type
 *   (e.g. workspace bot vs. personal token) — exact codes defined server-side.
 */
export interface IApiToken {
  created_at: string;
  created_by: string;
  description: string;
  /** Token expiration timestamp; null when the token never expires. */
  expired_at: string | null;
  id: string;
  is_active: boolean;
  label: string;
  /** Timestamp of the most recent request authenticated with this token; null until first use. */
  last_used: string | null;
  updated_at: string;
  updated_by: string;
  user: string;
  /** Numeric discriminant identifying the owning principal type (e.g. workspace bot vs. personal token); exact codes defined server-side. */
  user_type: number;
  /** Raw token string returned only at creation time; absent on subsequent reads for security. */
  token?: string;
  workspace: string;
}
