/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue relation contracts for the `@plane/types/issues` subfolder.
 *
 * Models typed relationships between two issues using a four-value discriminant
 * (`blocking`, `blocked_by`, `duplicate`, `relates_to`). These shapes mirror
 * `apps/api/plane/db/models/issue.py::IssueRelation` and the paired-row write
 * logic in `apps/api/plane/app/serializers/issue.py`: when a directional
 * relation is created the backend inserts TWO rows (one anchored on each side)
 * so the relation is queryable from either endpoint and the inverse pair
 * (`blocking` ↔ `blocked_by`) is consistently materialized for both anchors.
 *
 * Consumed by `apps/web/core/store/issue/issue-details/relation.store.ts`
 * (normalized id-keyed state slice) and rendered by
 * `apps/web/core/components/issues/relations/` plus
 * `apps/web/core/components/issues/issue-detail-widgets/relations/`
 * (the inline issue-detail relations panel). Re-exported via `./base.ts` (the
 * folder barrel), which is itself re-exported from the package root.
 */

import type { TIssue } from "./issue";

/**
 * Resolved relations for a single anchor issue — a record keyed by
 * {@link TIssueRelationTypes} whose values are the fully hydrated `TIssue[]`
 * records on the OTHER side of each relation. This hydrated shape exists so
 * the relation panel can render fully-populated cards (priority, state,
 * identifier, assignees) without performing a secondary lookup against the
 * flat issue store for each related id.
 */
export type TIssueRelation = Record<TIssueRelationTypes, TIssue[]>;

/**
 * Per-anchor map of relation ids: the outer key is the anchor `issue_id` and
 * the inner record is keyed by {@link TIssueRelationTypes} with arrays of
 * related issue ids as values. Stored alongside the flat issue store (which
 * owns the issue records themselves) to keep relation state normalized — the
 * map carries only id references, never duplicated `TIssue` payloads.
 */
export type TIssueRelationMap = {
  [issue_id: string]: Record<TIssueRelationTypes, string[]>;
};

/**
 * Ungrouped per-type list of related issue ids — the inner record shape from
 * {@link TIssueRelationMap} without the outer anchor key. Used when only one
 * anchor issue is in scope (e.g., the open issue-detail page's relation panel
 * state where the anchor is implicit from the route).
 */
export type TIssueRelationIdMap = Record<TIssueRelationTypes, string[]>;

/**
 * Discriminant string union for the relation type — controls how each
 * relation is labeled, grouped, and rendered in the relations panel. Each
 * value carries a non-trivial directional or symmetric semantic; consumers
 * must branch on the literal value when computing the inverse or rendering
 * directional language.
 *
 * - `"blocking"` — the anchor issue blocks the related issue: the anchor must
 *   complete before the related issue can start. Directional; the paired
 *   inverse row written by the backend carries `"blocked_by"` on the related
 *   issue's anchor projection.
 * - `"blocked_by"` — the anchor issue is blocked by the related issue: the
 *   related issue must complete before the anchor can start. Directional;
 *   the paired inverse row carries `"blocking"` on the related issue's
 *   anchor projection.
 * - `"duplicate"` — the anchor issue is a duplicate of the related issue. The
 *   canonical vs. duplicate distinction is encoded by which side carries
 *   this tag (not by a separate field). MAP-NOTE: the project documentation
 *   refers to this value as `"duplicate_of"`, but the repository literal IS
 *   `"duplicate"` — the literal is preserved here (no rename) and consumers
 *   must match against `"duplicate"`.
 * - `"relates_to"` — soft mutual relation with no directional semantic. This
 *   is the ONLY symmetric value: both anchor projections carry the same
 *   string, so no inverse mapping is required.
 */
export type TIssueRelationTypes = "blocking" | "blocked_by" | "duplicate" | "relates_to";
