/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * @plane/ui dropdown — public barrel for the single-select and multi-select dropdown variants
 * and their shared primitives.
 *
 * Re-exports:
 *   - `./common`  — shared trigger button, search input, options list, and loader primitives
 *                   used internally by both variants but also exposed publicly so consumers can
 *                   compose custom dropdown layouts.
 *   - `./multi-select` — `MultiSelectDropdown` (array-valued selection).
 *   - `./single-select` — `Dropdown` (single-value selection).
 *
 * The shared type contract for both variants lives in `./dropdown.d.ts` and is consumed by all
 * three re-exported modules; it is intentionally not re-exported from this barrel because the
 * `.d.ts` file is type-only and consumed via `import type` at the source files.
 */

export * from "./common";
export * from "./multi-select";
export * from "./single-select";
