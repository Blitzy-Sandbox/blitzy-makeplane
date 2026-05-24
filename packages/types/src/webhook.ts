/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Webhook configuration contracts for the `@plane/types` package.
 *
 * Models webhook subscriptions configured per workspace in the settings UI.
 * Mirrors `apps/api/plane/db/models/webhook.py::Webhook`. Webhook delivery is
 * fan-out via `apps/api/plane/bgtasks/webhook_task.py` with HMAC-SHA256 signing
 * and exponential backoff (tech spec §4.5).
 */

/**
 * Single webhook subscription record for a workspace.
 *
 * Consumers:
 * - `apps/web/core/store/workspace/webhook.store.ts`
 * - workspace settings → webhooks panel
 *
 * Fields with non-obvious semantics:
 * - `cycle`, `issue`, `issue_comment`, `module`, `project`: boolean flags toggling
 *   delivery for the matching entity-event family (toggle ON = fan out events).
 * - `secret_key`: optional because it is only returned at creation/regeneration
 *   time for security — subsequent reads omit it.
 * - `is_active`: when false, the webhook is paused and not delivered to;
 *   the system also disables it on persistent delivery failures (tech spec §4.5).
 */
export interface IWebhook {
  created_at: string;
  /** Toggle delivery for cycle entity events; ON = fan out cycle events to this webhook. */
  cycle: boolean;
  id: string;
  /** When false the webhook is paused; also flipped to false by the backend after persistent delivery failures. */
  is_active: boolean;
  /** Toggle delivery for issue entity events; ON = fan out issue events to this webhook. */
  issue: boolean;
  /** Toggle delivery for issue comment entity events; ON = fan out issue comment events to this webhook. */
  issue_comment: boolean;
  /** Toggle delivery for module entity events; ON = fan out module events to this webhook. */
  module: boolean;
  /** Toggle delivery for project entity events; ON = fan out project events to this webhook. */
  project: boolean;
  /** Returned by the API only at creation or regeneration time; omitted on subsequent reads for security. */
  secret_key?: string;
  updated_at: string;
  url: string;
}

/**
 * Webhook event subscription mode used by the workspace settings UI.
 *
 * Values:
 * - `all`: subscribe to every event type (entity flags on `IWebhook` are ignored).
 * - `individual`: subscribe only to the entity types whose boolean flags on `IWebhook` are true.
 */
export type TWebhookEventTypes = "all" | "individual";
