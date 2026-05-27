/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project domain composition root — the barrel file that aggregates the three
 * MobX stores comprising the project subsystem.
 *
 * Composed sub-stores (lines 27-29):
 *   - project: ProjectStore (from ./project.store.ts) — main project entity
 *     store: projectMap, CRUD, archive, favorites, analytics, computed
 *     selectors, overview UI section state.
 *   - projectFilter: ProjectFilterStore (from ./project_filter.store.ts) —
 *     workspace-scoped filter/search/display state consumed by ProjectStore's
 *     filteredProjectIds getter.
 *   - publish: ProjectPublishStore (from ./project-publish.store.ts) —
 *     deploy-board / publish lifecycle; receives the ProjectRootStore
 *     instance (not CoreRootStore) so it can mutate the sibling project
 *     store's projectMap.anchor on publish/unpublish.
 *
 * Exports:
 *   - IProjectRootStore (interface) — shape contract for consumers that
 *     depend on the project composition without needing the concrete class.
 *   - ProjectRootStore (class) — the composition root instantiated by
 *     CoreRootStore (apps/web/core/store/root.store.ts line 58-59).
 *
 * Construction order (in `constructor(_root)`, lines 26-30):
 *   1. project = new ProjectStore(_root) — wired against the global
 *      CoreRootStore so it can read workspaceRoot/router/favorite/user.
 *   2. projectFilter = new ProjectFilterStore(_root) — also wired against
 *      CoreRootStore for router.workspaceSlug reactions.
 *   3. publish = new ProjectPublishStore(this) — wired against the
 *      ProjectRootStore (sibling-aware) so it can write
 *      `this.projectRootStore.project.projectMap[id].anchor`.
 *
 * Consumers:
 *   - apps/web/core/store/root.store.ts line 58-59 imports
 *     IProjectRootStore + ProjectRootStore and exposes the instance as
 *     `coreRootStore.projectRoot`.
 *   - Components access this domain via the React store context
 *     (rootStore.projectRoot.project, .projectFilter, .publish).
 */

import type { CoreRootStore } from "../root.store";
import type { IProjectPublishStore } from "./project-publish.store";
import { ProjectPublishStore } from "./project-publish.store";
import type { IProjectStore } from "./project.store";
import { ProjectStore } from "./project.store";
import type { IProjectFilterStore } from "./project_filter.store";
import { ProjectFilterStore } from "./project_filter.store";

export interface IProjectRootStore {
  project: IProjectStore;
  projectFilter: IProjectFilterStore;
  publish: IProjectPublishStore;
}

export class ProjectRootStore {
  project: IProjectStore;
  projectFilter: IProjectFilterStore;
  publish: IProjectPublishStore;

  constructor(_root: CoreRootStore) {
    this.project = new ProjectStore(_root);
    this.projectFilter = new ProjectFilterStore(_root);
    this.publish = new ProjectPublishStore(this);
  }
}
