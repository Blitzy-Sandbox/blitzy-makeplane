/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Event tracker barrel — re-exports analytics identifier constants from `./core`
 * where `*_TRACKER_ELEMENTS` are attached as `data-ph-element` attributes (verified
 * across `apps/web/core/components/**`) and `*_TRACKER_EVENTS` are string-name
 * registries whose values match backend constants in
 * `apps/api/plane/utils/analytics_events.py` (the backend Celery task
 * `apps/api/plane/bgtasks/event_tracking_task.py` emits to PostHog server-side).
 *
 * // INTENT UNCLEAR: no client-side import of `*_TRACKER_EVENTS` was found in
 * tracked source, so the front-end emission path (capture call site) cannot be
 * confirmed.
 */

export * from "./core";
