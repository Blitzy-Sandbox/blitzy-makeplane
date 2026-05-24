/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * AI feature response contracts for the `@plane/types` package.
 *
 * Models the GPT integration response returned by `apps/api`'s AI endpoint, consumed
 * by the rewrite-with-AI and generate-description features in the rich-text editor
 * (`packages/editor`).
 */

import type { IProjectLite } from "./project";
import type { IWorkspaceLite } from "./workspace";

/**
 * Response from the AI assistant (GPT integration) endpoint.
 *
 * Fields:
 * - `response`: plain-text AI completion (for streaming/preview UI).
 * - `response_html`: HTML-rendered AI completion (inserted directly into the editor).
 * - `count`: tokens consumed for this request (used for cost/limit tracking).
 * - `project_detail` / `workspace_detail`: hydrated context echoed back for audit/logging.
 */
export interface IGptResponse {
  response: string;
  response_html: string;
  count: number;
  project_detail: IProjectLite;
  workspace_detail: IWorkspaceLite;
}
