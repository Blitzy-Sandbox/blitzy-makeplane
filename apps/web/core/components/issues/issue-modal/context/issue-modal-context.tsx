/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Typed React Context contract for the issue modal subsystem.
 *
 * Defines the shared state model and operational handler signatures consumed
 * by every descendant of `apps/web/core/components/issues/issue-modal/`,
 * including `base.tsx`, `form.tsx`, `draft-issue-layout.tsx`, `modal.tsx`,
 * and `components/project-select.tsx` (all via the `useIssueModal()` hook
 * declared in `apps/web/core/hooks/context/use-issue-modal.tsx`).
 *
 * The context value is produced by `IssueModalProvider` in
 * `apps/web/ce/components/issues/issue-modal/provider.tsx` (aliased as
 * `@/plane-web/components/issues/issue-modal/provider`). Per the
 * monorepo's architectural rule of "MobX exclusively" for global state,
 * this React Context is intentionally scoped to a single modal mount — it
 * carries form-coupled, ephemeral state (template application progress,
 * editor ref, selected parent, per-modal validation errors) that does not
 * belong in a long-lived MobX store. Cross-component reactive state (issue
 * details, projects, templates) still flows through MobX stores; this
 * context only bridges modal-local concerns.
 *
 * The undefined default in `createContext<TIssueModalContext | undefined>(undefined)`
 * is deliberate: consumers can detect missing-provider misuse at runtime by
 * checking for `undefined` rather than receiving a deceptive empty object.
 */

import { createContext } from "react";
// ce imports
import type { UseFormReset, UseFormWatch } from "react-hook-form";
// plane imports
import type { EditorRefApi } from "@plane/editor";
import type { ISearchIssueResponse, TIssue } from "@plane/types";
// plane web imports
import type { TIssuePropertyValues, TIssuePropertyValueErrors } from "@/plane-web/types/issue-types";
import type { TIssueFields } from "@/plane-web/components/issues/issue-modal";

/**
 * Inputs required to validate the property values of a draft issue against
 * the active issue-type schema for the target project.
 *
 * Consumed by `TIssueModalContext.handlePropertyValuesValidation`.
 *
 * @property projectId - Target project id; `null` when the user has not yet
 *   selected a project (validation is short-circuited in that state).
 * @property workspaceSlug - Workspace slug owning `projectId`; used to scope
 *   property-schema reads.
 * @property watch - React Hook Form `watch` bound to the modal's
 *   `TIssueFields` form; supplies the current field values so validation
 *   reflects pending edits without requiring a submit.
 */
export type TPropertyValuesValidationProps = {
  projectId: string | null;
  workspaceSlug: string;
  watch: UseFormWatch<TIssueFields>;
};

/**
 * Inputs used to count how many additional (issue-type-driven) properties
 * are currently active for the selected project.
 *
 * Consumed by `TIssueModalContext.getActiveAdditionalPropertiesLength`,
 * which the modal uses to badge / preview the additional-properties section.
 *
 * @property projectId - Target project id; `null` defers the count until a
 *   project is chosen.
 * @property workspaceSlug - Workspace slug owning `projectId`.
 * @property watch - React Hook Form `watch` over `TIssueFields`; supplies
 *   the current issue-type id so the active-properties count tracks the
 *   in-progress form selection.
 */
export type TActiveAdditionalPropertiesProps = {
  projectId: string | null;
  workspaceSlug: string;
  watch: UseFormWatch<TIssueFields>;
};

/**
 * Payload for persisting issue-type property values after the modal saves
 * an issue (create or update flow).
 *
 * Consumed by `TIssueModalContext.handleCreateUpdatePropertyValues`. The
 * handler is invoked AFTER the parent `TIssue` record has been written so
 * that `issueId` refers to a persisted entity.
 *
 * @property issueId - Persisted issue id whose property values are being
 *   written.
 * @property projectId - Project owning the issue.
 * @property workspaceSlug - Workspace slug owning `projectId`.
 * @property issueTypeId - Active issue type id; `null` / `undefined` when
 *   the project has no issue-type plugin enabled, in which case the
 *   handler is a no-op.
 * @property isDraft - When `true`, persists against the draft-issue
 *   endpoint instead of the live issue endpoint. Defaults to `false`.
 */
export type TCreateUpdatePropertyValuesProps = {
  issueId: string;
  projectId: string;
  workspaceSlug: string;
  issueTypeId: string | null | undefined;
  isDraft?: boolean;
};

/**
 * Identifiers required to create a sub-work-item under an existing parent
 * issue from inside the modal.
 *
 * Consumed by `TIssueModalContext.handleCreateSubWorkItem`. The parent
 * relationship is established server-side via the `parentId` reference.
 *
 * @property workspaceSlug - Workspace slug owning `projectId`.
 * @property projectId - Project hosting both the parent and the new
 *   sub-work-item.
 * @property parentId - Persisted issue id that will be set as the parent
 *   of the sub-work-item.
 */
export type TCreateSubWorkItemProps = {
  workspaceSlug: string;
  projectId: string;
  parentId: string;
};

/**
 * Inputs used to apply (or clear) a work-item template inside the modal.
 *
 * Consumed by `TIssueModalContext.handleTemplateChange`. Applying a
 * template overwrites the modal's draft state, which is why both a React
 * Hook Form `reset` and an editor ref are required: the form-level fields
 * are reset via `reset`, while the rich-text description is rewritten
 * imperatively through the TipTap editor ref so the editor remains in
 * sync without remount.
 *
 * @property workspaceSlug - Workspace slug used to scope template reads.
 * @property reset - React Hook Form `reset` bound to the modal's `TIssue`
 *   form; replaces the entire form state in one call.
 * @property editorRef - Imperative handle to the `@plane/editor`
 *   instance; `null` while the editor is unmounted. The handler must
 *   guard against the null state before invoking editor commands.
 */
export type THandleTemplateChangeProps = {
  workspaceSlug: string;
  reset: UseFormReset<TIssue>;
  editorRef: React.MutableRefObject<EditorRefApi | null>;
};

/**
 * Inputs used to prefetch project-scoped entities (members, states,
 * labels, modules, cycles, issue-type schema) that the modal needs to
 * render its dropdowns and validation surface.
 *
 * Consumed by `TIssueModalContext.handleProjectEntitiesFetch`. Called
 * whenever the active project changes inside the modal so the dropdowns
 * track the user's project selection without a full remount.
 *
 * @property workItemProjectId - Project id whose entities to fetch;
 *   `null` / `undefined` short-circuits the fetch when no project is
 *   selected yet.
 * @property workItemTypeId - Active issue-type id used to scope
 *   issue-type property fetches; `undefined` when the project has no
 *   issue-type plugin enabled.
 * @property workspaceSlug - Workspace slug owning `workItemProjectId`.
 */
export type THandleProjectEntitiesFetchProps = {
  workItemProjectId: string | null | undefined;
  workItemTypeId: string | undefined;
  workspaceSlug: string;
};

/**
 * Inputs used to resolve the selected parent work-item's display data
 * (title, identifier, icon) when the modal opens with a parent
 * pre-selected (e.g. when launching from "Create sub-work-item").
 *
 * Consumed indirectly through the modal's parent-issue resolution logic
 * to hydrate `TIssueModalContext.selectedParentIssue` from a raw id.
 *
 * @property workspaceSlug - Workspace slug owning `parentProjectId`.
 * @property parentId - Parent issue id to resolve; `undefined` when no
 *   parent is pre-selected.
 * @property parentProjectId - Project id owning the parent. May differ
 *   from the new work-item's project; the resolver uses this to scope
 *   the lookup correctly.
 * @property isParentEpic - When `true`, resolves via the epic detail
 *   endpoint instead of the regular issue endpoint; epics have a
 *   separate read path in `apps/api`.
 */
export type THandleParentWorkItemDetailsProps = {
  workspaceSlug: string;
  parentId: string | undefined;
  parentProjectId: string | undefined;
  isParentEpic: boolean;
};

/**
 * Composite context value exposed by `IssueModalProvider` and consumed
 * via the `useIssueModal()` hook.
 *
 * The shape is intentionally a flat record (no nested namespaces) so
 * destructuring at consumer sites stays terse. Slices:
 *
 * - **Project + template state**: `allowedProjectIds`,
 *   `workItemTemplateId` (+ setter), `isApplyingTemplate` (+ setter) —
 *   tracks which projects the user may create into and whether a
 *   template application is currently in flight.
 * - **Parent issue**: `selectedParentIssue` (+ setter) — populated when
 *   the modal targets a sub-work-item; drives the "parent: …" indicator
 *   in the form header.
 * - **Property values**: `issuePropertyValues` (+ setter),
 *   `issuePropertyValueErrors` (+ setter) — issue-type-driven additional
 *   properties; both maps are keyed by property id and live alongside
 *   the React Hook Form state.
 * - **Derivations**: `getIssueTypeIdOnProjectChange` resolves the
 *   default issue-type for a project; `getActiveAdditionalPropertiesLength`
 *   returns the count of properties active for the current selection.
 * - **Handlers** (all async unless noted):
 *   `handlePropertyValuesValidation` (sync — returns `true` when the
 *   active property values pass schema validation),
 *   `handleCreateUpdatePropertyValues` (persists property values),
 *   `handleProjectEntitiesFetch` (prefetches project-scoped lookups on
 *   project switch), `handleTemplateChange` (applies a template into
 *   the form + editor), `handleConvert` (converts a draft into a real
 *   issue), `handleCreateSubWorkItem` (creates a child under a parent).
 *
 * The `Promise<void>` return on persistence handlers is intentional:
 * callers await for sequencing but do not consume the persisted entity
 * directly — downstream state is refreshed via the MobX stores that the
 * handlers mutate as a side effect.
 */
export type TIssueModalContext = {
  allowedProjectIds: string[];
  workItemTemplateId: string | null;
  setWorkItemTemplateId: React.Dispatch<React.SetStateAction<string | null>>;
  isApplyingTemplate: boolean;
  setIsApplyingTemplate: React.Dispatch<React.SetStateAction<boolean>>;
  selectedParentIssue: ISearchIssueResponse | null;
  setSelectedParentIssue: React.Dispatch<React.SetStateAction<ISearchIssueResponse | null>>;
  issuePropertyValues: TIssuePropertyValues;
  setIssuePropertyValues: React.Dispatch<React.SetStateAction<TIssuePropertyValues>>;
  issuePropertyValueErrors: TIssuePropertyValueErrors;
  setIssuePropertyValueErrors: React.Dispatch<React.SetStateAction<TIssuePropertyValueErrors>>;
  getIssueTypeIdOnProjectChange: (projectId: string) => string | null;
  getActiveAdditionalPropertiesLength: (props: TActiveAdditionalPropertiesProps) => number;
  handlePropertyValuesValidation: (props: TPropertyValuesValidationProps) => boolean;
  handleCreateUpdatePropertyValues: (props: TCreateUpdatePropertyValuesProps) => Promise<void>;
  handleProjectEntitiesFetch: (props: THandleProjectEntitiesFetchProps) => Promise<void>;
  handleTemplateChange: (props: THandleTemplateChangeProps) => Promise<void>;
  handleConvert: (workspaceSlug: string, data: Partial<TIssue>) => Promise<void>;
  handleCreateSubWorkItem: (props: TCreateSubWorkItemProps) => Promise<void>;
};

/**
 * React Context instance for the issue modal subsystem.
 *
 * The default value `undefined` is intentional — consumers can detect
 * a missing `IssueModalProvider` at runtime (the `useIssueModal()` hook
 * narrows the type and throws / returns a typed fallback when the
 * context is unprovided). See `apps/web/ce/components/issues/issue-modal/provider.tsx`
 * for the canonical provider wiring.
 */
export const IssueModalContext = createContext<TIssueModalContext | undefined>(undefined);
