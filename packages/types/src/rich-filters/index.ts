/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for rich filter types — re-exports the adapter (`./adapter.ts`),
 * builder (`./builder.ts`), expression tree (`./expression.ts`), config (`./config/`),
 * field-types (`./field-types/`), operator-configs (`./operator-configs/`),
 * operators (`./operators/`), and derived types (`./derived/`).
 *
 * Single canonical import path for the `@plane/types` rich filter type system.
 * Consumers: `packages/shared-state/src/store/work-item-filters/`,
 *            `packages/utils/src/work-item-filters/`,
 *            `apps/web/core/components/rich-filters/`,
 *            `apps/web/core/components/work-item-filters/`.
 */

export * from "./adapter";
export * from "./builder";
export * from "./config";
export * from "./derived";
export * from "./expression";
export * from "./operator-configs";
export * from "./operators";
export * from "./field-types";
