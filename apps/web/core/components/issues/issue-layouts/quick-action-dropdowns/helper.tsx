/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared orchestration layer for issue quick-action dropdowns — defines the
 * {@link MenuItemFactoryProps} contract, common action handler hooks, reusable
 * menu item builders, and predefined menu item sets that the
 * project/cycle/module/global/archived/work-item-detail dropdowns compose to
 * render their context menus and ellipsis menus.
 *
 * Public API surface:
 *   - `handleOptionalAction` — overloaded utility that invokes a possibly-undefined
 *     handler and surfaces an error toast when the handler is missing.
 *   - `MenuItemFactoryProps` — interface describing the inputs a menu factory
 *     hook needs (issue, permissions, layout, modal setters, optional external
 *     handlers, context IDs).
 *   - `useIssueActionHandlers` — hook returning `workItemLink`,
 *     `handleCopyIssueLink`, `handleOpenInNewTab`, `handleIssueRestore`.
 *   - `useMenuItemFactory` — hook returning factory builders for every menu
 *     item (edit, copy, open in new tab, copy link, remove from cycle/module,
 *     archive, restore, delete) plus the action handlers.
 *   - `useProjectIssueMenuItems`, `useWorkItemDetailMenuItems`,
 *     `useAllIssueMenuItems`, `useCycleIssueMenuItems`,
 *     `useModuleIssueMenuItems`, `useArchivedIssueMenuItems` — predefined
 *     `TContextMenuItem[]` sets per layout context.
 *
 * MobX consumption pattern: this module is intentionally store-agnostic. The
 * hooks here are pure React hooks composed of `useMemo` and `useTranslation`
 * only — the MobX `observer` wrap lives in each consumer component file
 * (`all-issue.tsx`, `cycle-issue.tsx`, `module-issue.tsx`, etc.), which is
 * where store reactivity is established.
 *
 * Architectural notes:
 *   - Toast emissions go through `setToast` from `@plane/propel/toast`.
 *   - Clipboard writes go through `copyUrlToClipboard` from `@plane/utils`.
 *   - Work-item link generation goes through `generateWorkItemLink` from
 *     `@plane/utils`.
 *   - The "Make a copy" action branches through `createCopyMenuWithDuplication`
 *     from `@/plane-web/components/issues/issue-layouts/quick-action-dropdowns`
 *     (community edition stub) so EE editions can layer an optional
 *     duplicate-work-item submenu behind the "Make a copy" entry.
 *   - All API mutations are caller-provided handlers (`handleDelete`,
 *     `handleArchive`, `handleRestore`, `handleUpdate`, `handleRemoveFromView`);
 *     the helper itself never calls services directly, preserving the
 *     service-layer pattern.
 */

import { useMemo } from "react";
import { XCircle, ArchiveRestoreIcon } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { LinkIcon, CopyIcon, NewTabIcon, EditIcon, ArchiveIcon, TrashIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { EIssuesStoreType, TIssue } from "@plane/types";
import type { TContextMenuItem } from "@plane/ui";
import { copyUrlToClipboard, generateWorkItemLink } from "@plane/utils";
// types
import { createCopyMenuWithDuplication } from "@/plane-web/components/issues/issue-layouts/quick-action-dropdowns";

/**
 * Invokes a possibly-undefined handler and surfaces a localized error toast
 * (`"<actionName> action is not implemented."`) when the handler is missing,
 * so menu items conditional on caller-provided optional handlers (e.g.
 * `handleArchive`, `handleRestore`, `handleRemoveFromView`) don't need to
 * defensively guard against the undefined case at every call site.
 *
 * Two overload signatures (no-arg form and one-arg form) merge into a single
 * implementation — the overload signatures and the implementation must remain
 * syntactically contiguous, so subsequent overloads carry only `//`-style
 * comments rather than a second JSDoc block.
 *
 * @param optionalFn - Possibly-undefined zero- or one-arg function (sync or async).
 * @param actionName - Human-readable action label rendered in the error toast.
 * @param param - Optional single argument forwarded to `optionalFn` when provided.
 */
// Generic helper function to handle optional function calls gracefully
// Overload for functions without parameters
export function handleOptionalAction(
  optionalFn: (() => void) | (() => Promise<void>) | undefined,
  actionName: string
): void;

// Overload for functions with one parameter
export function handleOptionalAction<T>(
  optionalFn: ((param: T) => void) | ((param: T) => Promise<void>) | undefined,
  actionName: string,
  param: T
): void;

// Implementation
export function handleOptionalAction<T>(
  optionalFn: (() => void) | (() => Promise<void>) | ((param: T) => void) | ((param: T) => Promise<void>) | undefined,
  actionName: string,
  param?: T
): void {
  if (optionalFn) {
    if (param !== undefined) {
      (optionalFn as (param: T) => void | Promise<void>)(param);
    } else {
      (optionalFn as () => void | Promise<void>)();
    }
  } else {
    setToast({
      type: TOAST_TYPE.ERROR,
      title: "Action not available",
      message: `${actionName} action is not implemented.`,
    });
  }
}

/**
 * Input contract for the menu factory hooks in this module — every consumer
 * component (`project-issue.tsx`, `cycle-issue.tsx`, `module-issue.tsx`,
 * `all-issue.tsx`, `archived-issue.tsx`, `issue-detail.tsx`) constructs this
 * object from its MobX-injected stores and caller props and passes it to a
 * `useXxxMenuItems` hook to render its quick-action menu.
 *
 * Field semantics:
 *   - `issue` — the target work item the menu acts on.
 *   - `workspaceSlug`, `projectIdentifier` — needed for canonical work-item URL
 *     generation; optional because some callers (e.g. global views) may resolve
 *     them lazily.
 *   - `activeLayout` — display-filter layout label threaded into
 *     `createCopyMenuWithDuplication` so EE editions can branch
 *     layout-specific duplicate behavior off the same entry.
 *   - `isEditingAllowed`, `isArchivingAllowed`, `isDeletingAllowed`,
 *     `isRestoringAllowed` — permission gates derived from
 *     `useUserPermissions` in caller components; control the `shouldRender`
 *     flag on the corresponding menu items.
 *   - `isInArchivableGroup` — true only when the issue's state group is in
 *     `ARCHIVABLE_STATE_GROUPS` (only such issues can be archived); disables
 *     the archive entry with an explanatory description when false.
 *   - `issueTypeDetail.is_active` — gates "Make a copy" off for inactive issue
 *     types so users cannot spawn copies of disabled types.
 *   - `setIssueToEdit`, `setCreateUpdateIssueModal`, `setDeleteIssueModal`,
 *     `setArchiveIssueModal`, `setDuplicateWorkItemModal` — caller-owned local
 *     state setters that open the corresponding modals; the duplicate modal
 *     setter is optional because community editions may not surface a
 *     duplicate-with-options flow.
 *   - `handleRemoveFromView` — caller-provided remove-from-cycle/module
 *     handler; resolves to a no-op plus error toast via {@link handleOptionalAction}
 *     when undefined.
 *   - `handleRestore`, `handleDelete`, `handleUpdate`, `handleArchive` —
 *     caller-owned mutation entrypoints (typically thin wrappers over the
 *     issue store actions); all optional so callers can omit unsupported
 *     actions in their layout.
 *   - `cycleId`, `moduleId` — context IDs threaded into custom edit actions to
 *     preserve cycle/module association on edit (`cycle_id` / `module_ids`
 *     preset on the edit payload).
 *   - `storeType` — `EIssuesStoreType` discriminator (GLOBAL/PROJECT/CYCLE/
 *     MODULE/etc.) used by downstream factory branches to disambiguate the
 *     calling layout.
 */
export interface MenuItemFactoryProps {
  issue: TIssue;
  workspaceSlug?: string;
  projectIdentifier?: string;
  activeLayout?: string;
  isEditingAllowed: boolean;
  isArchivingAllowed?: boolean;
  isDeletingAllowed: boolean;
  isRestoringAllowed?: boolean;
  isInArchivableGroup?: boolean;
  issueTypeDetail?: { is_active?: boolean };
  // Action handlers
  setIssueToEdit: (issue: TIssue | undefined) => void;
  setCreateUpdateIssueModal: (open: boolean) => void;
  setDeleteIssueModal: (open: boolean) => void;
  setArchiveIssueModal?: (open: boolean) => void;
  setDuplicateWorkItemModal?: (open: boolean) => void;
  handleRemoveFromView?: () => void;
  handleRestore?: () => Promise<void>;
  // External handlers
  handleDelete?: () => Promise<void>;
  handleUpdate?: (data: TIssue) => Promise<void>;
  handleArchive?: () => Promise<void>;
  // Context-specific data
  cycleId?: string;
  moduleId?: string;
  storeType?: EIssuesStoreType;
}

/**
 * Derives the canonical work-item URL via `generateWorkItemLink` and exposes
 * the copy-link / open-in-new-tab / restore handlers shared by every menu
 * factory in this module.
 *
 * Side effects per returned handler:
 *   - `handleCopyIssueLink` writes the URL to the clipboard via
 *     `copyUrlToClipboard` and emits a success toast.
 *   - `handleOpenInNewTab` opens `workItemLink` in a new browser tab via
 *     `window.open(workItemLink, "_blank")`.
 *   - `handleIssueRestore` awaits the caller-provided `props.handleRestore`
 *     and emits a success or error toast based on the outcome; when
 *     `props.handleRestore` is undefined, delegates to {@link handleOptionalAction}
 *     to emit the standardized missing-handler error toast.
 *
 * @param props - {@link MenuItemFactoryProps}. Only `issue`, `workspaceSlug`,
 *   `projectIdentifier`, and `handleRestore` are read directly; the remaining
 *   fields are passed through by callers and consumed elsewhere.
 * @returns `{ workItemLink, handleCopyIssueLink, handleOpenInNewTab, handleIssueRestore }`.
 */
// Common action handlers hook
export const useIssueActionHandlers = (props: MenuItemFactoryProps) => {
  const { issue, workspaceSlug, projectIdentifier, handleRestore } = props;

  const workItemLink = useMemo(
    () =>
      generateWorkItemLink({
        workspaceSlug,
        projectId: issue?.project_id,
        issueId: issue?.id,
        projectIdentifier,
        sequenceId: issue?.sequence_id,
      }),
    [workspaceSlug, projectIdentifier, issue]
  );

  const handleCopyIssueLink = () =>
    copyUrlToClipboard(workItemLink).then(() =>
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Link copied",
        message: "Work item link copied to clipboard",
      })
    );

  const handleOpenInNewTab = () => window.open(workItemLink, "_blank");

  const handleIssueRestore = async () => {
    if (!handleRestore) {
      handleOptionalAction(handleRestore, "Restore");
      return;
    }
    await handleRestore()
      .then(() => {
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Restore success",
          message: "Your work item can be found in project work items.",
        });
      })
      .catch(() => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Error!",
          message: "Work item could not be restored. Please try again.",
        });
      });
  };

  return {
    workItemLink,
    handleCopyIssueLink,
    handleOpenInNewTab,
    handleIssueRestore,
  };
};

/**
 * Returns a set of `TContextMenuItem` builder functions plus the underlying
 * action handlers from {@link useIssueActionHandlers}; the predefined menu
 * item set hooks (`useProjectIssueMenuItems`, `useCycleIssueMenuItems`, etc.)
 * compose subsets of these builders to render their layout-specific menus.
 *
 * Per-builder semantics:
 *   - `createEditMenuItem(customEditAction?)` — opens `CreateUpdateIssueModal`
 *     with the current issue; the `customEditAction` injection point lets the
 *     cycle/module variants preload `cycle_id` / `module_ids` on the edit
 *     payload; `shouldRender = isEditingAllowed`.
 *   - `createCopyMenuItem(workspaceSlug?)` — delegates to
 *     `createCopyMenuWithDuplication` from the plane-web stub so EE editions
 *     can attach a duplicate-with-options submenu; `shouldRender` requires
 *     `isEditingAllowed && (issueTypeDetail?.is_active ?? true)` so inactive
 *     issue types cannot spawn copies.
 *   - `createOpenInNewTabMenuItem` — opens the work-item URL in a new tab via
 *     `actionHandlers.handleOpenInNewTab`.
 *   - `createCopyLinkMenuItem` — copies the work-item URL via
 *     `actionHandlers.handleCopyIssueLink`.
 *   - `createRemoveFromCycleMenuItem` / `createRemoveFromModuleMenuItem` —
 *     route the caller-provided `handleRemoveFromView` through
 *     {@link handleOptionalAction} so a missing handler surfaces a localized
 *     error toast; `shouldRender = isEditingAllowed`.
 *   - `createArchiveMenuItem` — opens `ArchiveIssueModal` via
 *     `setArchiveIssueModal(true)` routed through {@link handleOptionalAction};
 *     `disabled = !isInArchivableGroup` and the description text explains why
 *     the action is disabled when the issue is not in an archivable state
 *     group; `shouldRender = isArchivingAllowed`.
 *   - `createRestoreMenuItem` — invokes `actionHandlers.handleIssueRestore`;
 *     `shouldRender = isRestoringAllowed`.
 *   - `createDeleteMenuItem` — opens `DeleteIssueModal` via
 *     `setDeleteIssueModal(true)`; `shouldRender = isDeletingAllowed`.
 *
 * @param props - {@link MenuItemFactoryProps}.
 * @returns `{ ...actionHandlers, createEditMenuItem, createCopyMenuItem,
 *   createOpenInNewTabMenuItem, createCopyLinkMenuItem,
 *   createRemoveFromCycleMenuItem, createRemoveFromModuleMenuItem,
 *   createArchiveMenuItem, createRestoreMenuItem, createDeleteMenuItem }`.
 */
export const useMenuItemFactory = (props: MenuItemFactoryProps) => {
  const { t } = useTranslation();
  const actionHandlers = useIssueActionHandlers(props);

  const {
    issue,
    activeLayout = "",
    isEditingAllowed,
    isArchivingAllowed = false,
    isDeletingAllowed,
    isRestoringAllowed = false,
    isInArchivableGroup = false,
    issueTypeDetail,
    setIssueToEdit,
    setCreateUpdateIssueModal,
    setDeleteIssueModal,
    setArchiveIssueModal,
    setDuplicateWorkItemModal,
    handleRemoveFromView,
  } = props;

  const createEditMenuItem = (customEditAction?: () => void): TContextMenuItem => ({
    key: "edit",
    title: t("common.actions.edit"),
    icon: EditIcon,
    action:
      customEditAction ||
      (() => {
        setIssueToEdit(issue);
        setCreateUpdateIssueModal(true);
      }),
    shouldRender: isEditingAllowed,
  });

  const createCopyMenuItem = (workspaceSlug?: string): TContextMenuItem => {
    const baseItem = {
      key: "make-a-copy",
      title: t("common.actions.make_a_copy"),
      icon: CopyIcon,
      action: () => {
        setCreateUpdateIssueModal(true);
      },
      shouldRender: isEditingAllowed && (issueTypeDetail?.is_active ?? true),
    };

    return createCopyMenuWithDuplication({
      baseItem,
      activeLayout,
      setCreateUpdateIssueModal,
      setDuplicateWorkItemModal,
      workspaceSlug,
    });
  };

  const createOpenInNewTabMenuItem = (): TContextMenuItem => ({
    key: "open-in-new-tab",
    title: t("common.actions.open_in_new_tab"),
    icon: NewTabIcon,
    action: actionHandlers.handleOpenInNewTab,
  });

  const createCopyLinkMenuItem = (): TContextMenuItem => ({
    key: "copy-link",
    title: t("common.actions.copy_link"),
    icon: LinkIcon,
    action: actionHandlers.handleCopyIssueLink,
  });

  const createRemoveFromCycleMenuItem = (): TContextMenuItem => ({
    key: "remove-from-cycle",
    title: "Remove from cycle",
    icon: XCircle,
    action: () => handleOptionalAction(handleRemoveFromView, "Remove from cycle"),
    shouldRender: isEditingAllowed,
  });

  const createRemoveFromModuleMenuItem = (): TContextMenuItem => ({
    key: "remove-from-module",
    title: "Remove from module",
    icon: XCircle,
    action: () => handleOptionalAction(handleRemoveFromView, "Remove from module"),
    shouldRender: isEditingAllowed,
  });

  const createArchiveMenuItem = (): TContextMenuItem => ({
    key: "archive",
    title: t("common.actions.archive"),
    description: isInArchivableGroup ? undefined : t("issue.archive.description"),
    icon: ArchiveIcon,
    className: "items-start",
    iconClassName: "mt-1",
    action: () => handleOptionalAction(setArchiveIssueModal, "Archive", true),
    disabled: !isInArchivableGroup,
    shouldRender: isArchivingAllowed,
  });

  const createRestoreMenuItem = (): TContextMenuItem => ({
    key: "restore",
    title: "Restore",
    icon: ArchiveRestoreIcon,
    action: actionHandlers.handleIssueRestore,
    shouldRender: isRestoringAllowed,
  });

  const createDeleteMenuItem = (): TContextMenuItem => ({
    key: "delete",
    title: t("common.actions.delete"),
    icon: TrashIcon,
    action: () => {
      setDeleteIssueModal(true);
    },
    shouldRender: isDeletingAllowed,
  });

  return {
    ...actionHandlers,
    createEditMenuItem,
    createCopyMenuItem,
    createOpenInNewTabMenuItem,
    createCopyLinkMenuItem,
    createRemoveFromCycleMenuItem,
    createRemoveFromModuleMenuItem,
    createArchiveMenuItem,
    createRestoreMenuItem,
    createDeleteMenuItem,
  };
};

// Predefined menu item sets for different contexts
/**
 * Standard project-layout menu: Edit, Make-a-copy, Open-in-new-tab,
 * Copy-link, Archive, Delete. Memoized on `[factory]` because the factory
 * already captures every relevant prop dependency via {@link useMenuItemFactory}.
 *
 * @param props - {@link MenuItemFactoryProps}.
 * @returns `TContextMenuItem[]` for the project issue dropdown.
 */
export const useProjectIssueMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  return useMemo(
    () => [
      factory.createEditMenuItem(),
      factory.createCopyMenuItem(),
      factory.createOpenInNewTabMenuItem(),
      factory.createCopyLinkMenuItem(),
      factory.createArchiveMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory]
  );
};

/**
 * Menu rendered on the work-item detail surface: Make-a-copy,
 * Open-in-new-tab, Archive, Restore, Delete. Edit is intentionally omitted
 * because the detail surface already provides inline editing, and
 * `createCopyMenuItem` receives `props.workspaceSlug` here so the plane-web
 * duplicate submenu can resolve the workspace at submenu-open time.
 *
 * @param props - {@link MenuItemFactoryProps}.
 * @returns `TContextMenuItem[]` for the work-item detail dropdown.
 */
export const useWorkItemDetailMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  return useMemo(
    () => [
      factory.createCopyMenuItem(props.workspaceSlug),
      factory.createOpenInNewTabMenuItem(),
      factory.createArchiveMenuItem(),
      factory.createRestoreMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory]
  );
};

/**
 * Global / workspace-wide layout menu — identical to the project layout
 * intentionally; the calling layout disambiguates context via the
 * `activeLayout` label and the `storeType: EIssuesStoreType.GLOBAL`
 * discriminator threaded through {@link MenuItemFactoryProps}.
 *
 * @param props - {@link MenuItemFactoryProps}.
 * @returns `TContextMenuItem[]` for the global issue dropdown.
 */
export const useAllIssueMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  return useMemo(
    () => [
      factory.createEditMenuItem(),
      factory.createCopyMenuItem(),
      factory.createOpenInNewTabMenuItem(),
      factory.createCopyLinkMenuItem(),
      factory.createArchiveMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory]
  );
};

/**
 * Cycle-layout menu: inserts "Remove from cycle" alongside the standard
 * entries and customizes Edit to pre-fill `cycle_id` on the edit payload so
 * the cycle association survives the edit modal round-trip. Memoized on
 * `[factory, props.cycleId]` so the custom action is rebuilt when the cycle
 * context changes.
 *
 * @param props - {@link MenuItemFactoryProps} (`cycleId` is read in addition
 *   to the base factory inputs).
 * @returns `TContextMenuItem[]` for the cycle issue dropdown.
 */
export const useCycleIssueMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  const customEditAction = () => {
    props.setIssueToEdit({
      ...props.issue,
      cycle_id: props.cycleId ?? null,
    });
    props.setCreateUpdateIssueModal(true);
  };

  return useMemo(
    () => [
      factory.createEditMenuItem(customEditAction),
      factory.createCopyMenuItem(),
      factory.createOpenInNewTabMenuItem(),
      factory.createCopyLinkMenuItem(),
      factory.createRemoveFromCycleMenuItem(),
      factory.createArchiveMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory, props.cycleId]
  );
};

/**
 * Module-layout menu: inserts "Remove from module" alongside the standard
 * entries and customizes Edit to pre-fill `module_ids: [moduleId]` on the
 * edit payload so the module association survives the edit modal round-trip.
 * Memoized on `[factory, props.moduleId]` so the custom action is rebuilt
 * when the module context changes.
 *
 * @param props - {@link MenuItemFactoryProps} (`moduleId` is read in addition
 *   to the base factory inputs).
 * @returns `TContextMenuItem[]` for the module issue dropdown.
 */
export const useModuleIssueMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  const customEditAction = () => {
    props.setIssueToEdit({
      ...props.issue,
      module_ids: props.moduleId ? [props.moduleId] : [],
    });
    props.setCreateUpdateIssueModal(true);
  };

  return useMemo(
    () => [
      factory.createEditMenuItem(customEditAction),
      factory.createCopyMenuItem(),
      factory.createOpenInNewTabMenuItem(),
      factory.createCopyLinkMenuItem(),
      factory.createRemoveFromModuleMenuItem(),
      factory.createArchiveMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory, props.moduleId]
  );
};

/**
 * Archived-issue layout menu: Restore, Open-in-new-tab, Copy-link, Delete.
 * Edit, Archive, and Make-a-copy are intentionally omitted because archived
 * items cannot be edited, re-archived, or duplicated until they are restored.
 *
 * @param props - {@link MenuItemFactoryProps}.
 * @returns `TContextMenuItem[]` for the archived issue dropdown.
 */
export const useArchivedIssueMenuItems = (props: MenuItemFactoryProps): TContextMenuItem[] => {
  const factory = useMenuItemFactory(props);

  return useMemo(
    () => [
      factory.createRestoreMenuItem(),
      factory.createOpenInNewTabMenuItem(),
      factory.createCopyLinkMenuItem(),
      factory.createDeleteMenuItem(),
    ],
    [factory]
  );
};
