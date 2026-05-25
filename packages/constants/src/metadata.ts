/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * SEO and branding metadata for the main `apps/web` Plane application.
 *
 * Consumers: HTML head meta tags and open-graph cards rendered in `apps/web/app/**`
 * layouts, share previews, and PWA manifests. These values are referenced by name
 * across both build-time SSR/SSG and runtime `<head>` injection paths, so any string
 * change here propagates to every social-media share preview and search-engine
 * indexer that crawls the public app shell.
 */
export const SITE_NAME = "Plane | Simple, extensible, open-source project management tool.";
export const SITE_TITLE = "Plane | Simple, extensible, open-source project management tool.";
export const SITE_DESCRIPTION =
  "Open-source project management tool to manage work items, cycles, and product roadmaps easily";
export const SITE_KEYWORDS =
  "software development, plan, ship, software, accelerate, code management, release management, project management, work items tracking, agile, scrum, kanban, collaboration";
export const SITE_URL = "https://app.plane.so/";
export const TWITTER_USER_NAME = "Plane | Simple, extensible, open-source project management tool.";

// Plane Sites Metadata
/**
 * SEO and branding metadata for `apps/space` (Plane Publish — the public-facing
 * project publishing surface that exposes Plane boards and roadmaps to anonymous
 * viewers via shareable links).
 *
 * Consumers: HTML head meta tags and open-graph cards rendered in `apps/space/app/**`.
 * The `SPACE_*` cluster is intentionally kept distinct from the main `SITE_*` cluster
 * because Plane Publish ships as a separate deployable with its own canonical URL
 * scheme, branding copy, and Twitter handle.
 */
export const SPACE_SITE_NAME = "Plane Publish | Make your Plane boards and roadmaps pubic with just one-click. ";
export const SPACE_SITE_TITLE = "Plane Publish | Make your Plane boards public with one-click";
export const SPACE_SITE_DESCRIPTION = "Plane Publish is a customer feedback management tool built on top of plane.so";
export const SPACE_SITE_KEYWORDS =
  "software development, customer feedback, software, accelerate, code management, release management, project management, work items tracking, agile, scrum, kanban, collaboration";
export const SPACE_SITE_URL = "https://app.plane.so/";
export const SPACE_TWITTER_USER_NAME = "planepowers";
