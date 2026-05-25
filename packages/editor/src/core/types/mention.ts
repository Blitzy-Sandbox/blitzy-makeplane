/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Type contracts for the editor's mention extension: the shape of an
 * individual suggestion row, the grouped sections that back the suggestion
 * dropdown, the minimal identity pair stored on every inserted mention
 * node, and the handler interface that consumer applications pass into
 * the editor to wire mention search and rendering.
 *
 * Every symbol exported here is part of the public `@plane/editor` API
 * surface — re-exported via `export * from "./mention"` in
 * `packages/editor/src/core/types/index.ts`, which is itself re-exported
 * from the package barrel through `export * from "@/types"` in
 * `packages/editor/src/index.ts`.
 *
 * Consumers: `core/extensions/mentions/` — `extension.tsx`,
 * `extension-config.ts`, `mentions-list-dropdown.tsx`, and `utils.ts` all
 * import these types from `@/types`.
 */

// plane types
import type { TSearchEntities } from "@plane/types";

/**
 * Shape of a single mention suggestion row rendered inside the mention
 * dropdown.
 *
 * The two id fields are intentionally distinct and serve different layers:
 *   - `id` is the React list-row identity used for stable rendering and
 *     selection inside the dropdown component itself; it may collide with
 *     entity ids across heterogeneous sections and is not persisted.
 *   - `entity_identifier` is the persistent identifier of the backing
 *     entity (user, work item, project, cycle, module, or page) and is
 *     what gets serialized onto the inserted mention node so the entity
 *     can be re-resolved at render time.
 *
 * `entity_name` is the union discriminant (`TSearchEntities`) that tells
 * consumer renderers which kind of entity is being mentioned, so a single
 * mention extension can drive heterogeneous suggestion lists without
 * baking branch logic into the editor core.
 *
 * `icon` is a pre-rendered React node — never a URL or icon-name string —
 * so the consumer keeps full control of the icon component (theming,
 * sizing, fallback handling). `subTitle?` is an optional supplementary
 * line beneath `title` (for example the email under a username) and is
 * display-only.
 */
export type TMentionSuggestion = {
  entity_identifier: string;
  entity_name: TSearchEntities;
  icon: React.ReactNode;
  id: string;
  subTitle?: string;
  title: string;
};

/**
 * A labeled group of suggestions shown in the mention dropdown (for
 * example "Users", "Work items", or "Recent").
 *
 * `title?` is optional so the section can render without a visible header
 * when used for an unlabeled grouping such as a default or recent-items
 * row. `key` is required because the dropdown uses it as the React list
 * key when sections reorder between keystrokes — using `title` instead
 * would break stable rendering for unlabeled sections and for sections
 * that happen to share a title.
 */
export type TMentionSection = {
  key: string;
  title?: string;
  items: TMentionSuggestion[];
};

/**
 * Minimal identity pair (`entity_identifier`, `entity_name`) passed to
 * consumer-supplied mention renderers when an inserted mention node is
 * drawn on screen.
 *
 * The `title`, `icon`, and `subTitle` from the original
 * `TMentionSuggestion` are deliberately excluded because the editor
 * stores only this identity pair on the inserted ProseMirror mention
 * node. Downstream presentation (display name, icon, subtitle) is
 * re-resolved at render time via
 * `TMentionHandler.getMentionedEntityDetails` so that stale display data
 * never gets baked into the persisted document.
 */
export type TCallbackMentionComponentProps = Pick<TMentionSuggestion, "entity_identifier" | "entity_name">;

/**
 * Handler contract supplied by consumer applications when wiring the
 * mention extension into an editor variant (passed through
 * `IEditorProps.mentionHandler`).
 *
 * Optional callbacks carry behavioral implications:
 *   - `getMentionedEntityDetails?` — when supplied, the editor re-resolves
 *     a mention's display name from its `entity_identifier` at render
 *     time, which keeps mentions live as the underlying entity's name
 *     changes (for example a renamed user). When omitted, every inserted
 *     mention node renders with whatever display name it had at insertion
 *     time and will drift out of sync if the entity is later renamed.
 *   - `searchCallback?` — when supplied, the mention dropdown invokes it
 *     on every query keystroke and uses the returned sections as the
 *     live suggestion list. When omitted, the dropdown has no data
 *     source: mentions can still be inserted programmatically, but
 *     typing `@` will not produce a populated picker.
 *
 * `renderComponent` is required because every inserted mention node
 * delegates its visual representation entirely to the consumer (icon,
 * label, hover surface, click target); the editor itself does not own
 * any default mention DOM.
 *
 * Consumers: `core/extensions/mentions/extension.tsx`,
 * `extension-config.ts`, `mentions-list-dropdown.tsx`, and `utils.ts`.
 */
export type TMentionHandler = {
  getMentionedEntityDetails?: (entity_identifier: string) => { display_name: string } | undefined;
  renderComponent: (props: TCallbackMentionComponentProps) => React.ReactNode;
  searchCallback?: (query: string) => Promise<TMentionSection[]>;
};
