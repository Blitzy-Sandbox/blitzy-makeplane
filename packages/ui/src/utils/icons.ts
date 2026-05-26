/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Random-icon helper driven by the central icon name registry
 * (`packages/ui/src/constants/icons.ts` → `LUCIDE_ICONS_LIST`).
 *
 * Centralizes the randomization so callers initializing new entities
 * (projects, modules, cycles) get visually distinct default icons without
 * re-rolling their own selection logic.
 */

import { LUCIDE_ICONS_LIST } from "..";

/**
 * Returns a uniformly-random Lucide icon name string from the central
 * `LUCIDE_ICONS_LIST` registry, suitable for use as a default icon when
 * initializing a new entity (project, module, cycle, etc.).
 *
 * @returns A Lucide icon name (e.g., `"Activity"`, `"Airplay"`,
 * `"AlertCircle"`) drawn from `LUCIDE_ICONS_LIST`. The pool is whatever the
 * registry currently exposes; consumers do not need to track the list.
 *
 * WHY: centralized randomization keeps default-icon distribution uniform
 * across consumers and means any change to `LUCIDE_ICONS_LIST` (additions,
 * removals, reorderings) is picked up automatically — callers never need to
 * maintain a parallel icon list.
 */
export const getRandomIconName = (): string =>
  LUCIDE_ICONS_LIST[Math.floor(Math.random() * LUCIDE_ICONS_LIST.length)].name;
