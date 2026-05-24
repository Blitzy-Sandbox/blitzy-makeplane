/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for project types — re-exports the project entity types from
 * `./projects.ts`, filter types from `./project_filters.ts`, and link types from
 * `./project_link.ts`.
 *
 * Provides a single canonical import path (`@plane/types/project` or `@plane/types`)
 * for all project-related contracts. This file defines no local symbols — see each
 * target file's own JSDoc for per-type semantics, consumers, and field-level notes.
 */

export * from "./project_filters";
export * from "./projects";
export * from "./project_link";
