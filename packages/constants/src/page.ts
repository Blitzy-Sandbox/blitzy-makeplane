/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Access-level enum for Plane pages — controls which workspace members can read/edit a page.
 *
 * The integer encoding mirrors the backend `Page.access` IntegerField choices in
 * `apps/api/plane/db/models/page.py`, so the numeric values are part of the cross-stack contract.
 *
 * Consumers: `apps/web/core/components/pages/**`, `apps/web/core/store/pages/**`,
 * `apps/api/plane/app/serializers/page.py`.
 *
 * Values:
 * - PUBLIC (0): page is visible to all workspace members with project access
 * - PRIVATE (1): page is visible only to the owner and explicit collaborators
 */
export enum EPageAccess {
  PUBLIC = 0,
  PRIVATE = 1,
}

/**
 * State shape for the "Create page" modal — drives the open/close gate and pre-selected access level.
 *
 * Consumers: `apps/web/core/components/pages/**` modal trigger components.
 */
export type TCreatePageModal = {
  isOpen: boolean;
  pageAccess?: EPageAccess;
};

/**
 * Default closed state for the "Create page" modal with `PUBLIC` pre-selected as the access level.
 *
 * Consumers: `apps/web/core/store/pages/**` to reset modal state after submit/cancel.
 */
export const DEFAULT_CREATE_PAGE_MODAL_DATA: TCreatePageModal = {
  isOpen: false,
  pageAccess: EPageAccess.PUBLIC,
};
