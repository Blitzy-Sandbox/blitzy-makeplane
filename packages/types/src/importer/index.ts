/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for `@plane/types/importer` — re-exports GitHub/Jira importer types
 * and defines provider-agnostic job records (`IImporterService`, `IExportData`,
 * `IExportServiceResponse`); mirrors Celery-driven backend tasks in
 * `apps/api/plane/bgtasks/` (Celery routes through RabbitMQ, not Redis).
 */

export * from "./github-importer";
export * from "./jira-importer";

import type { IProjectLite } from "../project";
// types
import type { IUserLite } from "../users";

/**
 * Persisted importer-job record (status, ownership, workspace/project linkage)
 * driven by Celery workers in `apps/api/plane/bgtasks/`; `data.users` is typed
 * as an empty tuple in the read response (provider-specific user-mapping
 * shapes live in `./github-importer.ts` and `./jira-importer.ts`), and the
 * `service` slug routes the worker to the correct importer task module.
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
   * Importer-job lifecycle: `processing` (worker actively pulling), `completed`
   * (worker finished and persisted all items), or `failed` (unrecoverable error
   * — re-runnable from the workspace integrations panel).
   */
  status: "processing" | "completed" | "failed";
  updated_at: string;
  updated_by: string;
  token: string;
  workspace: string;
}

/**
 * Persisted export-job record produced by `apps/api/plane/bgtasks/export_task.py`;
 * `status` is intentionally a bare `string` (not a union) so the UI receives
 * the raw backend label, `url` is a short-lived signed object-storage URL,
 * and `project` may span multiple project ids per export.
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
 * Cursor-paginated envelope for the workspace exports listing; `count` is the
 * current-page row count (not the total), `extra_stats` is always `null` here
 * (preserved for shape parity with other paginated envelopes), and the
 * `next_page_results`/`prev_page_results` flags avoid extra edge-discovery calls.
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
