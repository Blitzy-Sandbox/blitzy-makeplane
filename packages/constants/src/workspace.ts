/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Workspace vocabulary — onboarding org-size buckets, role labels, static view
 * catalogs, and the global-search result shape seed — consumed by
 * `apps/web/core/components/workspace/**` and workspace MobX stores.
 */

import type { TStaticViewTypes, IWorkspaceSearchResults } from "@plane/types";
import { EUserWorkspaceRoles } from "@plane/types";

/**
 * Predefined organization-size buckets shown in the workspace onboarding picker.
 *
 * Consumers: onboarding flow in `apps/web/core/components/onboarding/**`.
 */
export const ORGANIZATION_SIZE: string[] = ["Just myself", "2-10", "11-50", "51-200", "201-500", "500+"];

/**
 * URL path segments that cannot be used as workspace slugs because they collide
 * with first-party routes (e.g., `api`, `admin`, `signin`, `live`) or with
 * marketing/feature pages reserved on `app.plane.so`.
 *
 * Consumers: workspace-slug validators in `apps/web/core/components/workspace/**`
 * and `apps/api/plane/app/serializers/workspace.py` (mirrored validation on the
 * server side).
 */
export const RESTRICTED_URLS: string[] = [
  "404",
  "accounts",
  "api",
  "create-workspace",
  "god-mode",
  "installations",
  "invitations",
  "onboarding",
  "profile",
  "spaces",
  "workspace-invitations",
  "password",
  "flags",
  "monitor",
  "monitoring",
  "ingest",
  "plane-pro",
  "plane-ultimate",
  "enterprise",
  "plane-enterprise",
  "disco",
  "silo",
  "chat",
  "calendar",
  "drive",
  "channels",
  "upgrade",
  "billing",
  "sign-in",
  "sign-up",
  "signin",
  "signup",
  "config",
  "live",
  "admin",
  "m",
  "import",
  "importers",
  "integrations",
  "integration",
  "configuration",
  "initiatives",
  "initiative",
  "config",
  "workflow",
  "workflows",
  "epics",
  "epic",
  "story",
  "mobile",
  "dashboard",
  "desktop",
  "onload",
  "real-time",
  "one",
  "pages",
  "mobile",
  "business",
  "pro",
  "settings",
  "monitor",
  "license",
  "licenses",
  "instances",
  "instance",
];

/**
 * Display label per `EUserWorkspaceRoles` value — used wherever a role needs to
 * be shown as a human-readable string (member lists, role pickers).
 *
 * Consumers: `apps/web/core/components/workspace/**` and `apps/web/core/components/project/**`
 * member-management UIs.
 */
export const ROLE = {
  [EUserWorkspaceRoles.GUEST]: "Guest",
  [EUserWorkspaceRoles.MEMBER]: "Member",
  [EUserWorkspaceRoles.ADMIN]: "Admin",
};

/**
 * Localization keys per workspace role — used in role-picker tooltips/details so
 * the i18n layer can render the title + description for each role.
 *
 * Consumers: role pickers in member-invite modals across `apps/web/core/components/workspace/**`.
 */
export const ROLE_DETAILS = {
  [EUserWorkspaceRoles.GUEST]: {
    i18n_title: "role_details.guest.title",
    i18n_description: "role_details.guest.description",
  },
  [EUserWorkspaceRoles.MEMBER]: {
    i18n_title: "role_details.member.title",
    i18n_description: "role_details.member.description",
  },
  [EUserWorkspaceRoles.ADMIN]: {
    i18n_title: "role_details.admin.title",
    i18n_description: "role_details.admin.description",
  },
};

/**
 * Onboarding job-title options paired with their i18n labels — used in the user
 * profile/onboarding step to capture role context for product analytics.
 *
 * Consumers: `apps/web/core/components/onboarding/**`.
 */
export const USER_ROLES = [
  {
    value: "Product / Project Manager",
    i18n_label: "user_roles.product_or_project_manager",
  },
  {
    value: "Development / Engineering",
    i18n_label: "user_roles.development_or_engineering",
  },
  {
    value: "Founder / Executive",
    i18n_label: "user_roles.founder_or_executive",
  },
  {
    value: "Freelancer / Consultant",
    i18n_label: "user_roles.freelancer_or_consultant",
  },
  { value: "Marketing / Growth", i18n_label: "user_roles.marketing_or_growth" },
  {
    value: "Sales / Business Development",
    i18n_label: "user_roles.sales_or_business_development",
  },
  {
    value: "Support / Operations",
    i18n_label: "user_roles.support_or_operations",
  },
  {
    value: "Student / Professor",
    i18n_label: "user_roles.student_or_professor",
  },
  { value: "Human Resources", i18n_label: "user_roles.human_resources" },
  { value: "Other", i18n_label: "user_roles.other" },
];

/**
 * Available data importers shown in the workspace import settings — each entry's
 * `provider` matches a corresponding importer in the backend importer registry.
 *
 * Consumers: import settings UI in `apps/web/core/components/workspace/**`, paired
 * with the importer model at `apps/api/plane/db/models/importer.py` and integration
 * models at `apps/api/plane/db/models/integration/**`.
 */
export const IMPORTERS_LIST = [
  {
    provider: "github",
    type: "import",
    i18n_title: "importer.github.title",
    i18n_description: "importer.github.description",
  },
  {
    provider: "jira",
    type: "import",
    i18n_title: "importer.jira.title",
    i18n_description: "importer.jira.description",
  },
];

/**
 * Data exporters (CSV/Excel/JSON) shown in workspace export settings — `xlsx`/`json` intentionally reuse `exporter.csv.description` as a shared i18n string (not a copy-paste error).
 * Consumers: export settings UI in `apps/web/core/components/workspace/**`, paired with the `apps/api/plane/bgtasks/export_task.py` server-side job.
 */
export const EXPORTERS_LIST = [
  {
    provider: "csv",
    type: "export",
    i18n_title: "exporter.csv.title",
    i18n_description: "exporter.csv.description",
  },
  {
    provider: "xlsx",
    type: "export",
    i18n_title: "exporter.excel.title",
    i18n_description: "exporter.csv.description",
  },
  {
    provider: "json",
    type: "export",
    i18n_title: "exporter.json.title",
    i18n_description: "exporter.csv.description",
  },
];

/**
 * The four built-in global views available to every workspace (cannot be deleted):
 * all-issues, assigned-to-me, created-by-me, subscribed.
 *
 * Consumers: workspace global views shell in `apps/web/core/components/workspace/views/**`.
 */
export const DEFAULT_GLOBAL_VIEWS_LIST: {
  key: TStaticViewTypes;
  i18n_label: string;
}[] = [
  {
    key: "all-issues",
    i18n_label: "default_global_view.all_issues",
  },
  {
    key: "assigned",
    i18n_label: "default_global_view.assigned",
  },
  {
    key: "created",
    i18n_label: "default_global_view.created",
  },
  {
    key: "subscribed",
    i18n_label: "default_global_view.subscribed",
  },
];

/**
 * Shape of a workspace sidebar navigation entry — `access` lists the roles
 * permitted to see the link and `highlight` decides when the link should render
 * in the active state for a given pathname.
 *
 * Consumers: workspace sidebar renderer in `apps/web/core/components/workspace/**`.
 */
export interface IWorkspaceSidebarNavigationItem {
  key: string;
  labelTranslationKey: string;
  href: string;
  access: EUserWorkspaceRoles[];
  highlight: (pathname: string, url: string) => boolean;
}

/**
 * Workspace sidebar entries that surface only when the workspace has the
 * corresponding feature enabled or workspace-level data ("dynamic" in the sense
 * of feature-gated): views (all roles), analytics + archives (admin + member only).
 *
 * Consumers: workspace sidebar in `apps/web/core/components/workspace/**`.
 */
export const WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS: Record<string, IWorkspaceSidebarNavigationItem> = {
  views: {
    key: "views",
    labelTranslationKey: "views",
    href: `/workspace-views/all-issues/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  analytics: {
    key: "analytics",
    labelTranslationKey: "analytics",
    href: `/analytics/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  archives: {
    key: "archives",
    labelTranslationKey: "archives",
    href: `/projects/archives/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
};

/**
 * Array projection of `WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS` preserving the
 * desired sidebar render order (views, analytics, archives).
 *
 * Consumers: sidebar render loop in `apps/web/core/components/workspace/**`.
 */
export const WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS_LINKS: IWorkspaceSidebarNavigationItem[] = [
  WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS["views"],
  WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS["analytics"],
  WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS["archives"],
];

/**
 * Always-present workspace sidebar entries (home, inbox, your-work, stickies, drafts, projects); `your-work` and `drafts` are hidden from guests.
 * Consumers: workspace sidebar in `apps/web/core/components/workspace/**`.
 */
export const WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS: Record<string, IWorkspaceSidebarNavigationItem> = {
  home: {
    key: "home",
    labelTranslationKey: "home.title",
    href: `/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
    highlight: (pathname: string, url: string) => pathname === url,
  },
  inbox: {
    key: "inbox",
    labelTranslationKey: "notification.label",
    href: `/notifications/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  "your-work": {
    key: "your_work",
    labelTranslationKey: "your_work",
    href: `/profile/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  stickies: {
    key: "stickies",
    labelTranslationKey: "sidebar.stickies",
    href: `/stickies/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  drafts: {
    key: "drafts",
    labelTranslationKey: "drafts",
    href: `/drafts/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER],
    highlight: (pathname: string, url: string) => pathname.includes(url),
  },
  projects: {
    key: "projects",
    labelTranslationKey: "projects",
    href: `/projects/`,
    access: [EUserWorkspaceRoles.ADMIN, EUserWorkspaceRoles.MEMBER, EUserWorkspaceRoles.GUEST],
    highlight: (pathname: string, url: string) => pathname === url,
  },
};

/**
 * Array of static sidebar entries that appear in the main (non-pinned) sidebar
 * section — currently the home link only.
 *
 * Consumers: workspace sidebar in `apps/web/core/components/workspace/**`.
 */
export const WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS_LINKS: IWorkspaceSidebarNavigationItem[] = [
  WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["home"],
];

/**
 * Array of static sidebar entries that appear in the pinned sidebar section
 * (rendered above user-pinned projects/favorites) — currently the projects link.
 *
 * Consumers: workspace sidebar in `apps/web/core/components/workspace/**`.
 */
export const WORKSPACE_SIDEBAR_STATIC_PINNED_NAVIGATION_ITEMS_LINKS: IWorkspaceSidebarNavigationItem[] = [
  WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["projects"],
];

/**
 * localStorage key persisting whether the sidebar's favorites menu is expanded
 * across reloads.
 *
 * Consumers: sidebar favorites toggle in `apps/web/core/components/workspace/**`.
 */
export const IS_FAVORITE_MENU_OPEN = "is_favorite_menu_open";
/**
 * Empty-shape default for the workspace global search result — used as the
 * initial value in search hooks/stores so consumers can rely on every resource
 * key (workspace, project, issue, cycle, module, issue_view, page) being present.
 *
 * Consumers: global command palette / search in `apps/web/ce/components/command-palette/**`.
 */
export const WORKSPACE_DEFAULT_SEARCH_RESULT: IWorkspaceSearchResults = {
  results: {
    workspace: [],
    project: [],
    issue: [],
    cycle: [],
    module: [],
    issue_view: [],
    page: [],
  },
};

/**
 * Onboarding use-case option strings — capture the workspace's intended
 * application for product analytics.
 *
 * Consumers: onboarding flow in `apps/web/core/components/onboarding/**`.
 */
export const USE_CASES = [
  "Plan and track product roadmaps",
  "Manage engineering sprints",
  "Coordinate cross-functional projects",
  "Replace our current tool",
  "Just exploring",
];
