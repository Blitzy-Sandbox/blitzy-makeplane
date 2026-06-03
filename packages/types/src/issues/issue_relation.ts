/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue relation contracts mirroring `apps/api/plane/db/models/issue.py::IssueRelation`;
 * the serializer writes paired rows (one per anchor) so a relation is queryable
 * from either endpoint and the `blocking` ↔ `blocked_by` inverse is materialized
 * for both sides. Consumed by `apps/web/core/store/issue/issue-details/relation.store.ts`.
 */

import type { TIssue } from "./issue";

/**
 * Hydrated relations for one anchor issue, keyed by relation type with fully
 * populated `TIssue[]` so the relations panel can render without a secondary
 * lookup per related id.
 */
export type TIssueRelation = Record<TIssueRelationTypes, TIssue[]>;

/**
 * Normalized per-anchor map of related issue ids; stored alongside the flat
 * issue store so relation state references ids only, never duplicated payloads.
 */
export type TIssueRelationMap = {
  [issue_id: string]: Record<TIssueRelationTypes, string[]>;
};

/**
 * Per-type list of related issue ids for a single implicit anchor (e.g. the
 * open issue-detail page where the anchor is taken from the route).
 */
export type TIssueRelationIdMap = Record<TIssueRelationTypes, string[]>;

/**
 * Relation-type discriminant. `blocking` ↔ `blocked_by` are directional inverses
 * written as paired rows by the backend, `duplicate` encodes canonical-vs-duplicate
 * by which side carries the tag (the repository literal is `"duplicate"`, NOT
 * `"duplicate_of"`), and `relates_to` is the only symmetric value.
 */
export type TIssueRelationTypes = "blocking" | "blocked_by" | "duplicate" | "relates_to";
