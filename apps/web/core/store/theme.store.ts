/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Theme store: persisted sidebar/panel visibility and collapse state across
 * the web app's chrome.
 *
 * State slice (each observable is `boolean | undefined`; class fields are
 * initialised to `undefined` — this store performs NO `localStorage.getItem`
 * reads, so hydration from the persisted value is the responsibility of the
 * component reading the observable):
 *   - isAnySidebarDropdownOpen — whether any sidebar dropdown is currently
 *     open (used to short-circuit hover behaviors)
 *   - sidebarCollapsed / sidebarPeek / isExtendedSidebarOpened /
 *     isExtendedProjectSidebarOpened — main app sidebar state
 *   - profileSidebarCollapsed / workspaceAnalyticsSidebarCollapsed /
 *     issueDetailSidebarCollapsed / epicDetailSidebarCollapsed /
 *     initiativesSidebarCollapsed / projectOverviewSidebarCollapsed —
 *     per-page secondary panel state
 *
 * Actions (argument is optional — when omitted the action flips the current
 * value; persistence behavior differs per action — see Persistence below):
 *   - toggleAnySidebarDropdown(open?) — ephemeral dropdown coordination;
 *     in-memory only.
 *   - toggleSidebar(collapsed?) — persists to localStorage.
 *   - toggleSidebarPeek(peek?) — in-memory only (does NOT persist).
 *   - toggleExtendedSidebar(collapsed?) — persists to localStorage.
 *   - toggleExtendedProjectSidebar(collapsed?) — persists to localStorage.
 *   - toggleProfileSidebar(collapsed?) — persists to localStorage.
 *   - toggleWorkspaceAnalyticsSidebar(collapsed?) — persists to localStorage.
 *   - toggleIssueDetailSidebar(collapsed?) — persists to localStorage.
 *   - toggleEpicDetailSidebar(collapsed?) — persists to localStorage.
 *   - toggleInitiativesSidebar(collapsed?) — persists to localStorage.
 *   - toggleProjectOverviewSidebar(collapsed?) — persists to localStorage.
 *
 * Computed: none.
 *
 * Persistence (write-only; no read path lives in this store):
 *   The following 9 actions write to `localStorage` after mutating the
 *   observable — they do NOT read it back, so initial state remains
 *   `undefined` until the first toggle is invoked. Each writes a single
 *   per-flag key with the stringified boolean:
 *     - toggleSidebar                 -> "app_sidebar_collapsed"
 *     - toggleExtendedSidebar         -> "extended_sidebar_collapsed"
 *     - toggleExtendedProjectSidebar  -> "extended_project_sidebar_collapsed"
 *     - toggleProfileSidebar          -> "profile_sidebar_collapsed"
 *     - toggleWorkspaceAnalyticsSidebar -> "workspace_analytics_sidebar_collapsed"
 *     - toggleIssueDetailSidebar      -> "issue_detail_sidebar_collapsed"
 *     - toggleEpicDetailSidebar       -> "epic_detail_sidebar_collapsed"
 *     - toggleInitiativesSidebar      -> "initiatives_sidebar_collapsed"
 *     - toggleProjectOverviewSidebar  -> "project_overview_sidebar_collapsed"
 *   The remaining two actions are intentionally NOT persisted:
 *     - toggleAnySidebarDropdown — transient dropdown-hover coordination.
 *     - toggleSidebarPeek — peek state is per-session UI only.
 *   On SSR the actions are never invoked (no observer subscriptions during
 *   static rendering — see `enableStaticRendering` in `./root.store.ts`),
 *   so the server always observes `undefined`; consumers must handle the
 *   undefined initial state until a client-side hydrator pushes a concrete
 *   value via the matching toggle.
 *
 * Consumers:
 *   - apps/web/core/components/workspace/sidebar/** (main sidebar chrome)
 *   - apps/web/core/components/issues/issue-detail/** (issue detail panel)
 *   - apps/web/core/components/analytics/** (workspace analytics sidebar)
 *   - apps/web/core/components/profile/** (profile sidebar)
 *   - Plus any component that reads sidebar visibility via useTheme store hook
 */

import { action, observable, makeObservable, runInAction } from "mobx";

export interface IThemeStore {
  // observables
  isAnySidebarDropdownOpen: boolean | undefined;
  sidebarCollapsed: boolean | undefined;
  sidebarPeek: boolean | undefined;
  isExtendedSidebarOpened: boolean | undefined;
  isExtendedProjectSidebarOpened: boolean | undefined;
  profileSidebarCollapsed: boolean | undefined;
  workspaceAnalyticsSidebarCollapsed: boolean | undefined;
  issueDetailSidebarCollapsed: boolean | undefined;
  epicDetailSidebarCollapsed: boolean | undefined;
  initiativesSidebarCollapsed: boolean | undefined;
  projectOverviewSidebarCollapsed: boolean | undefined;
  // actions
  toggleAnySidebarDropdown: (open?: boolean) => void;
  toggleSidebar: (collapsed?: boolean) => void;
  toggleSidebarPeek: (peek?: boolean) => void;
  toggleExtendedSidebar: (collapsed?: boolean) => void;
  toggleExtendedProjectSidebar: (collapsed?: boolean) => void;
  toggleProfileSidebar: (collapsed?: boolean) => void;
  toggleWorkspaceAnalyticsSidebar: (collapsed?: boolean) => void;
  toggleIssueDetailSidebar: (collapsed?: boolean) => void;
  toggleEpicDetailSidebar: (collapsed?: boolean) => void;
  toggleInitiativesSidebar: (collapsed?: boolean) => void;
  toggleProjectOverviewSidebar: (collapsed?: boolean) => void;
}

export class ThemeStore implements IThemeStore {
  // observables
  isAnySidebarDropdownOpen: boolean | undefined = undefined;
  sidebarCollapsed: boolean | undefined = undefined;
  sidebarPeek: boolean | undefined = undefined;
  isExtendedSidebarOpened: boolean | undefined = undefined;
  isExtendedProjectSidebarOpened: boolean | undefined = undefined;
  profileSidebarCollapsed: boolean | undefined = undefined;
  workspaceAnalyticsSidebarCollapsed: boolean | undefined = undefined;
  issueDetailSidebarCollapsed: boolean | undefined = undefined;
  epicDetailSidebarCollapsed: boolean | undefined = undefined;
  initiativesSidebarCollapsed: boolean | undefined = undefined;
  projectOverviewSidebarCollapsed: boolean | undefined = undefined;

  constructor() {
    makeObservable(this, {
      // observable
      isAnySidebarDropdownOpen: observable.ref,
      sidebarCollapsed: observable.ref,
      sidebarPeek: observable.ref,
      isExtendedSidebarOpened: observable.ref,
      isExtendedProjectSidebarOpened: observable.ref,
      profileSidebarCollapsed: observable.ref,
      workspaceAnalyticsSidebarCollapsed: observable.ref,
      issueDetailSidebarCollapsed: observable.ref,
      epicDetailSidebarCollapsed: observable.ref,
      initiativesSidebarCollapsed: observable.ref,
      projectOverviewSidebarCollapsed: observable.ref,
      // action
      toggleAnySidebarDropdown: action,
      toggleSidebar: action,
      toggleSidebarPeek: action,
      toggleExtendedSidebar: action,
      toggleExtendedProjectSidebar: action,
      toggleProfileSidebar: action,
      toggleWorkspaceAnalyticsSidebar: action,
      toggleIssueDetailSidebar: action,
      toggleEpicDetailSidebar: action,
      toggleInitiativesSidebar: action,
      toggleProjectOverviewSidebar: action,
    });
  }

  toggleAnySidebarDropdown = (open?: boolean) => {
    if (open === undefined) {
      this.isAnySidebarDropdownOpen = !this.isAnySidebarDropdownOpen;
    } else {
      this.isAnySidebarDropdownOpen = open;
    }
  };

  /**
   * Toggle the sidebar collapsed state
   * @param collapsed
   */
  toggleSidebar = (collapsed?: boolean) => {
    if (collapsed === undefined) {
      this.sidebarCollapsed = !this.sidebarCollapsed;
    } else {
      this.sidebarCollapsed = collapsed;
    }
    localStorage.setItem("app_sidebar_collapsed", this.sidebarCollapsed.toString());
  };

  /**
   * Toggle the sidebar peek state
   * @param peek
   */
  toggleSidebarPeek = (peek?: boolean) => {
    if (peek === undefined) {
      this.sidebarPeek = !this.sidebarPeek;
    } else {
      this.sidebarPeek = peek;
    }
  };

  /**
   * Toggle the extended sidebar collapsed state
   * @param collapsed
   */
  toggleExtendedSidebar = (collapsed?: boolean) => {
    const updatedState = collapsed ?? !this.isExtendedSidebarOpened;
    runInAction(() => {
      this.isExtendedSidebarOpened = updatedState;
    });
    localStorage.setItem("extended_sidebar_collapsed", updatedState.toString());
  };

  /**
   * Toggle the extended project sidebar collapsed state
   * @param collapsed
   */
  toggleExtendedProjectSidebar = (collapsed?: boolean) => {
    if (collapsed === undefined) {
      this.isExtendedProjectSidebarOpened = !this.isExtendedProjectSidebarOpened;
    } else {
      this.isExtendedProjectSidebarOpened = collapsed;
    }
    localStorage.setItem("extended_project_sidebar_collapsed", this.isExtendedProjectSidebarOpened.toString());
  };

  /**
   * Toggle the profile sidebar collapsed state
   * @param collapsed
   */
  toggleProfileSidebar = (collapsed?: boolean) => {
    if (collapsed === undefined) {
      this.profileSidebarCollapsed = !this.profileSidebarCollapsed;
    } else {
      this.profileSidebarCollapsed = collapsed;
    }
    localStorage.setItem("profile_sidebar_collapsed", this.profileSidebarCollapsed.toString());
  };

  /**
   * Toggle the profile sidebar collapsed state
   * @param collapsed
   */
  toggleWorkspaceAnalyticsSidebar = (collapsed?: boolean) => {
    if (collapsed === undefined) {
      this.workspaceAnalyticsSidebarCollapsed = !this.workspaceAnalyticsSidebarCollapsed;
    } else {
      this.workspaceAnalyticsSidebarCollapsed = collapsed;
    }
    localStorage.setItem("workspace_analytics_sidebar_collapsed", this.workspaceAnalyticsSidebarCollapsed.toString());
  };

  toggleIssueDetailSidebar = (collapsed?: boolean) => {
    if (collapsed === undefined) {
      this.issueDetailSidebarCollapsed = !this.issueDetailSidebarCollapsed;
    } else {
      this.issueDetailSidebarCollapsed = collapsed;
    }
    localStorage.setItem("issue_detail_sidebar_collapsed", this.issueDetailSidebarCollapsed.toString());
  };

  toggleEpicDetailSidebar = (collapsed?: boolean) => {
    if (collapsed === undefined) {
      this.epicDetailSidebarCollapsed = !this.epicDetailSidebarCollapsed;
    } else {
      this.epicDetailSidebarCollapsed = collapsed;
    }
    localStorage.setItem("epic_detail_sidebar_collapsed", this.epicDetailSidebarCollapsed.toString());
  };

  toggleInitiativesSidebar = (collapsed?: boolean) => {
    if (collapsed === undefined) {
      this.initiativesSidebarCollapsed = !this.initiativesSidebarCollapsed;
    } else {
      this.initiativesSidebarCollapsed = collapsed;
    }
    localStorage.setItem("initiatives_sidebar_collapsed", this.initiativesSidebarCollapsed.toString());
  };

  toggleProjectOverviewSidebar = (collapsed?: boolean) => {
    if (collapsed === undefined) {
      this.projectOverviewSidebarCollapsed = !this.projectOverviewSidebarCollapsed;
    } else {
      this.projectOverviewSidebarCollapsed = collapsed;
    }
    localStorage.setItem("project_overview_sidebar_collapsed", this.projectOverviewSidebarCollapsed.toString());
  };
}
