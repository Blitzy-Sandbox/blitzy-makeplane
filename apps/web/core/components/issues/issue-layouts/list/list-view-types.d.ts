/**
 * Quick-action surface contract for list-layout issue rows.
 *
 * Defines the props shape that scope-specific quick-action components implement (e.g.
 * `ProjectIssueQuickActions`, `ArchivedIssueQuickActions`, `CycleIssueQuickActions`,
 * `ModuleIssueQuickActions` in `../../quick-action-dropdowns/`), and the render-function signature
 * that the list shell uses to spawn one quick-action menu per issue row.
 *
 * Compile-time contract only — no runtime code. Stabilising this contract here lets the row component
 * (`block.tsx`) call the quick-actions component as a render-prop without coupling to any specific
 * scope-aware implementation.
 *
 * Consumers:
 *   - `block.tsx` calls `quickActions({ issue, parentRef, ... })`
 *   - `base-list-root.tsx` constructs the `renderQuickActions` callback that satisfies
 *     `TRenderQuickActions` by binding store actions to the `handle*` props of `IQuickActionProps`
 *   - `../../quick-action-dropdowns/*.tsx` implement components that accept `IQuickActionProps`
 */
import type { TPlacement } from "@plane/propel/utils/placement";
import type { TIssue } from "@plane/types";

/**
 * Props accepted by every list-layout quick-action component.
 *
 * - `parentRef`: anchor element for popper positioning (the row's container ref)
 * - `issue`: the row's `TIssue` record (read-only data input)
 * - `handleDelete` (required): permanently deletes the issue via the appropriate store action
 * - `handleUpdate` (optional): inline-update callback for menu actions (e.g. "Make a copy" pre-fill);
 *   absent for scopes that don't support inline update (e.g. archived)
 * - `handleRemoveFromView` (optional): removes the issue from the current view/cycle/module without
 *   deleting the issue itself; absent for the project root scope
 * - `handleArchive` (optional): soft-archives the issue; absent for scopes where archive is not
 *   applicable (e.g. archived scope itself)
 * - `handleRestore` (optional): restores from archived state; only present for the archived scope
 * - `handleMoveToIssues` (optional): converts a workspace-draft issue to a real issue; only present
 *   for the workspace-draft scope
 * - `customActionButton` (optional): override the trigger element (default is the kebab icon)
 * - `portalElement` (optional): HTMLDivElement to portal the dropdown into; defaults to body
 * - `readOnly` (optional): disables every action when the row is non-editable (e.g. completed cycle)
 * - `placements` (optional): popper placement override (`TPlacement` from `@plane/propel/utils/placement`)
 */
export interface IQuickActionProps {
  parentRef: React.RefObject<HTMLElement>;
  issue: TIssue;
  handleDelete: () => Promise<void>;
  handleUpdate?: (data: TIssue) => Promise<void>;
  handleRemoveFromView?: () => Promise<void>;
  handleArchive?: () => Promise<void>;
  handleRestore?: () => Promise<void>;
  handleMoveToIssues?: () => Promise<void>;
  customActionButton?: React.ReactElement;
  portalElement?: HTMLDivElement | null;
  readOnly?: boolean;
  placements?: TPlacement;
}

/**
 * Renderer signature for quick-actions invoked by `IssueBlock`.
 *
 * Takes a subset of `IQuickActionProps` (the parts the row knows) and returns a React node — usually
 * a `<QuickActions ... />` element with all `handle*` callbacks pre-bound to the issue's store
 * actions by the parent list shell.
 *
 * The function-type form (rather than a component type) is intentional: it lets callers pre-bind
 * the action handlers in a `useCallback` without producing a new React component on each call.
 */
export type TRenderQuickActions = ({
  issue,
  parentRef,
  customActionButton,
  placement,
  portalElement,
}: {
  issue: TIssue;
  parentRef: React.RefObject<HTMLElement>;
  customActionButton?: React.ReactElement;
  placement?: TPlacement;
  portalElement?: HTMLDivElement | null;
}) => React.ReactNode;
