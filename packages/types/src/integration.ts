/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Third-party integration contracts for the `@plane/types` package.
 *
 * Models the integration registry (`IAppIntegration`), per-workspace install records
 * (`IWorkspaceIntegration`), and the Slack-specific OAuth response detail. Consumed by
 * the workspace integrations panel in `apps/web` and the Slack notification adapter.
 */

// All the app integrations that are available
/**
 * Registry entry describing a globally-available third-party integration.
 *
 * Fields with non-obvious semantics:
 * - `network`: integer flag for visibility (mirrors `EProjectNetwork` semantics: 0 private, 2 public)
 * - `verified`: true when the integration has been published/approved by Plane
 * - `webhook_url`/`webhook_secret`: outbound URL Plane sends events to + HMAC signing secret
 */
export interface IAppIntegration {
  author: string;
  avatar_url: string | null;
  created_at: string;
  created_by: string | null;
  description: any;
  id: string;
  metadata: any;
  /** Integer visibility flag mirroring `EProjectNetwork`: 0 = private, 2 = public. */
  network: number;
  provider: string;
  redirect_url: string;
  title: string;
  updated_at: string;
  updated_by: string | null;
  verified: boolean;
  /** HMAC signing secret used to verify outbound webhook payloads delivered by Plane. */
  webhook_secret: string;
  /** Outbound URL Plane POSTs integration event payloads to. */
  webhook_url: string;
}

/**
 * Per-workspace installation record linking a workspace to an `IAppIntegration`.
 *
 * Fields:
 * - `integration`: id of the parent `IAppIntegration`
 * - `integration_detail`: hydrated parent integration (saved server-side join)
 * - `api_token`: workspace-scoped token used by the integration for callbacks
 * - `config`: integration-specific configuration blob (shape varies per provider)
 * - `metadata`: integration-specific metadata blob (shape varies per provider)
 */
export interface IWorkspaceIntegration {
  actor: string;
  api_token: string;
  /** Integration-specific configuration blob; shape varies per provider. */
  config: any;
  created_at: string;
  created_by: string;
  id: string;
  integration: string;
  /** Hydrated parent integration record (server-side join expansion of `integration`). */
  integration_detail: IAppIntegration;
  /** Integration-specific metadata blob; shape varies per provider. */
  metadata: any;
  updated_at: string;
  updated_by: string;
  workspace: string;
}

// slack integration
/**
 * Plane ↔ Slack workspace-scoped install record (Slack OAuth response persisted server-side).
 *
 * Holds the Slack access token, scopes, bot user id, and `IncomingWebhook` configuration
 * required for posting Plane notifications back to Slack channels.
 */
export interface ISlackIntegration {
  id: string;
  created_at: string;
  updated_at: string;
  access_token: string;
  scopes: string;
  bot_user_id: string;
  webhook_url: string;
  data: ISlackIntegrationData;
  team_id: string;
  team_name: string;
  created_by: string;
  updated_by: string;
  project: string;
  workspace: string;
  workspace_integration: string;
}

/**
 * Raw Slack OAuth v2 response data (subset Plane stores from `oauth.v2.access`).
 *
 * Fields:
 * - `ok`: Slack request success flag
 * - `incoming_webhook`: posted-to channel + configuration URL for channel-bound messages
 * - `is_enterprise_install`: true when installed on a Slack Enterprise Grid (different scope semantics)
 *
 * See Slack OAuth v2 documentation for field semantics.
 */
export interface ISlackIntegrationData {
  /** Slack request success flag from the OAuth v2 response. */
  ok: boolean;
  team: {
    id: string;
    name: string;
  };
  scope: string;
  app_id: string;
  enterprise: any;
  token_type: string;
  authed_user: string;
  bot_user_id: string;
  access_token: string;
  /** Posted-to channel + configuration URL used for channel-bound messages from Plane. */
  incoming_webhook: {
    url: string;
    channel: string;
    channel_id: string;
    configuration_url: string;
  };
  /** True when installed on a Slack Enterprise Grid (different scope/permission semantics). */
  is_enterprise_install: boolean;
}
