/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Tailwind class-name merging utility re-export. Combines `clsx` (conditional
 * joining) and `tailwind-merge` (token deduplication) into a single helper.
 *
 * This module re-exports the canonical `cn` implementation from `@plane/utils`
 * so `@plane/ui` components and helpers can import it via a local namespace
 * (`@plane/ui` → `packages/ui/src/utils`) without reaching across package
 * boundaries directly.
 */

/**
 * The single class-name composition utility used across `@plane/ui`. Merges
 * conditional class strings via `clsx` and de-duplicates conflicting Tailwind
 * classes via `tailwind-merge` (e.g., `cn("p-2", "p-4")` resolves to `"p-4"`).
 *
 * Accepts any combination of strings, arrays, or conditional objects (the
 * `ClassValue` union from `clsx`) as variadic inputs and returns the merged
 * class string.
 *
 * WHY: enables ergonomic conditional styling while preserving Tailwind's
 * "later class wins" override semantics — without this de-duplication step,
 * composing variant-specific classes on top of base classes would emit both
 * conflicting tokens (`"p-2 p-4"`) and the cascade order would be unreliable.
 *
 * @see The canonical implementation in `packages/utils/src/common.ts`.
 */
export { cn } from "@plane/utils";
