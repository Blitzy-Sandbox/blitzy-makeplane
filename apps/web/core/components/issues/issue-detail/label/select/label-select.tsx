/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX-observed combobox label picker rendered inside the issue-detail panel — lets a user search,
 * select, deselect, and (when permitted) inline-create labels for the active work item. Opens as a
 * Headless UI `Combobox` popover positioned by `react-popper`, triggered from a small `+ Select label`
 * button rendered next to the existing label chips.
 *
 * Props — see {@link IIssueLabelSelect}:
 *  - `workspaceSlug` / `projectId` (required strings): scope every label fetch and inline-create
 *    request. `projectId` additionally gates the inline-create capability via
 *    `allowPermissions(..., EUserPermissionsLevel.PROJECT, workspaceSlug, projectId)`.
 *  - `issueId` (required string): identifies the active work item; component renders `<></>`
 *    early when this is falsy.
 *  - `values` (required string[]): currently selected `label_ids`; component renders `<></>`
 *    early when this is falsy.
 *  - `onSelect` (required `(labelIds: string[]) => void`): invoked on every chip toggle (Combobox
 *    `onChange`) and after a successful inline-create. Wired upstream by `IssueLabelSelectRoot`
 *    to `labelOperations.updateIssue(...)` for persistence.
 *  - `onAddLabel` (required `(workspaceSlug, projectId, data: Partial<IIssueLabel>) =>
 *    Promise<any>`): invoked to create + auto-select a new label inline. Wired upstream to
 *    `labelOperations.createLabel(...)`.
 *
 * MobX stores read (`observer` is REQUIRED because each slice is observable and may mutate while
 * the popover is mounted — e.g., another tab renaming/recoloring a label, or the active user's
 * role changing):
 *  - {@link useLabel} → `getProjectLabels(projectId)` returns the observable label list, and
 *    `fetchProjectLabels(workspaceSlug, projectId)` lazily populates it.
 *  - {@link useUserPermissions} → `allowPermissions([EUserProjectRoles.ADMIN],
 *    EUserPermissionsLevel.PROJECT, workspaceSlug, projectId)` gates the inline-create UI. NOTE:
 *    the actual gate is `ADMIN` at the project level — only project admins can inline-create
 *    labels via this combobox; non-admins see `t("common.search.no_matching_results")` in the
 *    empty state.
 *  - {@link usePlatformOS} → `isMobile` flows into `getTabIndex(undefined, isMobile)` so the
 *    on-screen keyboard does not auto-open when the popover is just being inspected on mobile.
 *  - `useTranslation()` from `@plane/i18n` → localized strings (`label.select`,
 *    `common.search.label`, `common.loading`, `label.create.type`,
 *    `common.search.no_matching_results`).
 *
 * Side effects:
 *  - Lazy fetch on open: `Combobox.Button.onClick` calls `fetchLabels()` only when
 *    `!projectLabels`, which invokes `fetchProjectLabels(workspaceSlug, projectId)` on the label
 *    store. The store delegates to `IssueLabelService.getProjectLabels`
 *    (`GET /api/workspaces/<slug>/projects/<projectId>/issue-labels/`) and sets `isLoading`
 *    while in flight. This is the ONLY API call this component makes directly.
 *  - Inline label creation (two paths): pressing Enter on a non-empty `query` (no native
 *    composition in progress AND `canCreateLabel` true), OR clicking the inline-create
 *    `Combobox.Option`, both call `handleAddLabel(query)`. That calls `onAddLabel(workspaceSlug,
 *    projectId, { name, color: getRandomLabelColor() })`; on resolve, the new label id is
 *    appended via `onSelect([...values, label.id])` and the query is cleared.
 *  - Persistence delegation: the `onSelect` callback fires on every chip toggle (add or remove)
 *    via `Combobox onChange`; the actual issue-update API call happens UPSTREAM in
 *    `IssueLabelSelectRoot.handleLabel` → `labelOperations.updateIssue` →
 *    `useIssueDetail().updateIssue`, not in this component.
 *  - Toast emissions: handled UPSTREAM in `labelOperations` (defined in `../root.tsx`). This
 *    component itself does NOT emit toasts.
 *
 * Derived state notes (non-obvious):
 *  - `referenceElement` and `popperElement` are `useState` (NOT `useRef`) so `react-popper`'s
 *    `usePopper` recomputes positioning when each DOM ref settles — plain refs would not trigger
 *    the popper hook to recompute on initial mount.
 *  - Filtering: `query` filters `options` case-insensitively against `label.name`; an empty query
 *    returns the full unfiltered list.
 *  - Early-return: returns `<></>` when `!issueId || !values` — this is the actual guard, NOT
 *    `!workspaceSlug || !projectId`.
 *  - `submitting` local state guards inline-create double-submits and drives the Lucide `Loader`
 *    icon (the submitting-state spinner) while `onAddLabel` is in flight.
 *  - `canCreateLabel` is a *conjunction* of `projectId` truthiness AND admin permission; when
 *    false, the empty-state renders `t("common.search.no_matching_results")` rather than the
 *    create option.
 *  - `options` is rebuilt from `projectLabels ?? []` on every render with no memoization;
 *    acceptable because `projectLabels` is referentially stable from the MobX store until the
 *    underlying observable mutates.
 *
 * Accessibility:
 *  - Headless UI `Combobox` provides ARIA combobox semantics (`role="combobox"`,
 *    `aria-expanded`, `aria-activedescendant`), arrow-key option navigation, Enter to
 *    select/inline-create, Escape to close, and Tab focus management out of the box.
 *  - Search input `tabIndex` is driven by `getTabIndex(undefined, isMobile)` so mobile focus does
 *    not auto-open the keyboard.
 *  - Color swatches use inline `style={{ backgroundColor: label.color }}` for preview; the
 *    accessible name is provided by the adjacent label name text node.
 *  - `searchInputKeyDown` explicitly `stopPropagation`s and `preventDefault`s on Enter so the
 *    keystroke does not bubble to surrounding form handlers (the issue-detail panel may sit
 *    inside a parent form).
 *
 * Architectural notes (per monorepo state contract — MobX exclusively):
 *  - `observer` is required to react to observable updates from `useLabel` / `useUserPermissions`
 *    while the popover is mounted.
 *  - Upstream wrapper: `./root.tsx` (`IssueLabelSelectRoot`) supplies `onSelect`/`onAddLabel`
 *    from the `TLabelOperations` contract defined in `../root.tsx`.
 *  - This component is intentionally issue-context-agnostic at its API surface (`onSelect`
 *    accepts a `string[]`, not an issue object) so it could be reused in non-issue surfaces
 *    without coupling to issue-detail mutation specifics.
 *  - Inline-created labels receive `getRandomLabelColor()` from `@plane/constants` — see that
 *    module if the random color palette ever needs to be adjusted.
 *
 * Consumers: rendered by `./root.tsx` (`IssueLabelSelectRoot`) inside the issue-detail
 * label workflow as the searchable combobox affordance.
 */

import { Fragment, useState } from "react";
import { observer } from "mobx-react";
import { usePopper } from "react-popper";
import { Loader } from "lucide-react";
import { Combobox } from "@headlessui/react";
// plane imports
import { EUserPermissionsLevel, getRandomLabelColor } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { CheckIcon, SearchIcon, PlusIcon } from "@plane/propel/icons";
import type { IIssueLabel } from "@plane/types";
import { EUserProjectRoles } from "@plane/types";
// helpers
import { getTabIndex } from "@plane/utils";
// hooks
import { useLabel } from "@/hooks/store/use-label";
import { useUserPermissions } from "@/hooks/store/user";
import { usePlatformOS } from "@/hooks/use-platform-os";
//constants
/**
 * Props contract for {@link IssueLabelSelect}.
 *
 * `onSelect` and `onAddLabel` are wired upstream by `IssueLabelSelectRoot` (`./root.tsx`) from the
 * `TLabelOperations` contract defined in `../root.tsx`. See the module-level JSDoc above for the
 * full behavioral contract (lazy fetch, inline-create paths, permission gating, persistence
 * delegation).
 */
export interface IIssueLabelSelect {
  /** Workspace slug used to scope the label fetch and inline-create requests. */
  workspaceSlug: string;
  /**
   * Project id used to scope the label fetch AND to gate the inline-create capability via
   * `allowPermissions([ADMIN], PROJECT, workspaceSlug, projectId)` — only project admins may
   * inline-create labels through this combobox.
   */
  projectId: string;
  /** Active work item id; component early-returns `<></>` when this is falsy. */
  issueId: string;
  /** Currently selected `label_ids`; component early-returns `<></>` when this is falsy. */
  values: string[];
  /**
   * Invoked with the new `label_ids` array on every chip toggle and after a successful
   * inline-create; persistence is delegated upstream to `labelOperations.updateIssue`.
   */
  onSelect: (_labelIds: string[]) => void;
  /**
   * Invoked to create + auto-select a new label (Enter on the search query OR click on the
   * inline-create option); resolves to the created label via `labelOperations.createLabel`.
   */
  onAddLabel: (workspaceSlug: string, projectId: string, data: Partial<IIssueLabel>) => Promise<any>;
}

/**
 * Combobox-based label picker for the issue-detail panel — search, select/deselect, and (when
 * permitted) inline-create labels for a single work item.
 *
 * Wrapped in `observer` because the component reads observable slices (`useLabel`,
 * `useUserPermissions`) that may mutate while the popover is mounted; without the wrapper the
 * popover content would not react to cross-tab label edits or permission changes.
 *
 * @param props - See {@link IIssueLabelSelect}; the module-level JSDoc above documents stores,
 *   side effects, derived state, accessibility, and architectural notes in full.
 * @returns The combobox trigger button + popover element tree, or `<></>` when `issueId` or
 *   `values` is falsy.
 */
export const IssueLabelSelect = observer(function IssueLabelSelect(props: IIssueLabelSelect) {
  const { workspaceSlug, projectId, issueId, values, onSelect, onAddLabel } = props;
  const { t } = useTranslation();
  // store hooks
  const { isMobile } = usePlatformOS();
  const { fetchProjectLabels, getProjectLabels } = useLabel();
  const { allowPermissions } = useUserPermissions();
  // states
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  const canCreateLabel =
    projectId && allowPermissions([EUserProjectRoles.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);

  const projectLabels = getProjectLabels(projectId);

  const { baseTabIndex } = getTabIndex(undefined, isMobile);

  const fetchLabels = () => {
    setIsLoading(true);
    if (!projectLabels && workspaceSlug && projectId)
      fetchProjectLabels(workspaceSlug, projectId).then(() => setIsLoading(false));
  };

  const options = (projectLabels ?? []).map((label) => ({
    value: label.id,
    query: label.name,
    content: (
      <div className="flex items-center justify-start gap-2 overflow-hidden">
        <span
          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{
            backgroundColor: label.color,
          }}
        />
        <div className="line-clamp-1 inline-block truncate">{label.name}</div>
      </div>
    ),
  }));

  const filteredOptions =
    query === "" ? options : options?.filter((option) => option.query.toLowerCase().includes(query.toLowerCase()));

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: "bottom-start",
    modifiers: [
      {
        name: "preventOverflow",
        options: {
          padding: 12,
        },
      },
    ],
  });

  const issueLabels = values ?? [];

  const label = <span className="text-body-xs-medium text-placeholder">{t("label.select")}</span>;

  const searchInputKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (query !== "" && e.key === "Escape") {
      e.stopPropagation();
      setQuery("");
    }

    if (query !== "" && e.key === "Enter" && !e.nativeEvent.isComposing && canCreateLabel) {
      e.stopPropagation();
      e.preventDefault();
      await handleAddLabel(query);
    }
  };

  const handleAddLabel = async (labelName: string) => {
    setSubmitting(true);
    const label = await onAddLabel(workspaceSlug, projectId, { name: labelName, color: getRandomLabelColor() });
    onSelect([...values, label.id]);
    setQuery("");
    setSubmitting(false);
  };

  if (!issueId || !values) return <></>;

  return (
    <>
      <Combobox
        as="div"
        className="size-full flex-shrink-0 text-left"
        value={issueLabels}
        onChange={(value) => onSelect(value)}
        multiple
      >
        <Combobox.Button as={Fragment}>
          <Button
            ref={setReferenceElement}
            type="button"
            variant="tertiary"
            size="sm"
            prependIcon={<PlusIcon />}
            onClick={() => !projectLabels && fetchLabels()}
          >
            {label}
          </Button>
        </Combobox.Button>

        <Combobox.Options className="fixed z-10">
          <div
            className={`z-10 my-1 w-48 rounded-sm border border-strong bg-surface-1 py-2.5 text-11 whitespace-nowrap shadow-raised-200 focus:outline-none`}
            ref={setPopperElement}
            style={styles.popper}
            {...attributes.popper}
          >
            <div className="px-2">
              <div className="flex w-full items-center justify-start rounded-sm border border-subtle bg-surface-2 px-2">
                <SearchIcon className="h-3.5 w-3.5 text-tertiary" />
                <Combobox.Input
                  className="w-full bg-transparent px-2 py-1 text-11 text-secondary placeholder:text-placeholder focus:outline-none"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("common.search.label")}
                  displayValue={(assigned: any) => assigned?.name}
                  onKeyDown={searchInputKeyDown}
                  tabIndex={baseTabIndex}
                />
              </div>
            </div>
            <div className={`vertical-scrollbar mt-2 scrollbar-sm max-h-48 space-y-1 overflow-y-scroll px-2 pr-0`}>
              {isLoading ? (
                <p className="text-center text-secondary">{t("common.loading")}</p>
              ) : filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
                  <Combobox.Option
                    key={option.value}
                    value={option.value}
                    className={({ selected }) =>
                      `flex cursor-pointer items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 select-none hover:bg-layer-1 ${
                        selected ? "text-primary" : "text-secondary"
                      }`
                    }
                  >
                    {({ selected }) => (
                      <>
                        {option.content}
                        {selected && (
                          <div className="flex-shrink-0">
                            <CheckIcon className={`h-3.5 w-3.5`} />
                          </div>
                        )}
                      </>
                    )}
                  </Combobox.Option>
                ))
              ) : submitting ? (
                <Loader className="spin h-3.5 w-3.5" />
              ) : canCreateLabel ? (
                <Combobox.Option
                  value={query}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!query.length) return;
                    handleAddLabel(query);
                  }}
                  className={`text-left text-secondary ${query.length ? "cursor-pointer" : "cursor-default"}`}
                >
                  {query.length ? (
                    <>
                      {/* TODO: Translate here */}+ Add <span className="text-primary">&quot;{query}&quot;</span> to
                      labels
                    </>
                  ) : (
                    t("label.create.type")
                  )}
                </Combobox.Option>
              ) : (
                <p className="text-left text-secondary">{t("common.search.no_matching_results")}</p>
              )}
            </div>
          </div>
        </Combobox.Options>
      </Combobox>
    </>
  );
});
