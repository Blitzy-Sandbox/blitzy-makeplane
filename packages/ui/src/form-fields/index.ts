/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel entry for the `form-fields` sub-package of `@plane/ui`.
 *
 * Re-exports the form-control primitives consumed across `apps/web`, `apps/admin`, and
 * `apps/space`:
 *
 *   - `./input`              → `Input`, `InputProps` — tokenized text input
 *   - `./textarea`           → `TextArea`, `TextAreaProps` — auto-resizing textarea
 *   - `./input-color-picker` → `InputColorPicker`, `InputColorPickerProps` — text + popover color picker
 *   - `./checkbox`           → `Checkbox`, `CheckboxProps` — styled checkbox with indeterminate state
 *   - `./root`               → `Label`, `FormField`, `ValidationMessage` — form scaffolding primitives
 *   - `./password`           → `PasswordInput`, `PasswordStrengthIndicator`, helpers (cascaded barrel)
 *
 * Consumers should import from `@plane/ui` (the package-level barrel re-exports this folder)
 * rather than from internal file paths to keep the public surface stable.
 */

export * from "./input";
export * from "./textarea";
export * from "./input-color-picker";
export * from "./checkbox";
export * from "./root";
export * from "./password";
