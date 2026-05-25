/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * AI provider configuration keys (OpenAI/GPT-compatible) written by the
 * admin UI and read by `apps/api/plane/bgtasks/` LLM tasks; presence flips
 * `IInstanceConfig.has_llm_configured` and unlocks `@plane/editor`'s AI menu.
 */

/**
 * Storage keys for AI provider credentials persisted in the instance config
 * table: `LLM_API_KEY` (encrypted at rest, masked on read) and `LLM_MODEL`
 * (free-form identifier validated against the provider catalog at call time).
 */
export type TInstanceAIConfigurationKeys = "LLM_API_KEY" | "LLM_MODEL";
