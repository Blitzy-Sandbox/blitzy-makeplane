/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public publish/deploy-board contracts for the `@plane/types` package.
 *
 * Models the anchored read-only project/page surface served by `apps/space`. Mirrors
 * `apps/api/plane/db/models/deploy_board.py::DeployBoard`. Consumed by the publish
 * settings dialog in `apps/web` and the public space rendering layer in `apps/space`.
 */

import type { IProject, IProjectLite } from "./project";
import type { IWorkspaceLite } from "./workspace";

/**
 * Discriminator for what kind of Plane entity is being published.
 *
 * Union values:
 * - `project`: publishes a full project (issues + layouts)
 * - `page`: publishes a single page (rich-text content)
 */
export type TPublishEntityType = "project" | "page";

/**
 * Layouts that may be exposed on a published project.
 *
 * Union values match the issue layout choices supported in `apps/web` for read-only
 * rendering in `apps/space`.
 */
export type TProjectPublishLayouts = "calendar" | "gantt" | "kanban" | "list" | "spreadsheet";

/**
 * Per-layout enablement flags for a published project.
 *
 * Each boolean toggles whether the corresponding layout is selectable on the public space.
 * Undefined fields fall back to the system default (typically `true` for list/kanban).
 */
export type TProjectPublishViewProps = {
  calendar?: boolean;
  gantt?: boolean;
  kanban?: boolean;
  list?: boolean;
  spreadsheet?: boolean;
};

/**
 * Compact project descriptor embedded inside publish responses.
 *
 * Intersects `IProjectLite` (identity fields) with the `cover_image`, `logo_props`, and
 * `description` slice of `IProject`. Used for rendering the public space header.
 */
export type TProjectDetails = IProjectLite & Pick<IProject, "cover_image" | "logo_props" | "description">;

/**
 * Shared publish/deploy-board settings (both projects and pages).
 *
 * Fields with non-obvious semantics:
 * - `anchor`: stable URL slug under which the published entity is served
 *   (undefined until published; absence signals "not yet published")
 * - `entity_identifier`: id of the underlying project/page
 * - `entity_name`: discriminator (`TPublishEntityType`) indicating which kind of entity
 * - `is_comments_enabled` / `is_reactions_enabled` / `is_votes_enabled`: toggles for
 *   public interaction surfaces (votes only apply to issues on published projects)
 * - `inbox`: opaque inbox configuration (typing kept loose for legacy compatibility)
 */
export type TPublishSettings = {
  /** Stable URL slug under which the published entity is served at `space.plane.so/<anchor>`; `undefined` signals "not yet published". */
  anchor: string | undefined;
  created_at: string | undefined;
  created_by: string | undefined;
  /** Identifier of the underlying project (when `entity_name === "project"`) or page (when `entity_name === "page"`). */
  entity_identifier: string | undefined;
  /** Discriminator selecting which Plane entity backs this deploy board. */
  entity_name: TPublishEntityType | undefined;
  id: string | undefined;
  /** Opaque inbox configuration kept loose for legacy compatibility; shape is not enforced by `@plane/types`. */
  inbox: unknown;
  /** Toggles whether public visitors may post comments on the published surface. */
  is_comments_enabled: boolean;
  /** Toggles whether public visitors may add reactions on the published surface. */
  is_reactions_enabled: boolean;
  /** Toggles whether public visitors may vote on issues; only applies to published projects. */
  is_votes_enabled: boolean;
  project: string | undefined;
  project_details: TProjectDetails | undefined;
  updated_at: string | undefined;
  updated_by: string | undefined;
  workspace: string | undefined;
  workspace_detail: IWorkspaceLite | undefined;
};

/**
 * Publish settings specialized for projects (extends `TPublishSettings`).
 *
 * Adds `view_props` carrying per-layout enablement; only meaningful when
 * `entity_name === "project"`.
 */
export type TProjectPublishSettings = TPublishSettings & {
  view_props: TProjectPublishViewProps | undefined;
};
