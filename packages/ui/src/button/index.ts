/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for the `button` feature area of `@plane/ui`.
 *
 * Re-exports the `Button` primitive (variant/size/loading/disabled with optional icon slots),
 * the `ToggleSwitch` primitive (Headless UI Switch-based boolean toggle), and the variant/size
 * helpers (`TButtonVariant`, `TButtonSizes`, `IButtonStyling`, `buttonStyling`,
 * `getButtonStyling`, `getIconStyling`) so callers import everything from
 * `@plane/ui/button` (or transitively from `@plane/ui`).
 */

export * from "./button";
export * from "./helper";
export * from "./toggle-switch";
