/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel entry for the `password/` sub-package of `@plane/ui/form-fields`.
 *
 * Re-exports the password-specific surface:
 *
 *   - `./indicator`      → `PasswordStrengthIndicator`, `PasswordStrengthIndicatorProps`
 *   - `./helper`         → `StrengthInfo`, `getStrengthInfo`, `getFragmentColor`
 *   - `./password-input` → `PasswordInput`
 *
 * Consumers should import from `@plane/ui` (the package barrel forwards `./form-fields` which
 * forwards this) rather than reaching into internal paths.
 */

export * from "./indicator";
export * from "./helper";
export * from "./password-input";
