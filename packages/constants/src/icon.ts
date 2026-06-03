/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Icon-size token scale used across the Plane UI to keep iconography consistent.
 *
 * Consumers: `packages/ui/src/**` icon-rendering components and any `apps/web` UI surface
 * that picks an icon size via the shared token instead of hard-coding pixel values.
 *
 * Values:
 * - XS: extra small
 * - SM: small
 * - MD: medium (default)
 * - LG: large
 * - XL: extra large
 */
export enum EIconSize {
  XS = "xs",
  SM = "sm",
  MD = "md",
  LG = "lg",
  XL = "xl",
}
