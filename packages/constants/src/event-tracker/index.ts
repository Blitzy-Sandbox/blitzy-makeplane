/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Event tracker barrel — re-exports the analytics tracking identifier
 * constants (event names and UI element identifiers) defined in `./core`.
 *
 * These identifiers form the public analytics schema emitted by the web
 * frontend: `*_TRACKER_ELEMENTS` strings are attached to interactive React
 * elements as `data-ph-element` attributes for PostHog autocapture, and
 * `*_TRACKER_EVENTS` strings are used as event names passed to PostHog's
 * `capture()` API.
 *
 * Consumers: web components and route segments under
 * `apps/web/core/components/**` and `apps/web/app/**` import these
 * identifiers directly from `@plane/constants`. The backend Celery task
 * `apps/api/plane/bgtasks/event_tracking_task.py` relays a parallel set of
 * server-side events to the same PostHog project.
 */

export * from "./core";
