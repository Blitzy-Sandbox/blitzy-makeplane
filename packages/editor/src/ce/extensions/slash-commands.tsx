/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Minimal CE (Community Edition) slash-command extension helper.
 *
 * Returns the list of additional slash-command options to merge into the core
 * slash-command suggestion list (consumed by
 * `core/extensions/slash-commands/command-items-list.tsx`). Acts as the CE-side
 * seam of the `@/plane-editor/extensions` path alias so EE builds can override
 * this module without forcing changes at the call site.
 */

// extensions
import type { TSlashCommandAdditionalOption } from "@/extensions";
// types
import type { IEditorProps } from "@/types";

type Props = Pick<IEditorProps, "disabledExtensions" | "flaggedExtensions">;

/**
 * Returns the additional slash-command options to merge with the core slash-command extension.
 *
 * The current CE implementation returns an empty array — this is the documented
 * intent, providing a typed extension point that EE builds or future CE
 * additions can override without changing the call site in
 * `core/extensions/slash-commands/command-items-list.tsx`. The `const {} = props;`
 * destructure inside the body is a deliberate stylistic signal that `props` is
 * accepted by contract but currently unused.
 *
 * EE override of `@plane/editor` may replace this builder via the
 * `@/plane-editor/*` path alias (resolved to `src/ee/extensions/` in EE builds)
 * to inject enterprise-specific slash commands (e.g., AI prompts).
 *
 * @param props - Narrow editor-props subset (`disabledExtensions` and
 *   `flaggedExtensions` picked from `IEditorProps`) reserved for filtering
 *   returned options against disabled or flagged extension lists in future
 *   implementations. See the inline `Props` type alias for the exact shape.
 * @returns Array of `TSlashCommandAdditionalOption` entries to spread into the
 *   core slash-command sections — empty in CE.
 */
export const coreEditorAdditionalSlashCommandOptions = (props: Props): TSlashCommandAdditionalOption[] => {
  const {} = props;
  const options: TSlashCommandAdditionalOption[] = [];
  return options;
};
