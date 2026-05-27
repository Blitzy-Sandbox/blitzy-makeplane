/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Abstract base page model — the foundational MobX class that turns a `TPage` API
 * payload into a reactive, mutable, optimistic-with-rollback page store. Extended
 * by `ProjectPage` (in this folder) and by any EE variants under
 * `apps/web/plane-web/store/pages/extended-base-page.ts`. Subclasses inject the
 * scope-specific `TBasePageServices` (workspace, project, etc.) and add their own
 * permission-aware computed getters.
 *
 * State slice (observables registered via `makeObservable`):
 *   - isSubmitting: TNameDescriptionLoader — "saved" | "submitting" | "submitted"; toggled by the debounced title-persistence reaction (see below).
 *   - isSyncingWithServer: "syncing" | "synced" | "error" — surfaced in the editor sync status indicator; updated via `setSyncingStatus`.
 *   - id, name, logo_props, description_json, description_html, color, label_ids, owned_by, access, is_favorite, is_locked, archived_at, workspace, project_ids, created_by, updated_by, created_at, updated_at, deleted_at — page metadata mirrored from the `TPage` payload; declared with `observable.ref` for scalar/object refs and plain `observable` for arrays (`label_ids`, `project_ids`).
 *   - oldName: string — rollback snapshot of the previous title; reset on every `updateTitle` call to enable revert-on-failure inside the debounced persistence reaction.
 *   - editor: PageEditorInstance — sub-store owning ephemeral editor runtime state (selection, asset list, editorRef). Not registered in `makeObservable` because `PageEditorInstance` declares its own observables.
 *
 * Computed:
 *   - asJSON: TPage | undefined — full `TPage` snapshot suitable for rollback, duplication, or off-thread serialization. Includes whatever extension fields the `ExtendedBasePage` subclass exposes via `asJSONExtended`. Recomputes when any observable field listed above changes.
 *   - isCurrentUserOwner: boolean — true when `owned_by === rootStore.user.data?.id`; the primary discriminant for private-page access checks in subclass capability flags.
 *
 * Actions (all registered as `action` in `makeObservable`):
 *   - setIsSubmitting(value) — toggle the title-submission flag (wrapped in `runInAction`).
 *   - cleanup() — disposes every registered MobX reaction (see `disposers`). MUST be called when the page detail view unmounts to avoid the title reaction firing against an orphan instance.
 *   - update(pageData) — optimistic: writes every key in `pageData` to `this` via `lodash-es/set`, then calls `services.update(asJSON)`. On failure, restores every key from the pre-update snapshot and rethrows.
 *   - updateTitle(title) — synchronous: stashes the current name into `oldName`, then sets `this.name = title`. The actual server persistence is triggered by the debounced `reaction` on `name` (see "Reactions" below), not by this method.
 *   - updateDescription(document) — optimistic: writes `document.description_html` immediately, then calls `services.updateDescription(document)`. Rollback restores the previous HTML on failure.
 *   - makePublic({ shouldSync }), makePrivate({ shouldSync }) — optimistic access toggles; only call `services.updateAccess` when `shouldSync` is true (passed false when the change originates from a live-server push to avoid an echo back to the server).
 *   - lock({ shouldSync, recursive }), unlock({ shouldSync, recursive }) — optimistic lock toggles; same `shouldSync` echo-prevention semantics. The `recursive` flag is passed through unchanged to subclass services that support sub-page locking.
 *   - archive({ shouldSync, archived_at }), restore({ shouldSync }) — optimistic archive toggles; archive additionally calls `rootStore.favorite.removeFavoriteFromStore(this.id)` when the page was favorited, since archived pages cannot remain in the favorites list.
 *   - updatePageLogo(value) — optimistic logo update; accepts a `TChangeHandlerProps` from `@plane/propel/emoji-icon-picker`, converts emoji/icon payload shape into a `TLogoProps`, writes locally, then calls `services.update({ logo_props })`.
 *   - addToFavorites(), removePageFromFavorites() — optimistic favorite toggles routed through `rootStore.favorite.addFavorite` / `rootStore.favorite.removeFavoriteEntity`.
 *   - duplicate() — async pass-through to `services.duplicate()`; returns the duplicated `TPage` for the caller to insert into the parent store cache.
 *   - mutateProperties(data, shouldUpdateName) — bulk merge of partial page data WITHOUT triggering the title reaction. Used by the parent store (`ProjectPageStore#fetchPagesList`, `#fetchPageDetails`) to merge fresh fetch results into existing instances. `shouldUpdateName = false` skips the `name` field to avoid stomping in-flight edits.
 *   - setSyncingStatus(status) — flips `isSyncingWithServer` (used by the editor sync indicator).
 *
 * Reactions (registered in the constructor, owned by `disposers`):
 *   - Title persistence reaction — watches `this.name` with a `{ delay: 2000 }` debounce. On each settled change it sets `isSubmitting = "submitting"`, calls `services.update({ name })`, and on failure reverts `this.name = this.oldName`. The finally block always sets `isSubmitting = "submitted"`. This is the canonical "debounce title saves" implementation referenced by editor toolbars in `components/pages/editor/header/`.
 *
 * Services (injected via constructor):
 *   - TBasePageServices — `{ update, updateDescription, updateAccess, lock, unlock, archive, restore, duplicate }`. Subclasses (e.g., `ProjectPage`) bind these to the appropriate REST service (e.g., `ProjectPageService`) before invoking `super(...)`. The base class is intentionally agnostic of workspace vs. project vs. EE scope.
 *
 * Cross-system surfaces:
 *   - Live-server pushback — `apps/live/src/services/page/handler.ts` writes binary/html description updates back through the REST API which then propagates to instances of this class via `updateDescription`. The Y.Doc-bound description binary is NOT stored on this class; only the rendered `description_html` and `description_json` projections are.
 *   - Editor sub-store — `editor: PageEditorInstance` exposes ephemeral selection / focus / asset state used by the page editor toolbars (`apps/web/core/components/pages/editor/toolbar`, `editor/header`, `editor/summary`).
 *
 * Exported symbols:
 *   - TBasePage — observable + action + computed contract on every page instance.
 *   - TBasePagePermissions — permission flag contract; each subclass implements these as computed getters using its own scope-specific role resolution.
 *   - TBasePageServices — REST service contract; each subclass binds these to its scope-specific service.
 *   - TPageInstance — union of `TBasePage` + `TBasePagePermissions` + `{ getRedirectionLink }`; the fully-realized page model surface consumed by UI.
 *   - BasePage — concrete extendable class.
 *
 * Consumers:
 *   - apps/web/core/store/pages/project-page.ts — extends `BasePage` to add project-scoped service bindings and permission computed getters.
 *   - apps/web/plane-web/store/pages/extended-base-page.ts — EE intermediate base; provides `asJSONExtended` and any additional observable extensions.
 *   - apps/web/core/components/pages/** — every page-related component reads instances of subclasses of `BasePage` from the parent store cache.
 */

import { set } from "lodash-es";
import { action, computed, makeObservable, observable, reaction, runInAction } from "mobx";
// plane imports
import { EPageAccess } from "@plane/constants";
import type { TChangeHandlerProps } from "@plane/propel/emoji-icon-picker";
import type { TDocumentPayload, TLogoProps, TNameDescriptionLoader, TPage } from "@plane/types";
// plane web store
import { ExtendedBasePage } from "@/plane-web/store/pages/extended-base-page";
import type { RootStore } from "@/plane-web/store/root.store";
// local imports
import { PageEditorInstance } from "./page-editor-info";

export type TBasePage = TPage & {
  // observables
  isSubmitting: TNameDescriptionLoader;
  isSyncingWithServer: "syncing" | "synced" | "error";
  // computed
  asJSON: TPage | undefined;
  isCurrentUserOwner: boolean;
  // helpers
  oldName: string;
  setIsSubmitting: (value: TNameDescriptionLoader) => void;
  cleanup: () => void;
  // actions
  update: (pageData: Partial<TPage>) => Promise<Partial<TPage> | undefined>;
  updateTitle: (title: string) => void;
  updateDescription: (document: TDocumentPayload) => Promise<void>;
  makePublic: (params: { shouldSync?: boolean }) => Promise<void>;
  makePrivate: (params: { shouldSync?: boolean }) => Promise<void>;
  lock: (params: { shouldSync?: boolean; recursive?: boolean }) => Promise<void>;
  unlock: (params: { shouldSync?: boolean; recursive?: boolean }) => Promise<void>;
  archive: (params: { shouldSync?: boolean; archived_at?: string | null }) => Promise<void>;
  restore: (params: { shouldSync?: boolean }) => Promise<void>;
  updatePageLogo: (value: TChangeHandlerProps) => Promise<void>;
  addToFavorites: () => Promise<void>;
  removePageFromFavorites: () => Promise<void>;
  duplicate: () => Promise<TPage | undefined>;
  mutateProperties: (data: Partial<TPage>, shouldUpdateName?: boolean) => void;
  setSyncingStatus: (status: "syncing" | "synced" | "error") => void;
  // sub-store
  editor: PageEditorInstance;
};

export type TBasePagePermissions = {
  canCurrentUserAccessPage: boolean;
  canCurrentUserEditPage: boolean;
  canCurrentUserDuplicatePage: boolean;
  canCurrentUserLockPage: boolean;
  canCurrentUserChangeAccess: boolean;
  canCurrentUserArchivePage: boolean;
  canCurrentUserDeletePage: boolean;
  canCurrentUserFavoritePage: boolean;
  canCurrentUserMovePage: boolean;
  isContentEditable: boolean;
};

export type TBasePageServices = {
  update: (payload: Partial<TPage>) => Promise<Partial<TPage>>;
  updateDescription: (document: TDocumentPayload) => Promise<void>;
  updateAccess: (payload: Pick<TPage, "access">) => Promise<void>;
  lock: () => Promise<void>;
  unlock: () => Promise<void>;
  archive: () => Promise<{
    archived_at: string;
  }>;
  restore: () => Promise<void>;
  duplicate: () => Promise<TPage>;
};

export type TPageInstance = TBasePage &
  TBasePagePermissions & {
    getRedirectionLink: () => string;
  };

export class BasePage extends ExtendedBasePage implements TBasePage {
  // loaders
  isSubmitting: TNameDescriptionLoader = "saved";
  isSyncingWithServer: "syncing" | "synced" | "error" = "syncing";
  // page properties
  id: string | undefined;
  name: string | undefined;
  logo_props: TLogoProps | undefined;
  description_json: object | undefined;
  description_html: string | undefined;
  color: string | undefined;
  label_ids: string[] | undefined;
  owned_by: string | undefined;
  access: EPageAccess | undefined;
  is_favorite: boolean;
  is_locked: boolean;
  archived_at: string | null | undefined;
  workspace: string | undefined;
  project_ids?: string[] | undefined;
  created_by: string | undefined;
  updated_by: string | undefined;
  created_at: Date | undefined;
  updated_at: Date | undefined;
  deleted_at: Date | undefined;
  // helpers
  oldName: string = "";
  // services
  services: TBasePageServices;
  // reactions
  disposers: Array<() => void> = [];
  // root store
  rootStore: RootStore;
  // sub-store
  editor: PageEditorInstance;

  constructor(
    private store: RootStore,
    page: TPage,
    services: TBasePageServices
  ) {
    super(store, page, services);

    this.id = page?.id || undefined;
    this.name = page?.name;
    this.logo_props = page?.logo_props || undefined;
    this.description_json = page?.description_json || undefined;
    this.description_html = page?.description_html || undefined;
    this.color = page?.color || undefined;
    this.label_ids = page?.label_ids || undefined;
    this.owned_by = page?.owned_by || undefined;
    this.access = page?.access || EPageAccess.PUBLIC;
    this.is_favorite = page?.is_favorite || false;
    this.is_locked = page?.is_locked || false;
    this.archived_at = page?.archived_at || undefined;
    this.workspace = page?.workspace || undefined;
    this.project_ids = page?.project_ids || undefined;
    this.created_by = page?.created_by || undefined;
    this.updated_by = page?.updated_by || undefined;
    this.created_at = page?.created_at || undefined;
    this.updated_at = page?.updated_at || undefined;
    this.oldName = page?.name || "";
    this.deleted_at = page?.deleted_at || undefined;

    makeObservable(this, {
      // loaders
      isSubmitting: observable.ref,
      // page properties
      id: observable.ref,
      name: observable.ref,
      logo_props: observable.ref,
      description_json: observable.ref,
      description_html: observable.ref,
      color: observable.ref,
      label_ids: observable,
      owned_by: observable.ref,
      access: observable.ref,
      is_favorite: observable.ref,
      is_locked: observable.ref,
      archived_at: observable.ref,
      workspace: observable.ref,
      project_ids: observable,
      created_by: observable.ref,
      updated_by: observable.ref,
      created_at: observable.ref,
      updated_at: observable.ref,
      deleted_at: observable.ref,
      isSyncingWithServer: observable.ref,
      // helpers
      oldName: observable.ref,
      setIsSubmitting: action,
      cleanup: action,
      // computed
      asJSON: computed,
      isCurrentUserOwner: computed,
      // actions
      update: action,
      updateTitle: action,
      updateDescription: action,
      makePublic: action,
      makePrivate: action,
      lock: action,
      unlock: action,
      archive: action,
      restore: action,
      updatePageLogo: action,
      addToFavorites: action,
      removePageFromFavorites: action,
      duplicate: action,
      mutateProperties: action,
    });

    // init
    this.services = services;
    this.rootStore = store;
    this.editor = new PageEditorInstance();

    const titleDisposer = reaction(
      () => this.name,
      (name) => {
        this.isSubmitting = "submitting";
        this.services
          .update({
            name,
          })
          .catch(() =>
            runInAction(() => {
              this.name = this.oldName;
            })
          )
          .finally(() =>
            runInAction(() => {
              this.isSubmitting = "submitted";
            })
          );
      },
      { delay: 2000 }
    );
    this.disposers.push(titleDisposer);
  }

  // computed
  get asJSON() {
    return {
      id: this.id,
      name: this.name,
      description_json: this.description_json,
      description_html: this.description_html,
      color: this.color,
      label_ids: this.label_ids,
      owned_by: this.owned_by,
      access: this.access,
      logo_props: this.logo_props,
      is_favorite: this.is_favorite,
      is_locked: this.is_locked,
      archived_at: this.archived_at,
      workspace: this.workspace,
      project_ids: this.project_ids,
      created_by: this.created_by,
      updated_by: this.updated_by,
      created_at: this.created_at,
      updated_at: this.updated_at,
      deleted_at: this.deleted_at,
      ...this.asJSONExtended,
    };
  }

  get isCurrentUserOwner() {
    const currentUserId = this.store.user.data?.id;
    if (!currentUserId) return false;
    return this.owned_by === currentUserId;
  }

  /**
   * @description update the submitting state
   * @param value
   */
  setIsSubmitting = (value: TNameDescriptionLoader) => {
    runInAction(() => {
      this.isSubmitting = value;
    });
  };

  cleanup = () => {
    this.disposers.forEach((disposer) => {
      disposer();
    });
  };

  /**
   * @description update the page
   * @param {Partial<TPage>} pageData
   */
  update = async (pageData: Partial<TPage>) => {
    const currentPage = this.asJSON;
    try {
      runInAction(() => {
        Object.keys(pageData).forEach((key) => {
          const currentPageKey = key as keyof TPage;
          set(this, key, pageData[currentPageKey] || undefined);
        });
      });

      return await this.services.update(currentPage);
    } catch (error) {
      runInAction(() => {
        Object.keys(pageData).forEach((key) => {
          const currentPageKey = key as keyof TPage;
          set(this, key, currentPage?.[currentPageKey] || undefined);
        });
      });
      throw error;
    }
  };

  /**
   * @description update the page title
   * @param title
   */
  updateTitle = (title: string) => {
    this.oldName = this.name ?? "";
    this.name = title;
  };

  /**
   * @description update the page description
   * @param {TDocumentPayload} document
   */
  updateDescription = async (document: TDocumentPayload) => {
    const currentDescription = this.description_html;
    runInAction(() => {
      this.description_html = document.description_html;
    });

    try {
      await this.services.updateDescription(document);
    } catch (error) {
      runInAction(() => {
        this.description_html = currentDescription;
      });
      throw error;
    }
  };

  /**
   * @description make the page public
   */
  makePublic = async ({ shouldSync = true }) => {
    const pageAccess = this.access;
    runInAction(() => {
      this.access = EPageAccess.PUBLIC;
    });

    if (shouldSync) {
      try {
        await this.services.updateAccess({
          access: EPageAccess.PUBLIC,
        });
      } catch (error) {
        runInAction(() => {
          this.access = pageAccess;
        });
        throw error;
      }
    }
  };

  /**
   * @description make the page private
   */
  makePrivate = async ({ shouldSync = true }) => {
    const pageAccess = this.access;
    runInAction(() => {
      this.access = EPageAccess.PRIVATE;
    });

    if (shouldSync) {
      try {
        await this.services.updateAccess({
          access: EPageAccess.PRIVATE,
        });
      } catch (error) {
        runInAction(() => {
          this.access = pageAccess;
        });
        throw error;
      }
    }
  };

  /**
   * @description lock the page
   */
  lock = async ({ shouldSync = true }) => {
    const pageIsLocked = this.is_locked;
    runInAction(() => (this.is_locked = true));

    if (shouldSync) {
      await this.services.lock().catch((error) => {
        runInAction(() => {
          this.is_locked = pageIsLocked;
        });
        throw error;
      });
    }
  };

  /**
   * @description unlock the page
   */
  unlock = async ({ shouldSync = true }) => {
    const pageIsLocked = this.is_locked;
    runInAction(() => (this.is_locked = false));

    if (shouldSync) {
      await this.services.unlock().catch((error) => {
        runInAction(() => {
          this.is_locked = pageIsLocked;
        });
        throw error;
      });
    }
  };

  /**
   * @description archive the page
   */
  archive = async ({ shouldSync = true, archived_at }: { shouldSync?: boolean; archived_at?: string | null }) => {
    if (!this.id) return undefined;

    try {
      runInAction(() => {
        this.archived_at = archived_at ?? new Date().toISOString();
      });

      if (this.rootStore.favorite.entityMap[this.id]) this.rootStore.favorite.removeFavoriteFromStore(this.id);

      if (shouldSync) {
        const response = await this.services.archive();
        runInAction(() => {
          this.archived_at = response.archived_at;
        });
      }
    } catch (error) {
      console.error(error);
      runInAction(() => {
        this.archived_at = null;
      });
    }
  };

  /**
   * @description restore the page
   */
  restore = async ({ shouldSync = true }: { shouldSync?: boolean }) => {
    const archivedAtBeforeRestore = this.archived_at;

    try {
      runInAction(() => {
        this.archived_at = null;
      });

      if (shouldSync) {
        await this.services.restore();
      }
    } catch (error) {
      console.error(error);
      runInAction(() => {
        this.archived_at = archivedAtBeforeRestore;
      });
      throw error;
    }
  };

  updatePageLogo = async (value: TChangeHandlerProps) => {
    const originalLogoProps = { ...this.logo_props };
    try {
      let logoValue = {};
      if (value?.type === "emoji")
        logoValue = {
          value: value.value,
          url: undefined,
        };
      else if (value?.type === "icon") logoValue = value.value;

      const logoProps: TLogoProps = {
        in_use: value?.type,
        [value?.type]: logoValue,
      };

      runInAction(() => {
        this.logo_props = logoProps;
      });
      await this.services.update({
        logo_props: logoProps,
      });
    } catch (error) {
      console.error("Error in updating page logo", error);
      runInAction(() => {
        this.logo_props = originalLogoProps as TLogoProps;
      });
      throw error;
    }
  };

  /**
   * @description add the page to favorites
   */
  addToFavorites = async () => {
    const { workspaceSlug } = this.store.router;
    const projectId = this.project_ids?.[0] ?? null;
    if (!workspaceSlug || !this.id) return undefined;

    const pageIsFavorite = this.is_favorite;
    runInAction(() => {
      this.is_favorite = true;
    });
    await this.rootStore.favorite
      .addFavorite(workspaceSlug.toString(), {
        entity_type: "page",
        entity_identifier: this.id,
        project_id: projectId,
        entity_data: { name: this.name || "" },
      })
      .catch((error) => {
        runInAction(() => {
          this.is_favorite = pageIsFavorite;
        });
        throw error;
      });
  };

  /**
   * @description remove the page from favorites
   */
  removePageFromFavorites = async () => {
    const { workspaceSlug } = this.store.router;
    if (!workspaceSlug || !this.id) return undefined;

    const pageIsFavorite = this.is_favorite;
    runInAction(() => {
      this.is_favorite = false;
    });

    await this.rootStore.favorite.removeFavoriteEntity(workspaceSlug, this.id).catch((error) => {
      runInAction(() => {
        this.is_favorite = pageIsFavorite;
      });
      throw error;
    });
  };

  /**
   * @description duplicate the page
   */
  duplicate = async () => await this.services.duplicate();

  /**
   * @description mutate multiple properties at once
   * @param data Partial<TPage>
   */
  mutateProperties = (data: Partial<TPage>, shouldUpdateName: boolean = true) => {
    Object.keys(data).forEach((key) => {
      const value = data[key as keyof TPage];
      if (key === "name" && !shouldUpdateName) return;
      set(this, key, value);
    });
  };

  setSyncingStatus = (status: "syncing" | "synced" | "error") => {
    runInAction(() => {
      this.isSyncingWithServer = status;
    });
  };
}
