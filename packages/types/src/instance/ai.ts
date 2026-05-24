/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * AI provider configuration contracts for the `@plane/types/instance` subfolder.
 *
 * Models the OpenAI / GPT-compatible API credentials and model selection that
 * power AI-assist features (text summarization, generative responses) in
 * `@plane/editor` and the AI panel.
 *
 * Consumers: `apps/admin/` AI settings screen (writes the values) and
 * `apps/api/plane/bgtasks/` background tasks that perform server-side LLM
 * calls. Boot-time presence of these keys flips `IInstanceConfig.has_llm_configured`
 * to true and unlocks the AI assist menu in `@plane/editor`.
 */

/**
 * Storage keys for AI provider credentials persisted in the instance
 * configuration table.
 *
 * Field-level semantics:
 * - `LLM_API_KEY`: API key for the configured LLM endpoint
 *   (e.g. OpenAI API key, or a compatible provider's key). Stored encrypted
 *   server-side; masked by the API when read back to the admin UI.
 * - `LLM_MODEL`: model identifier passed to the LLM endpoint
 *   (e.g. `gpt-4o`, `gpt-4o-mini`); free-form string validated against the
 *   provider's catalog at call time, not at write time.
 */
export type TInstanceAIConfigurationKeys = "LLM_API_KEY" | "LLM_MODEL";
