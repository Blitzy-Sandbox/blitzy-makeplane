/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * App base URLs and marketing links — frontend `VITE_*` env vars are baked at
 * build time (rebuild required), while Node services read the same `process.env`
 * keys at runtime.
 * Consumers: `apps/web/core/services/**`, `apps/{web,admin,space}/app/**`, `apps/live/src/**`.
 */

/**
 * Django API service base URL — composed with `API_BASE_PATH` into `API_URL`;
 * empty default supports same-origin deployments. Build-time-baked (`VITE_*`).
 * Consumer: `apps/web/core/services/**`.
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
 * "God Mode" admin shell (`apps/admin`) base URL — composed with `ADMIN_BASE_PATH`
 * into `GOD_MODE_URL`; build-time-baked.
 * Consumer: instance-admin links in workspace settings and the upgrade flow.
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
 * Plane Publish site (`apps/space`) base URL — composed with `SPACE_BASE_PATH` into
 * `SITES_URL`; build-time-baked.
 * Consumer: project/page publish flows.
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
 * Hocuspocus collaboration server (`apps/live`) base URL — composed with
 * `LIVE_BASE_PATH` into `LIVE_URL`; build-time-baked for browser, runtime-read by Node.
 * Consumer: `@plane/editor` collaborative document WebSocket clients.
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
 * Main client (`apps/web`) base URL — composed with `WEB_BASE_PATH` into `WEB_URL`;
 * build-time-baked.
 * Consumers: cross-app navigation and absolute-link generation in emails/webhooks.
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
 * Plane marketing website root (default `https://plane.so`, build-time-baked).
 */
export const WEBSITE_URL = process.env.VITE_WEBSITE_URL || "https://plane.so";
// support email
/**
 * Support contact email (default `support@plane.so`, build-time-baked).
 */
export const SUPPORT_EMAIL = process.env.VITE_SUPPORT_EMAIL || "support@plane.so";
// marketing links
/**
 * Static (non-env) marketing links for upgrade/billing CTAs.
 * Consumers: workspace billing pages, upgrade modals, and "Talk to sales" CTAs.
 */
export const MARKETING_PRICING_PAGE_LINK = "https://plane.so/pricing";
export const MARKETING_CONTACT_US_PAGE_LINK = "https://plane.so/contact";
export const MARKETING_PLANE_ONE_PAGE_LINK = "https://plane.so/one";
