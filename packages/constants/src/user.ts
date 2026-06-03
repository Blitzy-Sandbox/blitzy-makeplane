/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// INTENT UNCLEAR: EAuthenticationPageType has no consumer in tracked source — the
// closest auth flows live in apps/web/core/lib/wrappers/authentication-wrapper.tsx and
// apps/web/core/components/account/auth-forms/, but neither imports this enum directly.
/**
 * Authentication-gate type for a page route — drives the auth provider wrapper that
 * redirects users to/away from a route based on their authentication state.
 *
 * Values:
 * - STATIC: page is accessible regardless of auth state
 * - NOT_AUTHENTICATED: only accessible to unauthenticated users (e.g., sign-in page)
 * - AUTHENTICATED: only accessible to authenticated users (default for app pages)
 */
export enum EAuthenticationPageType {
  STATIC = "STATIC",
  NOT_AUTHENTICATED = "NOT_AUTHENTICATED",
  AUTHENTICATED = "AUTHENTICATED",
}

/**
 * Instance setup phase a page belongs to — gates self-hosted setup pages from the
 * post-setup app shell.
 *
 * Consumers: `apps/admin/**` instance setup flow.
 */
export enum EInstancePageType {
  PRE_SETUP = "PRE_SETUP",
  POST_SETUP = "POST_SETUP",
}

/**
 * User-level boot status flag — drives splash/error UI before the main app shell
 * mounts in `apps/web` / `apps/admin`.
 *
 * Values:
 * - ERROR: user fetch failed; show error screen
 * - AUTHENTICATION_NOT_DONE: auth handshake still in flight
 * - NOT_YET_READY: user authenticated but downstream bootstrap (workspace, profile) still loading
 */
export enum EUserStatus {
  ERROR = "ERROR",
  AUTHENTICATION_NOT_DONE = "AUTHENTICATION_NOT_DONE",
  NOT_YET_READY = "NOT_YET_READY",
}

/**
 * Payload returned by the user-status check — `status` is `undefined` while the
 * check is in flight; `message` carries an optional human-readable explanation
 * surfaced on the splash/error screen.
 */
export type TUserStatus = {
  status: EUserStatus | undefined;
  message?: string;
};

/**
 * Permission-scope discriminator — selects which permission table (workspace-level
 * or project-level) a permission check operates against.
 */
export enum EUserPermissionsLevel {
  WORKSPACE = "WORKSPACE",
  PROJECT = "PROJECT",
}

/** Alias for `EUserPermissionsLevel` value type — convenience reuse in maps/objects. */
export type TUserPermissionsLevel = EUserPermissionsLevel;

/**
 * Role enum with numeric weight (higher = more privilege): ADMIN=20, MEMBER=15, GUEST=5 — mirrors `WorkspaceMember.role` / `ProjectMember.role` IntegerField choices in `apps/api/plane/db/models/{workspace,project}.py`.
 * The numeric values are a cross-stack contract; do not change without a coordinated backend update.
 */
export enum EUserPermissions {
  ADMIN = 20,
  MEMBER = 15,
  GUEST = 5,
}
/** Alias for `EUserPermissions` value type — convenience reuse in maps/objects. */
export type TUserPermissions = EUserPermissions;

/**
 * Per-operation permission requirement — lists which roles may perform create/update/
 * delete/read for a given resource. An empty array for a given operation means "no
 * role can perform it"; absence of the key (via `Partial<...>`) means the operation
 * is unrestricted by this table.
 */
export type TUserAllowedPermissionsObject = {
  create: TUserPermissions[];
  update: TUserPermissions[];
  delete: TUserPermissions[];
  read: TUserPermissions[];
};
/**
 * Resource → operation → role-list permission table, partitioned into workspace-level
 * and project-level resources. Keys under each scope are free-form resource
 * identifiers (e.g., `dashboard`) referenced by permission checks at consumer sites.
 */
export type TUserAllowedPermissions = {
  workspace: {
    [key: string]: Partial<TUserAllowedPermissionsObject>;
  };
  project: {
    [key: string]: Partial<TUserAllowedPermissionsObject>;
  };
};

// INTENT UNCLEAR: USER_ALLOWED_PERMISSIONS has no consumer in tracked source — the
// permission gating logic lives in apps/web/core/store/user/permissions.store.ts and the
// route layouts, but neither imports this table directly.
/**
 * Default workspace/project permission table — workspace entry grants dashboard read to admin/member/guest; project table starts empty and is populated per feature.
 */
export const USER_ALLOWED_PERMISSIONS: TUserAllowedPermissions = {
  workspace: {
    dashboard: {
      read: [EUserPermissions.ADMIN, EUserPermissions.MEMBER, EUserPermissions.GUEST],
    },
  },
  project: {},
};
