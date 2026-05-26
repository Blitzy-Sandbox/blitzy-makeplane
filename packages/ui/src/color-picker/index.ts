/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Re-exports the color-picker trigger component for use in form fields and
 * theme settings.
 *
 * Acts as the stable public entry point for the `color-picker` feature: the
 * folder-level import path remains constant while consumers stay decoupled
 * from the deeper `./color-picker` implementation file path.
 */

export * from "./color-picker";
