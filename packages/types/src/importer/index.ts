/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the `@plane/types/importer` subfolder.
 *
 * Re-exports the GitHub importer types from `./github-importer.ts` and the Jira
 * importer types from `./jira-importer.ts`, and defines the importer/export job
 * record shapes shared across providers:
 * - `IImporterService`: persisted importer-job record (status, ownership, workspace/project)
 * - `IExportData`: persisted export-job record (status, signed URL, ownership)
 * - `IExportServiceResponse`: paginated listing envelope for export records
 *
 * Consumers:
 * - `apps/web/core/services/integrations/integration.service.ts` (importer + exports list)
 * - `apps/web/core/components/exporter/{export-modal,single-export,column,prev-exports}.tsx`
 * - Mirrors backend records produced by `apps/api/plane/bgtasks/export_task.py` and the
 *   GitHub/Jira importer Celery tasks (Celery routes through RabbitMQ; the broker is
 *   NOT Redis — Redis is caching/session only per AAP §0.2.2)
 */

export * from "./github-importer";
export * from "./jira-importer";

import type { IProjectLite } from "../project";
// types
import type { IUserLite } from "../users";

/**
 * Persisted importer-job record returned by `apps/api`'s integrations endpoint.
 *
 * Captures the full lifecycle state of an importer run — ownership/audit fields,
 * workspace + project linkage, provider metadata, nested sync + user-data configuration,
 * and the status discriminant.
 *
 * Triggered by the workspace integrations panel; the underlying import work is
 * performed asynchronously by Celery worker tasks (Celery → RabbitMQ, NOT Redis)
 * configured in `apps/api/plane/bgtasks/`.
 *
 * Fields with non-obvious semantics:
 * - `config.sync`: when true, the importer keeps polling the source provider for
 *   incremental updates after the initial import completes
 * - `data.users`: typed as an empty-tuple `[]` in the source — server may hydrate with
 *   `IGithubServiceImportFormData["data"]["users"]` or the Jira `User[]` equivalent at
 *   runtime; the strict type here intentionally matches the response shape that omits
 *   user-mapping detail in the read path (provider-specific shapes live in their own files)
 * - `metadata.repository_id` + `metadata.url`: GitHub-style metadata; Jira-imported
 *   services populate the same metadata shape with the Jira project identifier in `name`
 *   and the cloud hostname in `url`
 * - `service`: provider slug discriminator ("github" / "jira" / etc.) used to route the
 *   server-side worker to the correct importer task module
 * - `status`: importer-job lifecycle state — see per-value notes below
 * - `token`: workspace-scoped credential persisted server-side for the importer worker;
 *   this field is server-only context and never exposed in clear text after creation
 * - `initiated_by_detail` / `project_detail`: hydrated cross-entity projections used to
 *   render the importer history list without additional fetches
 */
export interface IImporterService {
  created_at: string;
  config: {
    sync: boolean;
  };
  created_by: string | null;
  data: {
    users: [];
  };
  id: string;
  initiated_by: string;
  initiated_by_detail: IUserLite;
  metadata: {
    name: string;
    owner: string;
    repository_id: number;
    url: string;
  };
  project: string;
  project_detail: IProjectLite;
  service: string;
  /**
   * Importer-job lifecycle status.
   *
   * Per-value semantics:
   * - `processing`: importer worker is actively pulling data from the source provider
   *   (initial bulk import or incremental sync poll if `config.sync` is true)
   * - `completed`: importer worker finished successfully and persisted all items
   * - `failed`: importer worker encountered an unrecoverable error (see Celery task
   *   logs in `apps/api/plane/bgtasks/` for the GitHub/Jira-specific failure cause);
   *   the importer can be re-run from the workspace integrations panel
   */
  status: "processing" | "completed" | "failed";
  updated_at: string;
  updated_by: string;
  token: string;
  workspace: string;
}

/**
 * Persisted export-job record returned by the workspace exports listing endpoint.
 *
 * Captures a single export operation — projects exported, the chosen provider (CSV /
 * Excel / JSON), the resulting downloadable file URL, and audit fields.
 *
 * The actual export work is performed asynchronously by `apps/api/plane/bgtasks/export_task.py`
 * (Celery → RabbitMQ, NOT Redis) per AAP §0.2.2 architectural context.
 *
 * Fields with non-obvious semantics:
 * - `project`: array of project ids included in this export (exports may span multiple projects)
 * - `provider`: free-form string identifying the export format (e.g. "csv", "xlsx", "json")
 * - `status`: typed as a generic string (NOT a union here, unlike `IImporterService.status`)
 *   so the UI receives the raw backend label; consumers in `apps/web/core/components/exporter/`
 *   compare against the literals exported by the export-task module
 * - `url`: signed/expiring URL pointing to the generated export file in object storage;
 *   the URL is short-lived and should be re-fetched for renewed downloads
 * - `token`: opaque server-issued reference used to look up the export job (separate from
 *   the user's session JWT)
 * - `initiated_by_detail`: hydrated user projection of the export's initiator for display
 */
export interface IExportData {
  id: string;
  created_at: string;
  updated_at: string;
  project: string[];
  provider: string;
  status: string;
  url: string;
  token: string;
  created_by: string;
  updated_by: string;
  initiated_by_detail: IUserLite;
}
/**
 * Paginated response envelope for the workspace exports listing endpoint.
 *
 * Mirrors the cursor-based pagination convention used by other `apps/api` list endpoints.
 *
 * Fields with non-obvious semantics:
 * - `count`: number of items in the current page (NOT total across all pages)
 * - `total_pages`: total number of pages available
 * - `next_cursor` / `prev_cursor`: opaque pagination cursors used by subsequent requests
 * - `next_page_results` / `prev_page_results`: boolean flags indicating availability of
 *   neighboring pages (avoids extra round-trips to discover edges)
 * - `extra_stats`: typed as `null` in the source because this endpoint never populates
 *   the extra-stats field; preserved here for shape consistency with other paginated envelopes
 * - `results`: the actual export-job records for the current page
 */
export interface IExportServiceResponse {
  count: number;
  extra_stats: null;
  next_cursor: string;
  next_page_results: boolean;
  prev_cursor: string;
  prev_page_results: boolean;
  results: IExportData[];
  total_pages: number;
}
