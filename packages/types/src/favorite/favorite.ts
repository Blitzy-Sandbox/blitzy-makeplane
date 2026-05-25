/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Favorite (bookmark) entity contracts mirroring `UserFavorite` in
 * `apps/api/plane/db/models/favorite.py`; consumed by `favorite.store.ts`
 * and the workspace sidebar favorites tree.
 */

import type { TLogoProps } from "../common";

/**
 * Single favorite (bookmark) row — either a leaf bookmark of a Plane entity
 * or a folder grouping child favorites (`is_folder === true`), forming a
 * recursive tree via `children`/`parent`; `entity_type` is convention-driven
 * (`"project"|"cycle"|"module"|"view"|"page"|"folder"`) because the backend
 * column is a free-form `CharField`.
 */
export type IFavorite = {
  id: string;
  name: string;
  entity_type: string;
  entity_data: {
    id?: string;
    name: string;
    logo_props?: TLogoProps | undefined;
  };
  is_folder: boolean;
  sort_order: number;
  parent: string | null;
  entity_identifier?: string | null;
  children: IFavorite[];
  project_id: string | null;
  sequence: number;
  workspace_id: string;
};
