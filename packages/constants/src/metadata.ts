/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * SEO/branding metadata for the main `apps/web` Plane app — referenced across both build-time SSR/SSG and runtime `<head>` injection so any change propagates to every share preview and crawler.
 * Consumers: HTML head meta tags and open-graph cards in `apps/web/app/**`.
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
 * SEO/branding metadata for `apps/space` (Plane Publish) — kept distinct from the `SITE_*` cluster because Plane Publish ships as a separate deployable with its own URL scheme and copy.
 * Consumers: HTML head meta tags and open-graph cards in `apps/space/app/**`.
 */
export const SPACE_SITE_NAME = "Plane Publish | Make your Plane boards and roadmaps pubic with just one-click. ";
export const SPACE_SITE_TITLE = "Plane Publish | Make your Plane boards public with one-click";
export const SPACE_SITE_DESCRIPTION = "Plane Publish is a customer feedback management tool built on top of plane.so";
export const SPACE_SITE_KEYWORDS =
  "software development, customer feedback, software, accelerate, code management, release management, project management, work items tracking, agile, scrum, kanban, collaboration";
export const SPACE_SITE_URL = "https://app.plane.so/";
export const SPACE_TWITTER_USER_NAME = "planepowers";
