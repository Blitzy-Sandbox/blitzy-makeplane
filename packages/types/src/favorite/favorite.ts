/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Favorite (bookmark) entity contracts for the `@plane/types/favorite` subfolder.
 *
 * Models the polymorphic favorite record — workspace-scoped pins of projects,
 * cycles, modules, views, pages, and user-defined folders that group them.
 * Mirrors the Django `UserFavorite` model at `apps/api/plane/db/models/favorite.py`.
 *
 * Consumers:
 * - `apps/web/core/store/favorite.store.ts` (MobX domain store)
 * - `apps/web/core/components/workspace/sidebar/favorites/` (sidebar UI tree)
 * - `apps/web/core/services/favorite/favorite.service.ts` (REST client)
 * - `packages/services/src/user/favorite.service.ts`
 * - `apps/web/core/hooks/store/use-favorite.ts`, `use-favorite-item-details.tsx`
 * - `apps/web/core/constants/sidebar-favorites.ts`
 */

import type { TLogoProps } from "../common";

/**
 * Compile-time contract for a single favorite (bookmark) entry.
 *
 * A favorite can be either a leaf bookmark of a Plane entity (project / cycle /
 * module / view / page) or a user-defined folder that groups child favorites
 * (`is_folder === true`), forming a recursive tree via `children` + `parent`.
 *
 * Field semantics with non-obvious behavior:
 * - `entity_type`: string discriminator identifying which Plane entity is
 *   favorited. Observed callsite values (`apps/web/core/store/*.store.ts`):
 *     - `"project"` — favorites a project; `entity_identifier` is the project id
 *     - `"cycle"`   — favorites a cycle
 *     - `"module"`  — favorites a module
 *     - `"view"`    — favorites a project view
 *     - `"page"`    — favorites a workspace/project page
 *     - `"folder"`  — user-defined grouping folder; `is_folder` is `true`
 *   The backend column is a free-form `CharField(max_length=100)`, so values
 *   are convention-driven by the frontend rather than enforced by a DB enum.
 * - `entity_data`: hydrated payload for the favorited entity. Polymorphic —
 *   `name` and optional `logo_props` are populated from the underlying entity
 *   (e.g., project name + emoji/icon) so the sidebar can render without a
 *   second fetch. `id` is the entity's own identifier (distinct from the
 *   favorite row's `id`).
 * - `entity_identifier`: UUID of the favorited entity, or `null` when this row
 *   is a folder. Pairs with `entity_type` to form the (entity_type, entity_identifier)
 *   uniqueness constraint enforced by the backend.
 * - `is_folder`: when `true`, this row is a container; `children` may be
 *   populated and `entity_identifier` is typically `null`.
 * - `parent`: id of the parent favorite folder, or `null` for top-level rows.
 * - `children`: nested favorites under this folder. Self-referential type
 *   permits arbitrarily deep nesting in the frontend tree.
 * - `sort_order` / `sequence`: ordering hints. `sequence` is the backend-managed
 *   monotonically-increasing float (default 65535, +10000 per insertion); the
 *   frontend may surface `sort_order` for drag-and-drop reordering.
 * - `project_id`: scoping project id, or `null` for workspace-level favorites
 *   (e.g., pages without a project context).
 * - `workspace_id`: workspace owning this favorite row.
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
