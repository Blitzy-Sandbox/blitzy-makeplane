/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Authoritative registry of analytics tracking identifiers consumed by the
 * PostHog client in the web frontend.
 *
 * Two complementary export families partition the surface:
 *   - `*_TRACKER_ELEMENTS` — string identifiers attached to interactive React
 *     elements as `data-ph-element` attributes so PostHog autocapture labels
 *     click/interaction events with a semantic name instead of a CSS selector.
 *   - `*_TRACKER_EVENTS` — event name strings passed to PostHog's `capture()`
 *     API for explicitly-fired analytics events.
 *
 * Consumers: web components and route segments under
 * `apps/web/core/components/**` and `apps/web/app/**`. The backend Celery task
 * `apps/api/plane/bgtasks/event_tracking_task.py` (queued via Celery on
 * RabbitMQ — Redis is caching/session only in this codebase) relays
 * complementary server-side events to the same PostHog project.
 *
 * Stability contract: every string literal value defined in this module is a
 * public analytics schema element. Renaming a value is a breaking change for
 * any PostHog dashboard, funnel, cohort, or insight that references the prior
 * label and MUST be coordinated with the analytics team.
 */

import type { EProductSubscriptionEnum } from "@plane/types";

/**
 * ===========================================================================
 * Event Groups
 * ===========================================================================
 *
 * Shared/standalone tracker identifiers that don't belong to a single feature
 * group. Documented per-export because the three constants below are not
 * tightly coupled to one another.
 */

/**
 * PostHog "group" identifier used to scope workspace-level analytics
 * aggregations via PostHog's group-analytics feature; passed to
 * `posthog.group()` when associating events with a workspace entity.
 *
 * Consumer: web frontend analytics initialization.
 */
export const GROUP_WORKSPACE_TRACKER_EVENT = "workspace_metrics";
/**
 * Event name captured when the user is redirected to GitHub (e.g., from a
 * star-on-GitHub call-to-action). Fired via PostHog `capture()`.
 *
 * Consumer: web frontend GitHub outbound surfaces.
 */
export const GITHUB_REDIRECTED_TRACKER_EVENT = "github_redirected";
/**
 * UI element identifier attached as `data-ph-element` to the GitHub icon
 * rendered in the application header so PostHog autocapture labels clicks
 * on that icon with a stable semantic name.
 *
 * Consumer: web frontend header GitHub icon.
 */
export const HEADER_GITHUB_ICON = "header_github_icon";

/**
 * ===========================================================================
 * Command palette tracker
 * ===========================================================================
 *
 * Instruments the global ⌘K / Ctrl-K command palette. Tracking how often the
 * shortcut key is used to open the palette is a common power-user funnel
 * signal.
 *
 * Consumer: `apps/web/core/components/command-palette/**` and the global
 * keyboard-shortcut surface.
 *   - `COMMAND_PALETTE_TRACKER_ELEMENTS` — attached as `data-ph-element` to
 *     the keyboard-shortcut handler that opens the palette.
 */
export const COMMAND_PALETTE_TRACKER_ELEMENTS = {
  COMMAND_PALETTE_SHORTCUT_KEY: "command_palette_shortcut_key",
};

/**
 * ===========================================================================
 * Workspace Events and Elements
 * ===========================================================================
 *
 * Instruments workspace CRUD: the create / update / delete lifecycle plus the
 * buttons that initiate those actions across onboarding and workspace
 * settings flows.
 *
 * Consumers: `apps/web/core/components/workspace/**`,
 * `apps/web/core/components/onboarding/**` and the workspace settings route
 * segments under `apps/web/app/**`.
 *   - `WORKSPACE_TRACKER_EVENTS` — fired via PostHog `capture()` when a
 *     workspace is created, updated, or deleted.
 *   - `WORKSPACE_TRACKER_ELEMENTS` — attached as `data-ph-element` to
 *     onboarding create-workspace, header create-workspace, update, and
 *     delete buttons.
 */
export const WORKSPACE_TRACKER_EVENTS = {
  create: "workspace_created",
  update: "workspace_updated",
  delete: "workspace_deleted",
};

export const WORKSPACE_TRACKER_ELEMENTS = {
  DELETE_WORKSPACE_BUTTON: "delete_workspace_button",
  ONBOARDING_CREATE_WORKSPACE_BUTTON: "onboarding_create_workspace_button",
  CREATE_WORKSPACE_BUTTON: "create_workspace_button",
  UPDATE_WORKSPACE_BUTTON: "update_workspace_button",
};

/**
 * ===========================================================================
 * Project Events and Elements
 * ===========================================================================
 *
 * Instruments project CRUD plus the per-project feature-toggle interaction.
 * Elements cover every project-creation entry point (extended sidebar,
 * sidebar, command palette, empty state, header, first-project onboarding,
 * Jira import) plus the toggle UI for project-level feature flags.
 *
 * Consumers: `apps/web/core/components/project/**`,
 * `apps/web/core/components/workspace/sidebar/**`, the command palette, and
 * the project settings route segments under `apps/web/app/**`.
 *   - `PROJECT_TRACKER_EVENTS` — fired via PostHog `capture()` for project
 *     create/update/delete and individual feature-toggle changes.
 *   - `PROJECT_TRACKER_ELEMENTS` — attached as `data-ph-element` to the
 *     creation buttons listed above and the feature-toggle control.
 */
export const PROJECT_TRACKER_EVENTS = {
  create: "project_created",
  update: "project_updated",
  delete: "project_deleted",
  feature_toggled: "feature_toggled",
};

export const PROJECT_TRACKER_ELEMENTS = {
  EXTENDED_SIDEBAR_ADD_BUTTON: "extended_sidebar_add_project_button",
  SIDEBAR_CREATE_PROJECT_BUTTON: "sidebar_create_project_button",
  SIDEBAR_CREATE_PROJECT_TOOLTIP: "sidebar_create_project_tooltip",
  COMMAND_PALETTE_CREATE_BUTTON: "command_palette_create_project_button",
  COMMAND_PALETTE_SHORTCUT_CREATE_BUTTON: "command_palette_shortcut_create_project_button",
  EMPTY_STATE_CREATE_PROJECT_BUTTON: "empty_state_create_project_button",
  CREATE_HEADER_BUTTON: "create_project_header_button",
  CREATE_FIRST_PROJECT_BUTTON: "create_first_project_button",
  DELETE_PROJECT_BUTTON: "delete_project_button",
  UPDATE_PROJECT_BUTTON: "update_project_button",
  CREATE_PROJECT_JIRA_IMPORT_DETAIL_PAGE: "create_project_jira_import_detail_page",
  TOGGLE_FEATURE: "toggle_project_feature",
};

/**
 * ===========================================================================
 * Cycle Events and Elements
 * ===========================================================================
 *
 * Instruments cycle CRUD plus favorite/unfavorite and archive/restore
 * lifecycle events. The `as const` assertion on `CYCLE_TRACKER_ELEMENTS`
 * keeps the union of element identifier string literals narrowable at the
 * type level for downstream consumers.
 *
 * Consumers: `apps/web/core/components/cycles/**` (list, active cycle,
 * analytics sidebar, dropdowns) and cycle route segments under
 * `apps/web/app/**`.
 *   - `CYCLE_TRACKER_EVENTS` — fired via PostHog `capture()` for cycle
 *     create/update/delete and favorite/archive toggles.
 *   - `CYCLE_TRACKER_ELEMENTS` — attached as `data-ph-element` to the right
 *     header add button, empty state add button, command palette add item,
 *     right sidebar, quick actions, context menu, and list item.
 */
export const CYCLE_TRACKER_EVENTS = {
  create: "cycle_created",
  update: "cycle_updated",
  delete: "cycle_deleted",
  favorite: "cycle_favorited",
  unfavorite: "cycle_unfavorited",
  archive: "cycle_archived",
  restore: "cycle_restored",
};

export const CYCLE_TRACKER_ELEMENTS = {
  RIGHT_HEADER_ADD_BUTTON: "right_header_add_cycle_button",
  EMPTY_STATE_ADD_BUTTON: "empty_state_add_cycle_button",
  COMMAND_PALETTE_ADD_ITEM: "command_palette_add_cycle_item",
  RIGHT_SIDEBAR: "cycle_right_sidebar",
  QUICK_ACTIONS: "cycle_quick_actions",
  CONTEXT_MENU: "cycle_context_menu",
  LIST_ITEM: "cycle_list_item",
} as const;

/**
 * ===========================================================================
 * Module Events and Elements
 * ===========================================================================
 *
 * Instruments module CRUD plus favorite/unfavorite/archive/restore and a
 * nested `link` sub-object that tracks create/update/delete of module link
 * attachments separately from the parent module's lifecycle.
 *
 * Consumers: `apps/web/core/components/modules/**` and module route segments
 * under `apps/web/app/**`.
 *   - `MODULE_TRACKER_EVENTS` — fired via PostHog `capture()` for module
 *     CRUD, favorite/archive toggles, and module-link CRUD.
 *   - `MODULE_TRACKER_ELEMENTS` — attached as `data-ph-element` to the right
 *     header add button, empty state add button, command palette add item,
 *     right sidebar, quick actions, context menu, list item, and card item.
 */
export const MODULE_TRACKER_EVENTS = {
  create: "module_created",
  update: "module_updated",
  delete: "module_deleted",
  favorite: "module_favorited",
  unfavorite: "module_unfavorited",
  archive: "module_archived",
  restore: "module_restored",
  link: {
    create: "module_link_created",
    update: "module_link_updated",
    delete: "module_link_deleted",
  },
};

export const MODULE_TRACKER_ELEMENTS = {
  RIGHT_HEADER_ADD_BUTTON: "right_header_add_module_button",
  EMPTY_STATE_ADD_BUTTON: "empty_state_add_module_button",
  COMMAND_PALETTE_ADD_ITEM: "command_palette_add_module_item",
  RIGHT_SIDEBAR: "module_right_sidebar",
  QUICK_ACTIONS: "module_quick_actions",
  CONTEXT_MENU: "module_context_menu",
  LIST_ITEM: "module_list_item",
  CARD_ITEM: "module_card_item",
} as const;

/**
 * ===========================================================================
 * Work Item Events and Elements
 * ===========================================================================
 *
 * Instruments the work-item (issue) lifecycle — the primary product surface
 * and therefore the largest group in this file because work items are
 * reachable from every layout root (project, project-view, cycle, module,
 * global view, archived, draft). The element identifiers are deeply nested
 * one level deeper than other groups so a single click site can carry the
 * surface it originated from, which is essential for funnel analytics that
 * compare creation rates across layout roots.
 *
 * Consumers: `apps/web/core/components/issues/**` (issue-layouts,
 * issue-detail, issue-modal, bulk-operations, peek-overview) and the issue
 * route segments under `apps/web/app/**`.
 *   - `WORK_ITEM_TRACKER_EVENTS` — fired via PostHog `capture()` for issue
 *     create/add_existing/update/delete/archive/restore, attachment
 *     add/remove, sub-issue CRUD/remove/add_existing, and draft issue
 *     create.
 *   - `WORK_ITEM_TRACKER_ELEMENTS` — attached as `data-ph-element` to header
 *     add buttons, command palette add button, empty state add buttons,
 *     quick actions, and context menus across every layout-root surface
 *     (WORK_ITEMS / PROJECT_VIEW / CYCLE / MODULE / GLOBAL_VIEW / ARCHIVED
 *     / DRAFT).
 */
export const WORK_ITEM_TRACKER_EVENTS = {
  create: "work_item_created",
  add_existing: "work_item_add_existing",
  update: "work_item_updated",
  delete: "work_item_deleted",
  archive: "work_item_archived",
  restore: "work_item_restored",
  attachment: {
    add: "work_item_attachment_added",
    remove: "work_item_attachment_removed",
  },
  sub_issue: {
    update: "sub_issue_updated",
    remove: "sub_issue_removed",
    delete: "sub_issue_deleted",
    create: "sub_issue_created",
    add_existing: "sub_issue_add_existing",
  },
  draft: {
    create: "draft_work_item_created",
  },
};
export const WORK_ITEM_TRACKER_ELEMENTS = {
  HEADER_ADD_BUTTON: {
    WORK_ITEMS: "work_items_header_add_work_item_button",
    PROJECT_VIEW: "project_view_header_add_work_item_button",
    CYCLE: "cycle_header_add_work_item_button",
    MODULE: "module_header_add_work_item_button",
  },
  COMMAND_PALETTE_ADD_BUTTON: "command_palette_add_work_item_button",
  EMPTY_STATE_ADD_BUTTON: {
    WORK_ITEMS: "work_items_empty_state_add_work_item_button",
    PROJECT_VIEW: "project_view_empty_state_add_work_item_button",
    CYCLE: "cycle_empty_state_add_work_item_button",
    MODULE: "module_empty_state_add_work_item_button",
    GLOBAL_VIEW: "global_view_empty_state_add_work_item_button",
  },
  QUICK_ACTIONS: {
    WORK_ITEMS: "work_items_quick_actions",
    PROJECT_VIEW: "project_view_work_items_quick_actions",
    CYCLE: "cycle_work_items_quick_actions",
    MODULE: "module_work_items_quick_actions",
    GLOBAL_VIEW: "global_view_work_items_quick_actions",
    ARCHIVED: "archived_work_items_quick_actions",
    DRAFT: "draft_work_items_quick_actions",
  },
  CONTEXT_MENU: {
    WORK_ITEMS: "work_items_context_menu",
    PROJECT_VIEW: "project_view_context_menu",
    CYCLE: "cycle_context_menu",
    MODULE: "module_context_menu",
    GLOBAL_VIEW: "global_view_context_menu",
    ARCHIVED: "archived_context_menu",
    DRAFT: "draft_context_menu",
  },
} as const;

/**
 * ===========================================================================
 * State Events and Elements
 * ===========================================================================
 *
 * Instruments workflow-state CRUD — the per-project state values like
 * "Backlog", "In Progress", "Done" that drive the kanban columns and the
 * state dropdown on work items.
 *
 * Consumers: `apps/web/core/components/project-states/**` and the state
 * settings route segments under `apps/web/app/**`.
 *   - `STATE_TRACKER_EVENTS` — fired via PostHog `capture()` when a state is
 *     created, updated, or deleted.
 *   - `STATE_TRACKER_ELEMENTS` — attached as `data-ph-element` to the
 *     state-group add button (within state settings), state list delete
 *     button, and state list edit button.
 */
export const STATE_TRACKER_EVENTS = {
  create: "state_created",
  update: "state_updated",
  delete: "state_deleted",
};
export const STATE_TRACKER_ELEMENTS = {
  STATE_GROUP_ADD_BUTTON: "state_group_add_button",
  STATE_LIST_DELETE_BUTTON: "state_list_delete_button",
  STATE_LIST_EDIT_BUTTON: "state_list_edit_button",
};

/**
 * ===========================================================================
 * Project Page Events and Elements
 * ===========================================================================
 *
 * Instruments the project-page lifecycle — the wiki/doc-style pages that
 * live inside a project and are edited collaboratively via the apps/live
 * Hocuspocus server. Covers create/update/delete plus state transitions
 * (archive/restore, lock/unlock, public/private access toggle) and
 * relationships (favorite/unfavorite, duplicate, move).
 *
 * Consumers: `apps/web/core/components/pages/**` and the project-page route
 * segments under `apps/web/app/**`.
 *   - `PROJECT_PAGE_TRACKER_EVENTS` — fired via PostHog `capture()` for
 *     every page lifecycle and metadata-mutation event listed above.
 *   - `PROJECT_PAGE_TRACKER_ELEMENTS` — attached as `data-ph-element` to the
 *     command palette create buttons (button + keyboard shortcut variant),
 *     empty state create button, context menu, quick actions, list item,
 *     favorite/archive/lock buttons, public/private access toggle, and
 *     duplicate button.
 */
export const PROJECT_PAGE_TRACKER_EVENTS = {
  create: "project_page_created",
  update: "project_page_updated",
  delete: "project_page_deleted",
  archive: "project_page_archived",
  restore: "project_page_restored",
  lock: "project_page_locked",
  unlock: "project_page_unlocked",
  access_update: "project_page_access_updated",
  duplicate: "project_page_duplicated",
  favorite: "project_page_favorited",
  unfavorite: "project_page_unfavorited",
  move: "project_page_moved",
};
export const PROJECT_PAGE_TRACKER_ELEMENTS = {
  COMMAND_PALETTE_SHORTCUT_CREATE_BUTTON: "command_palette_shortcut_create_page_button",
  EMPTY_STATE_CREATE_BUTTON: "empty_state_create_page_button",
  COMMAND_PALETTE_CREATE_BUTTON: "command_palette_create_page_button",
  CONTEXT_MENU: "page_context_menu",
  QUICK_ACTIONS: "page_quick_actions",
  LIST_ITEM: "page_list_item",
  FAVORITE_BUTTON: "page_favorite_button",
  ARCHIVE_BUTTON: "page_archive_button",
  LOCK_BUTTON: "page_lock_button",
  ACCESS_TOGGLE: "page_access_toggle",
  DUPLICATE_BUTTON: "page_duplicate_button",
} as const;

/**
 * ===========================================================================
 * Member Events and Elements
 * ===========================================================================
 *
 * Instruments member invitation/acceptance and project/workspace leave
 * events. The nested structure (`project.add` / `project.leave` /
 * `workspace.leave`) keeps project-scoped vs. workspace-scoped membership
 * mutations distinguishable in PostHog reports.
 *
 * Consumers: `apps/web/core/components/workspace/settings/**`,
 * `apps/web/core/components/project/settings/**`, onboarding flows under
 * `apps/web/core/components/onboarding/**`, and member-management route
 * segments under `apps/web/app/**`.
 *   - `MEMBER_TRACKER_EVENTS` — fired via PostHog `capture()` for invitation
 *     send/accept and project/workspace member leave.
 *   - `MEMBER_TRACKER_ELEMENTS` — attached as `data-ph-element` to the
 *     header add-member button, accept-invitation button, onboarding
 *     join-workspace and invite-member continue buttons, sidebar project
 *     quick actions, and project/workspace member table context menus.
 */
export const MEMBER_TRACKER_EVENTS = {
  invite: "member_invited",
  accept: "member_accepted",
  project: {
    add: "project_member_added",
    leave: "project_member_left",
  },
  workspace: {
    leave: "workspace_member_left",
  },
};
export const MEMBER_TRACKER_ELEMENTS = {
  HEADER_ADD_BUTTON: "header_add_member_button",
  ACCEPT_INVITATION_BUTTON: "accept_invitation_button",
  ONBOARDING_JOIN_WORKSPACE: "workspace_join_continue_to_workspace_button",
  ONBOARDING_INVITE_MEMBER: "invite_member_continue_button",
  SIDEBAR_PROJECT_QUICK_ACTIONS: "sidebar_project_quick_actions",
  PROJECT_MEMBER_TABLE_CONTEXT_MENU: "project_member_table_context_menu",
  WORKSPACE_MEMBER_TABLE_CONTEXT_MENU: "workspace_member_table_context_menu",
  WORKSPACE_INVITATIONS_LIST_CONTEXT_MENU: "workspace_invitations_list_context_menu",
} as const;

/**
 * ===========================================================================
 * Auth Events and Elements
 * ===========================================================================
 *
 * Instruments the authentication funnel: code_verify, sign_up_with_password,
 * sign_in_with_password, forgot_password click, new_code_requested, and
 * password_created. These identifiers are critical for the conversion-funnel
 * dashboards in PostHog, so any rename would silently break those funnels.
 *
 * Consumers: `apps/web/core/components/account/**` (auth forms) and the
 * authentication route segments under `apps/web/app/**`.
 *   - `AUTH_TRACKER_EVENTS` — fired via PostHog `capture()` on each step of
 *     the sign-up / sign-in / forgot-password / code-verify flow.
 *   - `AUTH_TRACKER_ELEMENTS` — attached as `data-ph-element` to navigation
 *     between sign-in/sign-up/forgot-password screens, unique-code sign-in,
 *     new-code request, code verify, and the set-password form.
 */
export const AUTH_TRACKER_EVENTS = {
  code_verify: "code_verified",
  sign_up_with_password: "sign_up_with_password",
  sign_in_with_password: "sign_in_with_password",
  forgot_password: "forgot_password_clicked",
  new_code_requested: "new_code_requested",
  password_created: "password_created",
};

export const AUTH_TRACKER_ELEMENTS = {
  NAVIGATE_TO_SIGN_UP: "navigate_to_sign_up",
  FORGOT_PASSWORD_FROM_SIGNIN: "forgot_password_from_signin",
  SIGNUP_FROM_FORGOT_PASSWORD: "signup_from_forgot_password",
  SIGN_IN_FROM_SIGNUP: "sign_in_from_signup",
  SIGN_IN_WITH_UNIQUE_CODE: "sign_in_with_unique_code",
  REQUEST_NEW_CODE: "request_new_code",
  VERIFY_CODE: "verify_code",
  SET_PASSWORD_FORM: "set_password_form",
};

/**
 * ===========================================================================
 * Global View Events and Elements
 * ===========================================================================
 *
 * Instruments cross-project (workspace-level) global view CRUD plus an
 * `open` event that captures which views are actually being selected and
 * loaded — important for prioritizing performance work on heavily-used
 * filter combinations.
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/roots/**`
 * (notably `all-issue-layout-root.tsx`) and the workspace-views route
 * segments under `apps/web/app/**`.
 *   - `GLOBAL_VIEW_TRACKER_EVENTS` — fired via PostHog `capture()` for
 *     global-view CRUD and on view open/selection.
 *   - `GLOBAL_VIEW_TRACKER_ELEMENTS` — attached as `data-ph-element` to the
 *     right header add button, header save-view button, quick actions, and
 *     list item.
 */
export const GLOBAL_VIEW_TRACKER_EVENTS = {
  create: "global_view_created",
  update: "global_view_updated",
  delete: "global_view_deleted",
  open: "global_view_opened",
};

export const GLOBAL_VIEW_TRACKER_ELEMENTS = {
  RIGHT_HEADER_ADD_BUTTON: "global_view_right_header_add_button",
  HEADER_SAVE_VIEW_BUTTON: "global_view_header_save_view_button",
  QUICK_ACTIONS: "global_view_quick_actions",
  LIST_ITEM: "global_view_list_item",
};

/**
 * ===========================================================================
 * Project View Events and Elements
 * ===========================================================================
 *
 * Instruments per-project view CRUD. Note the three "save-as-view" element
 * identifiers (project / cycle / module header) — these capture the current
 * filter state of the originating layout root as a new view, so the
 * surface-aware identifiers let analytics distinguish save-as-view origins.
 *
 * Consumers: `apps/web/core/components/views/**`,
 * `apps/web/core/components/issues/issue-layouts/roots/**` (project,
 * cycle, module layout roots that surface "save as view"), and the
 * project-view route segments under `apps/web/app/**`.
 *   - `PROJECT_VIEW_TRACKER_EVENTS` — fired via PostHog `capture()` for
 *     project-view create/update/delete.
 *   - `PROJECT_VIEW_TRACKER_ELEMENTS` — attached as `data-ph-element` to the
 *     right header add button, command palette add item, empty state create
 *     button, header save-view button, the three save-as-view buttons
 *     (project/cycle/module headers), quick actions, and list item context
 *     menu.
 */
export const PROJECT_VIEW_TRACKER_EVENTS = {
  create: "project_view_created",
  update: "project_view_updated",
  delete: "project_view_deleted",
};

export const PROJECT_VIEW_TRACKER_ELEMENTS = {
  RIGHT_HEADER_ADD_BUTTON: "project_view_right_header_add_button",
  COMMAND_PALETTE_ADD_ITEM: "command_palette_add_project_view_item",
  EMPTY_STATE_CREATE_BUTTON: "project_view_empty_state_create_button",
  HEADER_SAVE_VIEW_BUTTON: "project_view_header_save_view_button",
  PROJECT_HEADER_SAVE_AS_VIEW_BUTTON: "project_view_header_save_as_view_button",
  CYCLE_HEADER_SAVE_AS_VIEW_BUTTON: "cycle_header_save_as_view_button",
  MODULE_HEADER_SAVE_AS_VIEW_BUTTON: "module_header_save_as_view_button",
  QUICK_ACTIONS: "project_view_quick_actions",
  LIST_ITEM_CONTEXT_MENU: "project_view_list_item_context_menu",
};

/**
 * ===========================================================================
 * Product Tour Events and Elements
 * ===========================================================================
 *
 * Instruments the in-app product tour funnel. `complete` is the terminal
 * event in the funnel; the start/skip/create-project element identifiers
 * cover the three primary tour interaction points.
 *
 * Consumers: `apps/web/core/components/onboarding/**` and the tour overlay
 * surfaces in `apps/web/core/components/**`.
 *   - `PRODUCT_TOUR_TRACKER_EVENTS.complete` — fired via PostHog `capture()`
 *     when the tour finishes.
 *   - `PRODUCT_TOUR_TRACKER_ELEMENTS` — attached as `data-ph-element` to the
 *     tour start button, skip button, and the create-project button shown
 *     inside the tour.
 */
export const PRODUCT_TOUR_TRACKER_EVENTS = {
  complete: "product_tour_completed",
};

export const PRODUCT_TOUR_TRACKER_ELEMENTS = {
  START_BUTTON: "product_tour_start_button",
  SKIP_BUTTON: "product_tour_skip_button",
  CREATE_PROJECT_BUTTON: "product_tour_create_project_button",
};

/**
 * ===========================================================================
 * Notification Events and Elements
 * ===========================================================================
 *
 * Instruments notification archive/unarchive, mark_read/mark_unread, and the
 * bulk all_marked_read event.
 *
 * Consumers: `apps/web/core/components/workspace-notifications/**` and the
 * notification-inbox surfaces under `apps/web/app/**`.
 *   - `NOTIFICATION_TRACKER_EVENTS` — fired via PostHog `capture()` for each
 *     archive/read state mutation listed above.
 *   - `NOTIFICATION_TRACKER_ELEMENTS` — attached as `data-ph-element` to the
 *     mark-all-as-read button, archive/unarchive button, and mark-read/unread
 *     button.
 */
export const NOTIFICATION_TRACKER_EVENTS = {
  archive: "notification_archived",
  unarchive: "notification_unarchived",
  mark_read: "notification_marked_read",
  mark_unread: "notification_marked_unread",
  all_marked_read: "all_notifications_marked_read",
};

export const NOTIFICATION_TRACKER_ELEMENTS = {
  MARK_ALL_AS_READ_BUTTON: "mark_all_as_read_button",
  ARCHIVE_UNARCHIVE_BUTTON: "archive_unarchive_button",
  MARK_READ_UNREAD_BUTTON: "mark_read_unread_button",
};

/**
 * ===========================================================================
 * User Events
 * ===========================================================================
 *
 * Instruments user-profile lifecycle events (initial details added,
 * onboarding completed) plus the changelog modal/redirect element
 * identifiers that surface product release notes to existing users.
 *
 * Consumers: onboarding flows under `apps/web/core/components/onboarding/**`,
 * the changelog modal in `apps/web/core/components/**`, and the user-profile
 * route segments under `apps/web/app/**`.
 *   - `USER_TRACKER_EVENTS` — fired via PostHog `capture()` when the user
 *     completes profile details / onboarding.
 *   - `USER_TRACKER_ELEMENTS` — attached as `data-ph-element` to the product
 *     changelog modal and the changelog redirect link.
 */
export const USER_TRACKER_EVENTS = {
  add_details: "user_details_added",
  onboarding_complete: "user_onboarding_completed",
};

export const USER_TRACKER_ELEMENTS = {
  PRODUCT_CHANGELOG_MODAL: "product_changelog_modal",
  CHANGELOG_REDIRECTED: "changelog_redirected",
};

/**
 * ===========================================================================
 * Onboarding Events and Elements
 * ===========================================================================
 *
 * Element-only group. There is no paired `_EVENTS` map here because
 * onboarding semantic event names are tracked via other groups — the auth
 * group covers password creation, the workspace group covers workspace
 * creation, and the member group covers invite/accept. This map only
 * provides element identifiers for autocapture on the onboarding-specific
 * UI surfaces (profile setup form, password creation selected/skipped).
 *
 * Consumers: `apps/web/core/components/onboarding/**` and the onboarding
 * route segments under `apps/web/app/**`.
 *   - `ONBOARDING_TRACKER_ELEMENTS` — attached as `data-ph-element` to the
 *     profile setup form, password-creation-selected and
 *     password-creation-skipped controls.
 */
export const ONBOARDING_TRACKER_ELEMENTS = {
  PROFILE_SETUP_FORM: "onboarding_profile_setup_form",
  PASSWORD_CREATION_SELECTED: "onboarding_password_creation_selected",
  PASSWORD_CREATION_SKIPPED: "onboarding_password_creation_skipped",
};

/**
 * ===========================================================================
 * Sidebar Events
 * ===========================================================================
 *
 * Element-only group. There is no paired `_EVENTS` map because sidebar
 * interactions are pure click-tracking via PostHog autocapture — they don't
 * carry semantic event names beyond labelling which sidebar control was
 * clicked.
 *
 * Consumers: `apps/web/core/components/workspace/sidebar/**` and other
 * sidebar surfaces within `apps/web/core/components/**`.
 *   - `SIDEBAR_TRACKER_ELEMENTS` — attached as `data-ph-element` to the
 *     sidenav user menu item and the sidebar create-work-item button.
 */
export const SIDEBAR_TRACKER_ELEMENTS = {
  USER_MENU_ITEM: "sidenav_user_menu_item",
  CREATE_WORK_ITEM_BUTTON: "sidebar_create_work_item_button",
};

/**
 * ===========================================================================
 * Project Settings Events and Elements
 * ===========================================================================
 *
 * Instruments project-settings interactions across three sub-areas: labels
 * (created/updated/deleted), estimates (created/updated/deleted plus
 * toggled), and automations (auto_close_workitems, auto_archive_workitems).
 *
 * Consumers: `apps/web/core/components/labels/**`,
 * `apps/web/core/components/estimates/**`,
 * `apps/web/core/components/automation/**`, and the project-settings route
 * segments under `apps/web/app/**`.
 *   - `PROJECT_SETTINGS_TRACKER_EVENTS` — fired via PostHog `capture()` for
 *     each label/estimate/automation mutation listed above.
 *   - `PROJECT_SETTINGS_TRACKER_ELEMENTS` — attached as `data-ph-element` to
 *     labels (empty state create, header create, context menu, delete),
 *     estimates (toggle, empty state create, list item), and automations
 *     (archive toggle, close toggle).
 */
export const PROJECT_SETTINGS_TRACKER_ELEMENTS = {
  LABELS_EMPTY_STATE_CREATE_BUTTON: "labels_empty_state_create_button",
  LABELS_HEADER_CREATE_BUTTON: "labels_header_create_button",
  LABELS_CONTEXT_MENU: "labels_context_menu",
  LABELS_DELETE_BUTTON: "labels_delete_button",
  ESTIMATES_TOGGLE_BUTTON: "estimates_toggle_button",
  ESTIMATES_EMPTY_STATE_CREATE_BUTTON: "estimates_empty_state_create_button",
  ESTIMATES_LIST_ITEM: "estimates_list_item",
  AUTOMATIONS_ARCHIVE_TOGGLE_BUTTON: "automations_archive_toggle_button",
  AUTOMATIONS_CLOSE_TOGGLE_BUTTON: "automations_close_toggle_button",
};

export const PROJECT_SETTINGS_TRACKER_EVENTS = {
  // labels
  label_created: "label_created",
  label_updated: "label_updated",
  label_deleted: "label_deleted",
  // estimates
  estimate_created: "estimate_created",
  estimate_updated: "estimate_updated",
  estimate_deleted: "estimate_deleted",
  estimates_toggle: "estimates_toggled",
  // automations
  auto_close_workitems: "auto_close_workitems",
  auto_archive_workitems: "auto_archive_workitems",
};

/**
 * ===========================================================================
 * Profile Settings Events and Elements
 * ===========================================================================
 *
 * Instruments user-profile-settings interactions across four sub-areas:
 * Account (deactivate, update_profile), Preferences (first_day, language,
 * timezone, theme), Notifications (notifications_updated), and PAT
 * (pat_created, pat_deleted). The element identifiers mirror the same
 * four sub-areas one-to-one.
 *
 * Consumers: `apps/web/core/components/profile/**`,
 * `apps/web/core/components/user/**`, and the profile-settings route
 * segments under `apps/web/app/**`.
 *   - `PROFILE_SETTINGS_TRACKER_EVENTS` — fired via PostHog `capture()` for
 *     each profile-settings mutation listed above.
 *   - `PROFILE_SETTINGS_TRACKER_ELEMENTS` — attached as `data-ph-element` to
 *     save/deactivate buttons (Account), four preference dropdowns
 *     (Preferences), four notification toggles (Notifications), and the
 *     PAT header-add / empty-state add / list-item-delete controls (PAT).
 */
export const PROFILE_SETTINGS_TRACKER_EVENTS = {
  // Account
  deactivate_account: "deactivate_account",
  update_profile: "update_profile",
  // Preferences
  first_day_updated: "first_day_updated",
  language_updated: "language_updated",
  timezone_updated: "timezone_updated",
  theme_updated: "theme_updated",
  // Notifications
  notifications_updated: "notifications_updated",
  // PAT
  pat_created: "pat_created",
  pat_deleted: "pat_deleted",
};

export const PROFILE_SETTINGS_TRACKER_ELEMENTS = {
  // Account
  SAVE_CHANGES_BUTTON: "save_changes_button",
  DEACTIVATE_ACCOUNT_BUTTON: "deactivate_account_button",
  // Preferences
  THEME_DROPDOWN: "preferences_theme_dropdown",
  FIRST_DAY_OF_WEEK_DROPDOWN: "preferences_first_day_of_week_dropdown",
  LANGUAGE_DROPDOWN: "preferences_language_dropdown",
  TIMEZONE_DROPDOWN: "preferences_timezone_dropdown",
  // Notifications
  PROPERTY_CHANGES_TOGGLE: "notifications_property_changes_toggle",
  STATE_CHANGES_TOGGLE: "notifications_state_changes_toggle",
  COMMENTS_TOGGLE: "notifications_comments_toggle",
  MENTIONS_TOGGLE: "notifications_mentions_toggle",
  // PAT
  HEADER_ADD_PAT_BUTTON: "header_add_pat_button",
  EMPTY_STATE_ADD_PAT_BUTTON: "empty_state_add_pat_button",
  LIST_ITEM_DELETE_ICON: "list_item_delete_icon",
};

/**
 * ===========================================================================
 * Workspace Settings Events and Elements
 * ===========================================================================
 *
 * Instruments workspace-settings interactions across three sub-areas:
 * Billing (upgrade_plan_redirected), Exports (csv_exported), and Webhooks
 * (created / updated / deleted / toggled / details_page_toggled).
 *
 * `WORKSPACE_SETTINGS_TRACKER_ELEMENTS.BILLING_UPGRADE_BUTTON` is the only
 * function value in this file — see its inline JSDoc for the
 * subscription-aware identifier generation pattern.
 *
 * Consumers: `apps/web/core/components/billing/**`,
 * `apps/web/core/components/exporter/**`,
 * `apps/web/core/components/web-hooks/**`, and the workspace-settings route
 * segments under `apps/web/app/**`.
 *   - `WORKSPACE_SETTINGS_TRACKER_EVENTS` — fired via PostHog `capture()`
 *     for each billing/exports/webhooks mutation listed above.
 *   - `WORKSPACE_SETTINGS_TRACKER_ELEMENTS` — attached as `data-ph-element`
 *     to billing (upgrade button — subscription-aware function;
 *     talk-to-sales button), exports (export button), and webhooks (header
 *     add, empty state add, list item delete, list item toggle, details
 *     page toggle, delete, update).
 */
export const WORKSPACE_SETTINGS_TRACKER_EVENTS = {
  // Billing
  upgrade_plan_redirected: "upgrade_plan_redirected",
  // Exports
  csv_exported: "csv_exported",
  // Webhooks
  webhook_created: "webhook_created",
  webhook_deleted: "webhook_deleted",
  webhook_toggled: "webhook_toggled",
  webhook_details_page_toggled: "webhook_details_page_toggled",
  webhook_updated: "webhook_updated",
};

export const WORKSPACE_SETTINGS_TRACKER_ELEMENTS = {
  // Billing
  /**
   * Generates a subscription-aware tracker identifier of the form
   * `billing_upgrade_${subscriptionType}_button` from the user's current
   * `EProductSubscriptionEnum` tier (imported from `@plane/types`). Used as
   * the `data-ph-element` value on the in-app "Upgrade" CTA so PostHog
   * reports can segment upgrade-button click events by the user's source
   * subscription tier — essential for upgrade-funnel analytics per source
   * plan.
   *
   * @param subscriptionType - The user's current product subscription tier.
   * @returns A tracker identifier string of the form
   * `billing_upgrade_${subscriptionType}_button`.
   */
  BILLING_UPGRADE_BUTTON: (subscriptionType: EProductSubscriptionEnum) => `billing_upgrade_${subscriptionType}_button`,
  BILLING_TALK_TO_SALES_BUTTON: "billing_talk_to_sales_button",
  // Exports
  EXPORT_BUTTON: "export_button",
  // Webhooks
  HEADER_ADD_WEBHOOK_BUTTON: "header_add_webhook_button",
  EMPTY_STATE_ADD_WEBHOOK_BUTTON: "empty_state_add_webhook_button",
  LIST_ITEM_DELETE_BUTTON: "list_item_delete_button",
  WEBHOOK_LIST_ITEM_TOGGLE_SWITCH: "webhook_list_item_toggle_switch",
  WEBHOOK_DETAILS_PAGE_TOGGLE_SWITCH: "webhook_details_page_toggle_switch",
  WEBHOOK_DELETE_BUTTON: "webhook_delete_button",
  WEBHOOK_UPDATE_BUTTON: "webhook_update_button",
};
