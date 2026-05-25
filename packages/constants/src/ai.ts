/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * AI editor task identifiers for the in-editor AI assistant toolbar.
 *
 * Consumers: `packages/editor/src/**` (AI menu/extensions), `apps/web/core/components/**` AI prompt UIs.
 *
 * Values:
 * - ASK_ANYTHING: Free-form "ask anything" prompt task — opens the generic AI prompt entry point.
 */
export enum AI_EDITOR_TASKS {
  ASK_ANYTHING = "ASK_ANYTHING",
}
