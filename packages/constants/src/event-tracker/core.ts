/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Registry of analytics tracking identifier strings — `*_TRACKER_ELEMENTS` are
 * attached as `data-ph-element` attributes (verified in `apps/web/core/components/**`)
 * and `*_TRACKER_EVENTS` are event-name string registries whose values match the
 * backend constants in `apps/api/plane/utils/analytics_events.py` (emitted by the
 * `track_event` Celery task in `apps/api/plane/bgtasks/event_tracking_task.py` via
 * Celery on RabbitMQ to PostHog server-side).
 *
 * Stability contract: every string value is part of the public analytics schema and
 * renames break PostHog dashboards/funnels that reference the prior label.
 *
 * // INTENT UNCLEAR: no client-side import of `*_TRACKER_EVENTS` was found in
 * tracked source, so the front-end emission path (capture call site) cannot be
 * confirmed; only `data-ph-element` (autocapture) usage is verified.
 */

import type { EProductSubscriptionEnum } from "@plane/types";

/**
 * Shared/standalone tracker identifiers that don't belong to a single feature group.
 */

/**
 * Workspace-level analytics group key (PostHog group-analytics feature).
 * // INTENT UNCLEAR: no client-side `posthog.group()` call site found in tracked source.
 */
export const GROUP_WORKSPACE_TRACKER_EVENT = "workspace_metrics";
/**
 * Event-name string registered for GitHub-redirect interactions.
 * // INTENT UNCLEAR: no client-side capture call site found.
 */
export const GITHUB_REDIRECTED_TRACKER_EVENT = "github_redirected";
/**
 * `data-ph-element` identifier for the application header GitHub icon — labels
 * PostHog autocapture clicks with a stable semantic name.
 */
export const HEADER_GITHUB_ICON = "header_github_icon";

/**
 * `data-ph-element` identifiers for the global ⌘K / Ctrl-K command palette.
 * Consumer: `apps/web/ce/components/command-palette/**`.
 */
export const COMMAND_PALETTE_TRACKER_ELEMENTS = {
  COMMAND_PALETTE_SHORTCUT_KEY: "command_palette_shortcut_key",
};

/**
 * Workspace CRUD instrumentation — `_EVENTS` carry string-name registry values that
 * match backend `WORKSPACE_CREATED`/`WORKSPACE_DELETED` constants; `_ELEMENTS` are
 * attached as `data-ph-element` on onboarding/header/update/delete buttons.
 * Consumers: `apps/web/core/components/{workspace,onboarding}/**`.
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
 * Project CRUD and feature-toggle instrumentation — `_EVENTS` carry string-name
 * values; `_ELEMENTS` are attached as `data-ph-element` on every project-creation
 * entry point (extended sidebar, sidebar, command palette, empty state, header,
 * first-project onboarding, Jira import) and the feature-toggle control.
 * Consumers: `apps/web/core/components/{project,workspace/sidebar}/**`.
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
 * Cycle CRUD plus favorite/archive lifecycle instrumentation — `_EVENTS` carry
 * string-name values; `_ELEMENTS` (`as const` for literal-narrowable union types)
 * are attached as `data-ph-element` on cycle list/detail surfaces.
 * Consumers: `apps/web/core/components/cycles/**`.
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
 * Module CRUD, favorite/archive toggles, and nested module-link CRUD instrumentation
 * — `_EVENTS` carry string-name values; `_ELEMENTS` are attached as `data-ph-element`
 * on module list/detail surfaces.
 * Consumers: `apps/web/core/components/modules/**`.
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
 * Work-item (issue) lifecycle instrumentation — the largest group because work
 * items are reachable from every layout root (WORK_ITEMS/PROJECT_VIEW/CYCLE/MODULE/
 * GLOBAL_VIEW/ARCHIVED/DRAFT), so `_ELEMENTS` are nested one level deeper to carry
 * the originating surface in funnel analytics.
 * Consumers: `apps/web/core/components/issues/**`.
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
 * Workflow-state CRUD instrumentation for per-project state values (Backlog/In
 * Progress/Done) — `_EVENTS` carry string-name values; `_ELEMENTS` are attached as
 * `data-ph-element` on state settings add/edit/delete controls.
 * Consumers: `apps/web/core/components/project-states/**`.
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
 * Project-page (Hocuspocus-collaborative wiki/doc) lifecycle instrumentation —
 * create/update/delete plus archive/lock/access/favorite/duplicate/move; `_ELEMENTS`
 * are attached as `data-ph-element` on the corresponding page list/detail controls.
 * Consumers: `apps/web/core/components/pages/**`.
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
 * Member invite/accept and project/workspace leave instrumentation — nested by
 * scope (`project.*` vs `workspace.*`) for distinguishable PostHog reports;
 * `_ELEMENTS` are attached as `data-ph-element` on add/accept/leave controls.
 * Consumers: `apps/web/core/components/{workspace,project}/settings/**`,
 * `apps/web/core/components/onboarding/**`.
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
 * Authentication funnel instrumentation (code_verify, sign_up/in_with_password,
 * forgot_password, new_code_requested, password_created) — renames break PostHog
 * conversion funnels; `_ELEMENTS` are attached as `data-ph-element` on auth-screen
 * navigation and the set-password form.
 * Consumers: `apps/web/core/components/account/**`.
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
 * Workspace-level (cross-project) global view CRUD plus `open` event for
 * heavily-used filter combinations; `_ELEMENTS` are attached as `data-ph-element`
 * on global-view list/header controls.
 * Consumers: `apps/web/core/components/issues/issue-layouts/roots/all-issue-layout-root.tsx`.
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
 * Per-project view CRUD instrumentation — the three save-as-view element
 * identifiers (project/cycle/module header) carry the originating layout root so
 * analytics can distinguish save-as-view origins.
 * Consumers: `apps/web/core/components/views/**`,
 * `apps/web/core/components/issues/issue-layouts/roots/**`.
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
 * In-app product tour funnel instrumentation — `complete` is the terminal event;
 * `_ELEMENTS` are attached as `data-ph-element` on tour start/skip/create-project controls.
 * Consumers: `apps/web/core/components/onboarding/**`.
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
 * Notification archive/unarchive and read-state instrumentation including the bulk
 * `all_marked_read` event; `_ELEMENTS` are attached as `data-ph-element` on the
 * inbox bulk-read/archive/read-toggle controls.
 * Consumers: `apps/web/core/components/workspace-notifications/**`.
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
 * User-profile lifecycle (add_details, onboarding_complete) and changelog
 * modal/redirect instrumentation; `_ELEMENTS` are attached as `data-ph-element` on
 * the changelog modal and redirect link.
 * Consumers: `apps/web/core/components/onboarding/**` and the changelog modal.
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
 * Element-only group — onboarding semantic events are tracked via the auth
 * (password), workspace (creation), and member (invite/accept) groups; this map
 * provides `data-ph-element` identifiers for onboarding-specific UI controls only.
 * Consumers: `apps/web/core/components/onboarding/**`.
 */
export const ONBOARDING_TRACKER_ELEMENTS = {
  PROFILE_SETUP_FORM: "onboarding_profile_setup_form",
  PASSWORD_CREATION_SELECTED: "onboarding_password_creation_selected",
  PASSWORD_CREATION_SKIPPED: "onboarding_password_creation_skipped",
};

/**
 * Element-only group — sidebar interactions are pure autocapture click-tracking
 * with no semantic event names; provides `data-ph-element` identifiers for
 * sidenav user menu and the sidebar create-work-item button.
 * Consumers: `apps/web/core/components/workspace/sidebar/**`.
 */
export const SIDEBAR_TRACKER_ELEMENTS = {
  USER_MENU_ITEM: "sidenav_user_menu_item",
  CREATE_WORK_ITEM_BUTTON: "sidebar_create_work_item_button",
};

/**
 * Project settings instrumentation across labels/estimates/automations sub-areas;
 * `_ELEMENTS` are attached as `data-ph-element` on the corresponding settings
 * controls (label CRUD, estimate toggle/CRUD, automation toggles).
 * Consumers: `apps/web/core/components/{labels,estimates,automation}/**`.
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
 * Profile settings instrumentation across Account/Preferences/Notifications/PAT
 * sub-areas; `_ELEMENTS` mirror the four sub-areas one-to-one and are attached
 * as `data-ph-element` on the corresponding controls.
 * Consumers: `apps/web/core/components/{profile,user}/**`.
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
 * Workspace settings instrumentation across Billing/Exports/Webhooks sub-areas;
 * `_ELEMENTS.BILLING_UPGRADE_BUTTON` is the only function value (see its JSDoc
 * for subscription-aware identifier generation).
 * Consumers: `apps/web/core/components/{billing,exporter,web-hooks}/**`.
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
   * Generates the subscription-aware `data-ph-element` value for the in-app Upgrade CTA so
   * autocapture can segment upgrade clicks by the user's source `EProductSubscriptionEnum` tier.
   *
   * @param subscriptionType - The user's current product subscription tier.
   * @returns Tracker identifier of the form `billing_upgrade_${subscriptionType}_button`.
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
