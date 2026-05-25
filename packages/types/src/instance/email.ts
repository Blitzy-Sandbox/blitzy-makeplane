/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * SMTP transport configuration keys written by the admin UI and consumed by
 * `apps/api/plane/bgtasks/email_notification_task.py`; valid SMTP config
 * flips `IInstanceConfig.is_smtp_configured` and enables outbound email flows.
 */

/**
 * SMTP credential and policy storage keys; `EMAIL_USE_TLS` (STARTTLS) and
 * `EMAIL_USE_SSL` (implicit SSL/TLS, port 465 style) are mutually exclusive,
 * `EMAIL_HOST_PASSWORD` is encrypted at rest, and `ENABLE_SMTP="0"` skips
 * SMTP dispatch entirely (notifications fall back to in-app only).
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
