/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel export surface for the issue-activity action rendering layer.
 *
 * Re-exports every per-field activity-row renderer (`IssueDefaultActivity`,
 * `IssueNameActivity`, `IssueDescriptionActivity`, `IssueStateActivity`,
 * `IssueAssigneeActivity`, `IssuePriorityActivity`, `IssueEstimateActivity`,
 * `IssueParentActivity`, `IssueRelationActivity`, `IssueStartDateActivity`,
 * `IssueTargetDateActivity`, `IssueCycleActivity`, `IssueModuleActivity`,
 * `IssueLabelActivity`, `IssueLinkActivity`, `IssueAttachmentActivity`,
 * `IssueArchivedAtActivity`, `IssueInboxActivity`) plus the visual
 * `LabelActivityChip` helper and the shared row primitives from
 * `./helpers/` (`IssueActivityBlockComponent`, `IssueUser`, `IssueLink`).
 *
 * Importing from this barrel is the canonical way for upstream timeline
 * components (`apps/web/core/components/issues/issue-detail/issue-activity/`)
 * to dispatch on activity type and render the corresponding row, and lets
 * sibling action components avoid relative-file imports to each other
 * (which would otherwise create circular references).
 *
 * MobX stores read: none directly — each re-exported component reads its
 * own stores at render time.
 *
 * Side effects: none. Pure re-export module.
 */

export * from "./default";
export * from "./name";
export * from "./description";
export * from "./state";
export * from "./assignee";
export * from "./priority";
export * from "./estimate";
export * from "./parent";
export * from "./relation";
export * from "./start_date";
export * from "./target_date";
export * from "./cycle";
export * from "./module";
export * from "./label";
export * from "./link";
export * from "./attachment";
export * from "./archived-at";
export * from "./inbox";
export * from "./label-activity-chip";

// helpers
export * from "./helpers/activity-block";
export * from "./helpers/issue-user";
export * from "./helpers/issue-link";
