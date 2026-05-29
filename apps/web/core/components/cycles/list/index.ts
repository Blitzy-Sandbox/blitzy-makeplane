/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel re-export for the cycles list feature. Stabilizes the public import path
 * for consumers that want the grouped cycles list (active + upcoming + completed
 * sections plus the peek-overview panel) via a single deep-import target rather
 * than the deeper implementation file.
 *
 * Re-exports:
 *   - CyclesList (default screen-level component, observer-wrapped)
 *   - ICyclesList (props interface)
 *
 * Consumers:
 *   - apps/web/core/components/cycles/cycles-view.tsx (main cycles screen)
 *   - apps/web/core/components/cycles/archived-cycles/view.tsx (archived cycles)
 */

export * from "./root";
