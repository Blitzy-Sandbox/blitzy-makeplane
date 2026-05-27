/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX store for editor-driven asset uploads and duplications, scoped per editor block.
 *
 * Owned by `CoreRootStore` as the `editorAssetStore` field (declared on the
 * root composition class and instantiated in both the constructor and
 * `resetOnSignOut`); consumed by components via the `useEditorAsset` hook
 * at `apps/web/core/hooks/store/use-editor-asset.ts`.
 *
 * State slice (observables):
 *   - assetsUploadStatus: Record<string, TAttachmentUploadStatus>
 *       Keyed by editor block id. Each value carries the in-flight upload's
 *       client-side id (uuidv4), file name, progress (0-100), size, and MIME type.
 *       Records are inserted on upload start and deleted in the `finally` block
 *       of `uploadEditorAsset`, so the map only holds active uploads.
 *
 * Services (non-observable):
 *   - fileService: FileService — instantiated in the constructor; bridges to the
 *     `apps/api` presigned POST contract documented in tech spec §5.2.9 (see
 *     apps/api/plane/app/views/asset/v2.py). All uploads route through the Django
 *     backend's signed-URL issuance — never through direct client-side S3
 *     credentials.
 *
 * Computed:
 *   - assetsUploadPercentage: Record<string, number>
 *       Derives a blockId -> progress percentage map from `assetsUploadStatus`.
 *       Recomputes when any entry's `progress` field is mutated (which occurs via
 *       the `debouncedUpdateProgress` setter at 16ms intervals during upload).
 *
 * Helper (computedFn — memoized):
 *   - getAssetUploadStatusByEditorBlockId(blockId): TAttachmentUploadStatus | undefined
 *       Memoized per-blockId lookup into `assetsUploadStatus`. Re-evaluates only
 *       when the underlying observable record for the requested blockId changes.
 *
 * Actions:
 *   - uploadEditorAsset({ blockId, data, file, projectId?, workspaceSlug }):
 *       Promise<TFileSignedURLResponse>
 *       Inserts a temporary record into `assetsUploadStatus[blockId]` (uuidv4 id,
 *       progress=0), then dispatches to FileService.uploadProjectAsset when
 *       `projectId` is provided, otherwise FileService.uploadWorkspaceAsset.
 *       Progress events are funneled through a private 16ms-debounced setter that
 *       writes back into `assetsUploadStatus[blockId].progress` inside
 *       `runInAction`. The temporary record is always cleared in the `finally`
 *       block, including on error. Errors are logged via console.error and
 *       re-thrown to the caller for UI-level handling.
 *   - duplicateEditorAsset({ assetId, entityId?, entityType, projectId?,
 *       workspaceSlug }): Promise<{ asset_id: string }>
 *       Delegates to FileService.duplicateAsset (POST
 *       /api/assets/v2/workspaces/{slug}/duplicate-assets/{assetId}/) and
 *       normalizes the response to `{ asset_id }`. No observable mutation —
 *       duplication produces a new server-side asset id that callers persist on
 *       the consuming entity (page/issue description, comment, etc.).
 *
 * Consumers (verified via import grep on `useEditorAsset` and the store
 * registration in root.store.ts):
 *   - apps/web/core/hooks/store/use-editor-asset.ts (the central hook)
 *   - apps/web/core/hooks/editor/use-editor-config.ts (reads
 *     `assetsUploadPercentage` for the editor config)
 *   - apps/web/core/components/issues/issue-modal/components/description-editor.tsx
 *   - apps/web/core/components/issues/issue-detail/issue-activity/helper.tsx
 *   - apps/web/core/components/editor/rich-text/description-input/root.tsx
 *   - apps/web/core/components/inbox/modals/create-modal/issue-description.tsx
 *   - apps/web/app/(all)/[workspaceSlug]/(projects)/projects/(detail)/[projectId]
 *     /pages/(detail)/[pageId]/page.tsx
 *
 * See tech spec §5.2.9 for the presigned POST upload sequence.
 */

import { debounce, set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import { v4 as uuidv4 } from "uuid";
// plane types
import type { EFileAssetType, TFileEntityInfo, TFileSignedURLResponse } from "@plane/types";
// services
import { FileService } from "@/services/file.service";
import type { TAttachmentUploadStatus } from "../issue/issue-details/attachment.store";

export interface IEditorAssetStore {
  // computed
  assetsUploadPercentage: Record<string, number>;
  // helper methods
  getAssetUploadStatusByEditorBlockId: (blockId: string) => TAttachmentUploadStatus | undefined;
  // actions
  uploadEditorAsset: ({
    blockId,
    data,
    file,
    projectId,
    workspaceSlug,
  }: {
    blockId: string;
    data: TFileEntityInfo;
    file: File;
    projectId?: string;
    workspaceSlug: string;
  }) => Promise<TFileSignedURLResponse>;
  duplicateEditorAsset: ({
    assetId,
    entityId,
    entityType,
    projectId,
    workspaceSlug,
  }: {
    assetId: string;
    entityId?: string;
    entityType: EFileAssetType;
    projectId?: string;
    workspaceSlug: string;
  }) => Promise<{ asset_id: string }>;
}

export class EditorAssetStore implements IEditorAssetStore {
  // observables
  assetsUploadStatus: Record<string, TAttachmentUploadStatus> = {};
  // services
  fileService: FileService;

  constructor() {
    makeObservable(this, {
      // observables
      assetsUploadStatus: observable,
      // computed
      assetsUploadPercentage: computed,
      // actions
      uploadEditorAsset: action,
    });
    // services
    this.fileService = new FileService();
  }

  get assetsUploadPercentage() {
    const assetsStatus = this.assetsUploadStatus;
    const assetsPercentage: Record<string, number> = {};
    Object.keys(assetsStatus).forEach((blockId) => {
      const asset = assetsStatus[blockId];
      if (asset) assetsPercentage[blockId] = asset.progress;
    });
    return assetsPercentage;
  }

  // helper methods
  getAssetUploadStatusByEditorBlockId: IEditorAssetStore["getAssetUploadStatusByEditorBlockId"] = computedFn(
    (blockId) => {
      const blockDetails = this.assetsUploadStatus[blockId];
      if (!blockDetails) return undefined;
      return blockDetails;
    }
  );

  // actions
  private debouncedUpdateProgress = debounce((blockId: string, progress: number) => {
    runInAction(() => {
      set(this.assetsUploadStatus, [blockId, "progress"], progress);
    });
  }, 16);

  uploadEditorAsset: IEditorAssetStore["uploadEditorAsset"] = async (args) => {
    const { blockId, data, file, projectId, workspaceSlug } = args;
    const tempId = uuidv4();

    try {
      // update attachment upload status
      runInAction(() => {
        set(this.assetsUploadStatus, [blockId], {
          id: tempId,
          name: file.name,
          progress: 0,
          size: file.size,
          type: file.type,
        });
      });
      if (projectId) {
        const response = await this.fileService.uploadProjectAsset(
          workspaceSlug,
          projectId,
          data,
          file,
          (progressEvent) => {
            const progressPercentage = Math.round((progressEvent.progress ?? 0) * 100);
            this.debouncedUpdateProgress(blockId, progressPercentage);
          }
        );
        return response;
      } else {
        const response = await this.fileService.uploadWorkspaceAsset(workspaceSlug, data, file, (progressEvent) => {
          const progressPercentage = Math.round((progressEvent.progress ?? 0) * 100);
          this.debouncedUpdateProgress(blockId, progressPercentage);
        });
        return response;
      }
    } catch (error) {
      console.error("Error in uploading page asset:", error);
      throw error;
    } finally {
      runInAction(() => {
        delete this.assetsUploadStatus[blockId];
      });
    }
  };
  duplicateEditorAsset: IEditorAssetStore["duplicateEditorAsset"] = async (args) => {
    const { assetId, entityId, entityType, projectId, workspaceSlug } = args;
    const { asset_id } = await this.fileService.duplicateAsset(workspaceSlug, assetId, {
      entity_id: entityId,
      entity_type: entityType,
      project_id: projectId,
    });
    return { asset_id };
  };
}
