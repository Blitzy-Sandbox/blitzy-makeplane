/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Email/SMTP provider configuration contracts for the `@plane/types/instance`
 * subfolder. Models the SMTP host, port, credentials, TLS/SSL toggles, sender
 * identity, and the master SMTP enablement flag persisted on the instance
 * configuration table.
 *
 * Consumers: `apps/admin/` email settings screen (writes the values) and
 * `apps/api/plane/bgtasks/email_notification_task.py` (consumes them when
 * dispatching notification, password-reset, magic-link, and invitation emails).
 * Boot-time presence of a valid SMTP configuration flips
 * `IInstanceConfig.is_smtp_configured` to true.
 */

/**
 * Storage keys for SMTP transport credentials and policy persisted in the
 * instance configuration table.
 *
 * Field-level semantics:
 * - `EMAIL_HOST`: SMTP server hostname (e.g. `smtp.gmail.com`).
 * - `EMAIL_PORT`: SMTP server port; stored as a string and coerced server-side
 *   (`25` / `465` / `587` typical).
 * - `EMAIL_HOST_USER`: SMTP authentication username; often the same as the
 *   `EMAIL_FROM` address.
 * - `EMAIL_HOST_PASSWORD`: SMTP authentication password or app-password.
 *   Stored encrypted server-side; masked by the API when read back to the
 *   admin UI.
 * - `EMAIL_USE_TLS`: `"1"` / `"0"` flag — enable STARTTLS on the SMTP
 *   handshake. Mutually exclusive with `EMAIL_USE_SSL`.
 * - `EMAIL_USE_SSL`: `"1"` / `"0"` flag — connect over implicit SSL/TLS
 *   (port 465 style). Mutually exclusive with `EMAIL_USE_TLS`.
 * - `EMAIL_FROM`: envelope-from address used as the visible sender of all
 *   outbound email.
 * - `ENABLE_SMTP`: master switch — when `"0"` the API skips SMTP dispatch
 *   entirely and notifications fall back to in-app only.
 */
export type TInstanceEmailConfigurationKeys =
  | "EMAIL_HOST"
  | "EMAIL_PORT"
  | "EMAIL_HOST_USER"
  | "EMAIL_HOST_PASSWORD"
  | "EMAIL_USE_TLS"
  | "EMAIL_USE_SSL"
  | "EMAIL_FROM"
  | "ENABLE_SMTP";
