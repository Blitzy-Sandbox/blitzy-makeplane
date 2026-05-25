/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Mentions extension barrel — public re-export surface for the editor's @-mention feature.
 *
 * Re-exports the runtime mention extension from `./extension` (`CustomMentionExtension`) and
 * the schema-only configuration from `./extension-config` (`CustomMentionExtensionConfig`,
 * `TMentionExtensionOptions`). Internal helpers (`utils.ts`, `mention-node-view.tsx`,
 * `mentions-list-dropdown.tsx`) and shared attribute types (`types.ts`) are intentionally
 * NOT re-exported here — they are imported directly by `extension.tsx` for composition.
 *
 * Two consumption paths:
 *   - Runtime editor (full React/TipTap surface) → `CustomMentionExtension(mentionHandler)`,
 *     wired in `core/extensions/extensions.ts`.
 *   - Headless/server-side (PDF export, HTML→markdown conversion) → `CustomMentionExtensionConfig`,
 *     wired in `core/extensions/core-without-props.ts` to avoid pulling in React.
 */

export * from "./extension";
export * from "./extension-config";
