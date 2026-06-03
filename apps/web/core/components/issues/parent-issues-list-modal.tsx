/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Searchable parent/epic selector modal for work items.
 *
 * Rendered purpose: a `ModalCore`-wrapped headless UI `Combobox` that lets users search
 * project work items (or epics) by name and pick a parent reference; emits the selected
 * `ISearchIssueResponse` via the `onChange` prop.
 *
 * Props:
 *   - isOpen (boolean, required): modal open state
 *   - handleClose (() => void, required): close-modal callback (aliased internally to `onClose`)
 *   - value (any, optional): currently selected combobox value passed to `Combobox`
 *   - onChange ((issue: ISearchIssueResponse) => void, required): selection callback fired when a result is picked
 *   - projectId (string | undefined, required): scopes the search to a project
 *   - issueId (string, optional): excludes this issue from search results (server-side filter)
 *   - searchEpic (boolean, optional, default=false): when true, the modal omits the `parent: true`
 *     filter and instead sends `epic: true` on the search payload — see the `epic` flag note below.
 *
 * MobX stores read: none — this component is store-free. Routing context is obtained via `useParams`
 * (router hook), and platform context via the `usePlatformOS` hook.
 *
 * Side effects:
 *   - API call: `ProjectService.projectIssuesSearch(workspaceSlug, projectId, { search, parent, issue_id, workspace_search, epic })`
 *     via the module-level `projectService` instance, debounced through `useDebounce(searchTerm, 500)`.
 *     // INTENT UNCLEAR: the `epic` query parameter is sent on the wire but the community-edition
 *     // `IssueSearchEndpoint` (`apps/api/plane/app/views/search/issue.py`) reads only
 *     // `search` / `workspace_search` / `parent` / `issue_relation` / `cycle` / `module` /
 *     // `sub_issue` / `target_date` / `issue_id` — so today this parameter has no effect on the
 *     // backend. Behavior of the `epic` flag is presumed to be implemented by the
 *     // enterprise-edition search surface; do not invent semantics here.
 *   - Opens external links via the rocket affordance on a result row using an
 *     `<a target="_blank" rel="noopener noreferrer">` anchor to avoid reverse-tabnabbing on the
 *     spawned tab.
 *
 * Imperative DOM/derived state notes:
 *   - `useDebounce` debounces the user's search input by 500ms before each backend call.
 *   - The effect on `[debouncedSearchTerm, isOpen, issueId, projectId, workspaceSlug]` re-runs both when
 *     the modal opens AND when the debounced query changes, populating `issues` state.
 *
 * Consumers: rendered by parent-select surfaces — e.g.,
 * `apps/web/core/components/issues/issue-detail/parent-select.tsx` and the issue-create modal's parent
 * picker, plus epic-parent flows that pass `searchEpic=true`.
 */

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
// icons
import { Rocket } from "lucide-react";
// headless ui
import { Combobox } from "@headlessui/react";
// i18n
import { useTranslation } from "@plane/i18n";
import { SearchIcon } from "@plane/propel/icons";
// types
import type { ISearchIssueResponse } from "@plane/types";
// ui
import { Loader, EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { generateWorkItemLink, getTabIndex } from "@plane/utils";
// components
import { IssueSearchModalEmptyState } from "@/components/core/modals/issue-search-modal-empty-state";
// helpers
// hooks
import useDebounce from "@/hooks/use-debounce";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
// services
import { ProjectService } from "@/services/project";

type Props = {
  isOpen: boolean;
  handleClose: () => void;
  value?: any;
  onChange: (issue: ISearchIssueResponse) => void;
  projectId: string | undefined;
  issueId?: string;
  searchEpic?: boolean;
};

// services
const projectService = new ProjectService();

export function ParentIssuesListModal({
  isOpen,
  handleClose: onClose,
  value,
  onChange,
  projectId,
  issueId,
  searchEpic = false,
}: Props) {
  // i18n
  const { t } = useTranslation();

  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [issues, setIssues] = useState<ISearchIssueResponse[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const { isMobile } = usePlatformOS();
  const debouncedSearchTerm: string = useDebounce(searchTerm, 500);

  const { workspaceSlug } = useParams();

  const { baseTabIndex } = getTabIndex(undefined, isMobile);

  const handleClose = () => {
    onClose();
    setSearchTerm("");
  };

  useEffect(() => {
    if (!isOpen || !workspaceSlug || !projectId) return;

    setIsSearching(true);
    setIsLoading(true);

    projectService
      .projectIssuesSearch(workspaceSlug, projectId, {
        search: debouncedSearchTerm,
        parent: searchEpic ? undefined : true,
        issue_id: issueId,
        workspace_search: false,
        epic: searchEpic ? true : undefined,
      })
      .then((res) => setIssues(res))
      .finally(() => {
        setIsSearching(false);
        setIsLoading(false);
      });
  }, [debouncedSearchTerm, isOpen, issueId, projectId, workspaceSlug]);

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.CENTER} width={EModalWidth.XXL}>
      <Combobox
        value={value}
        onChange={(val) => {
          onChange(val);
          handleClose();
        }}
      >
        <div className="relative m-1">
          <SearchIcon
            className="text-opacity-40 pointer-events-none absolute top-3.5 left-4 h-5 w-5 text-primary"
            aria-hidden="true"
          />
          <Combobox.Input
            className="h-12 w-full border-0 bg-transparent pr-4 pl-11 text-primary outline-none placeholder:text-placeholder focus:ring-0 sm:text-13"
            placeholder={t("common.search.placeholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            displayValue={() => ""}
            tabIndex={baseTabIndex}
          />
        </div>
        <Combobox.Options static className="vertical-scrollbar scrollbar-md max-h-80 scroll-py-2 overflow-y-auto">
          {searchTerm !== "" && (
            <h5 className="mx-2 text-13 text-secondary">
              Search results for{" "}
              <span className="text-primary">
                {'"'}
                {searchTerm}
                {'"'}
              </span>{" "}
              in project:
            </h5>
          )}

          {isSearching || isLoading ? (
            <Loader className="space-y-3 p-3">
              <Loader.Item height="40px" />
              <Loader.Item height="40px" />
              <Loader.Item height="40px" />
              <Loader.Item height="40px" />
            </Loader>
          ) : (
            <>
              {issues.length === 0 ? (
                <IssueSearchModalEmptyState
                  debouncedSearchTerm={debouncedSearchTerm}
                  isSearching={isSearching}
                  issues={issues}
                  searchTerm={searchTerm}
                />
              ) : (
                <ul className={`text-13 ${issues.length > 0 ? "p-2" : ""}`}>
                  {issues.map((issue) => (
                    <Combobox.Option
                      key={issue.id}
                      value={issue}
                      className={({ active, selected }) =>
                        `group my-0.5 flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-secondary select-none ${
                          active ? "bg-layer-1 text-primary" : ""
                        } ${selected ? "text-primary" : ""}`
                      }
                    >
                      <div className="flex flex-grow items-center gap-2 truncate">
                        <span
                          className="block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                          style={{
                            backgroundColor: issue.state__color,
                          }}
                        />
                        <span className="flex-shrink-0">
                          <IssueIdentifier
                            projectId={issue.project_id}
                            issueTypeId={issue.type_id}
                            projectIdentifier={issue.project__identifier}
                            issueSequenceId={issue.sequence_id}
                            size="xs"
                            variant="secondary"
                          />
                        </span>{" "}
                        <span className="truncate">{issue.name}</span>
                      </div>
                      <a
                        href={generateWorkItemLink({
                          workspaceSlug: workspaceSlug.toString(),
                          projectId: issue?.project_id,
                          issueId: issue?.id,
                          projectIdentifier: issue.project__identifier,
                          sequenceId: issue?.sequence_id,
                        })}
                        target="_blank"
                        className="relative z-1 hidden flex-shrink-0 text-secondary group-hover:block hover:text-primary"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Rocket className="h-4 w-4" />
                      </a>
                    </Combobox.Option>
                  ))}
                </ul>
              )}
            </>
          )}
        </Combobox.Options>
      </Combobox>
    </ModalCore>
  );
}
