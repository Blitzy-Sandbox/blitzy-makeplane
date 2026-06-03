/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared dropdown primitives barrel for `@plane/ui/dropdown`.
 *
 * Re-exports:
 *   - `./input-search` — `InputSearch` (controlled search input rendered inside the panel).
 *   - `./button`       — `DropdownButton` (shared trigger button bridging combobox state).
 *   - `./options`      — `DropdownOptions` (options-list renderer with empty/loading states).
 *   - `./loader`       — `DropdownOptionsLoader` (six-row skeleton fallback).
 *
 * All four primitives are also re-exported from `../index.ts` so consumers can import them
 * directly from `@plane/ui` without depending on internal paths.
 */

export * from "./input-search";
export * from "./button";
export * from "./options";
export * from "./loader";
