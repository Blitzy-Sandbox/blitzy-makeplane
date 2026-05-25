/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Catalogs of decimal Unicode code-points used by the Plane emoji system.
 *
 * Each entry is a stringified decimal code-point (e.g., `"128077"` = 👍 U+1F44D);
 * storing the code-point as a string keeps JSON/API payloads stable and avoids
 * implicit numeric coercion when the value is keyed against decimal-indexed
 * emoji data sets (e.g., `emoji-datasource` lookups, the backend reaction store).
 */

/**
 * Default emoji reaction set offered on issues, comments, and similar content
 * surfaces — the canonical short list rendered by reaction pickers (👍, 👎, 😄,
 * 💥, 😕, 🧡, ✈, 👀).
 *
 * Consumers: issue/comment reaction pickers in `apps/web/core/components/**`
 * and the shared `EmojiReactionPicker` in `packages/propel/src/emoji-reaction/`.
 */
export const ISSUE_REACTION_EMOJI_CODES = [
  "128077",
  "128078",
  "128516",
  "128165",
  "128533",
  "129505",
  "9992",
  "128064",
];

/**
 * Pool of emoji code-points used to seed a deterministic emoji avatar when a
 * workspace/project entity has no user-chosen logo — picked at form-init time
 * via `RANDOM_EMOJI_CODES[Math.floor(Math.random() * RANDOM_EMOJI_CODES.length)]`.
 *
 * Consumers: `getRandomEmoji()` in `packages/utils/src/emoji.ts`; project
 * create-form defaults in `apps/web/ce/components/projects/create/utils.ts`.
 */
export const RANDOM_EMOJI_CODES = [
  "8986",
  "9200",
  "128204",
  "127773",
  "127891",
  "128076",
  "128077",
  "128187",
  "128188",
  "128512",
  "128522",
  "128578",
];
