/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Application base URLs and external/marketing links for the Plane monorepo.
 *
 * **Build-time env contract**: Frontend env vars (`VITE_*`) are baked in at build time
 * by Vite; changing them requires a rebuild, not a redeploy. Backend Node services
 * (e.g., `apps/live`) read the same `process.env` keys at runtime, so the same
 * variable name serves both layers but is resolved at different lifecycle phases.
 *
 * Consumers: every API service in `apps/web/core/services/**`, app shell layouts
 * in `apps/web/app/**`, `apps/admin/app/**`, `apps/space/app/**`, and the live
 * collaboration server in `apps/live/src/**`.
 */

/**
 * Base URL of the Django API service (`apps/api`). Combined with `API_BASE_PATH` to
 * produce `API_URL`. Falls back to an empty string when `VITE_API_BASE_URL` is unset
 * — useful for same-origin deployments where the API is served from the same domain.
 *
 * Build-time-baked: changing `VITE_API_BASE_URL` requires a frontend rebuild.
 *
 * Consumers: `apps/web/core/services/**` axios instances and any frontend code
 * that constructs API URLs.
 */
export const API_BASE_URL = process.env.VITE_API_BASE_URL || "";
/**
 * URL path prefix mounted in front of the Django API (e.g., `/api/`). Combined with
 * `API_BASE_URL` to produce `API_URL`. Build-time-baked via `VITE_API_BASE_PATH`.
 */
export const API_BASE_PATH = process.env.VITE_API_BASE_PATH || "";
/**
 * Fully-qualified, URL-encoded API endpoint (`${API_BASE_URL}${API_BASE_PATH}`).
 * The canonical base URL used by every API service module in the frontend.
 */
export const API_URL = encodeURI(`${API_BASE_URL}${API_BASE_PATH}`);
// God Mode Admin App Base Url
/**
 * Base URL of the "God Mode" admin shell (`apps/admin`). Combined with
 * `ADMIN_BASE_PATH` to produce `GOD_MODE_URL`. Build-time-baked via
 * `VITE_ADMIN_BASE_URL`; an empty default supports same-origin deployments.
 *
 * Consumers: instance-admin links in workspace settings and the upgrade flow.
 */
export const ADMIN_BASE_URL = process.env.VITE_ADMIN_BASE_URL || "";
/**
 * URL path prefix mounted in front of the admin shell (e.g., `/god-mode/`).
 * Build-time-baked via `VITE_ADMIN_BASE_PATH`.
 */
export const ADMIN_BASE_PATH = process.env.VITE_ADMIN_BASE_PATH || "";
/**
 * Fully-qualified, URL-encoded admin shell endpoint
 * (`${ADMIN_BASE_URL}${ADMIN_BASE_PATH}`). Used to redirect privileged users into
 * the `apps/admin` "God Mode" interface.
 */
export const GOD_MODE_URL = encodeURI(`${ADMIN_BASE_URL}${ADMIN_BASE_PATH}`);
// Publish App Base Url
/**
 * Base URL of the public-facing Plane Publish site (`apps/space`). Combined with
 * `SPACE_BASE_PATH` to produce `SITES_URL`. Build-time-baked via
 * `VITE_SPACE_BASE_URL`; an empty default supports same-origin deployments.
 *
 * Consumers: project/page publish flows that generate shareable public links.
 */
export const SPACE_BASE_URL = process.env.VITE_SPACE_BASE_URL || "";
/**
 * URL path prefix mounted in front of the Plane Publish site (e.g., `/spaces/`).
 * Build-time-baked via `VITE_SPACE_BASE_PATH`.
 */
export const SPACE_BASE_PATH = process.env.VITE_SPACE_BASE_PATH || "";
/**
 * Fully-qualified, URL-encoded Plane Publish endpoint
 * (`${SPACE_BASE_URL}${SPACE_BASE_PATH}`). The canonical base URL for published
 * (public) pages and views.
 */
export const SITES_URL = encodeURI(`${SPACE_BASE_URL}${SPACE_BASE_PATH}`);
// Live App Base Url
/**
 * Base URL of the Hocuspocus real-time collaboration server (`apps/live`).
 * Combined with `LIVE_BASE_PATH` to produce `LIVE_URL`. Build-time-baked via
 * `VITE_LIVE_BASE_URL` for browser bundles; the same variable is read at runtime
 * by Node services that need to reach the live server.
 *
 * Consumers: collaborative document editors in `@plane/editor` that open
 * WebSocket connections to the live server.
 */
export const LIVE_BASE_URL = process.env.VITE_LIVE_BASE_URL || "";
/**
 * URL path prefix mounted in front of the live collaboration server
 * (e.g., `/live/`). Build-time-baked via `VITE_LIVE_BASE_PATH`.
 */
export const LIVE_BASE_PATH = process.env.VITE_LIVE_BASE_PATH || "";
/**
 * Fully-qualified, URL-encoded live collaboration endpoint
 * (`${LIVE_BASE_URL}${LIVE_BASE_PATH}`). The WebSocket-upgradable base URL used by
 * Y.js/Hocuspocus clients.
 */
export const LIVE_URL = encodeURI(`${LIVE_BASE_URL}${LIVE_BASE_PATH}`);
// Web App Base Url
/**
 * Base URL of the main Plane client app (`apps/web`). Combined with
 * `WEB_BASE_PATH` to produce `WEB_URL`. Build-time-baked via `VITE_WEB_BASE_URL`;
 * an empty default supports same-origin deployments where the web app is the
 * primary host.
 *
 * Consumers: cross-app navigation (e.g., from `apps/admin` or `apps/space` back
 * into the main app) and absolute-link generation in emails and webhooks.
 */
export const WEB_BASE_URL = process.env.VITE_WEB_BASE_URL || "";
/**
 * URL path prefix mounted in front of the main web app (e.g., `/`).
 * Build-time-baked via `VITE_WEB_BASE_PATH`.
 */
export const WEB_BASE_PATH = process.env.VITE_WEB_BASE_PATH || "";
/**
 * Fully-qualified, URL-encoded main web app endpoint
 * (`${WEB_BASE_URL}${WEB_BASE_PATH}`). The canonical base URL of the primary
 * client experience.
 */
export const WEB_URL = encodeURI(`${WEB_BASE_URL}${WEB_BASE_PATH}`);
// plane website url
/**
 * Marketing website root for the Plane product. Defaults to `https://plane.so` and
 * is overridable via `VITE_WEBSITE_URL` for white-labeled/self-hosted deployments.
 * Build-time-baked.
 */
export const WEBSITE_URL = process.env.VITE_WEBSITE_URL || "https://plane.so";
// support email
/**
 * Support contact email. Defaults to `support@plane.so` and is overridable via
 * `VITE_SUPPORT_EMAIL` for self-hosted deployments with their own support inbox.
 * Build-time-baked.
 */
export const SUPPORT_EMAIL = process.env.VITE_SUPPORT_EMAIL || "support@plane.so";
// marketing links
/**
 * External marketing links (static, NOT env-driven) used by upgrade/billing CTAs.
 *
 * Consumers: workspace settings billing pages, upgrade modals, and the empty-state
 * "Talk to sales" CTAs.
 */
export const MARKETING_PRICING_PAGE_LINK = "https://plane.so/pricing";
export const MARKETING_CONTACT_US_PAGE_LINK = "https://plane.so/contact";
export const MARKETING_PLANE_ONE_PAGE_LINK = "https://plane.so/one";
