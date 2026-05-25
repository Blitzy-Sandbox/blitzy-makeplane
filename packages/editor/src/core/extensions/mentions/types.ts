/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Mention attribute type contracts — the typed surface shared between the schema config
 * (`./extension-config.ts`), the React node view (`./mention-node-view.tsx`), and the
 * markdown/text serializers.
 *
 * These types are the single source of truth for the three Plane-specific mention
 * attributes (`id`, `entity_identifier`, `entity_name`) and they are deliberately kept
 * separate from `@/core/types/mention.ts` (which holds suggestion/handler types) to
 * avoid a circular dependency between the schema layer and the handler/UI layer.
 *
 * Why ID and ENTITY_IDENTIFIER are both present:
 *   - `ID` is the ProseMirror-attribute id rotated per-insertion (set to a fresh UUID
 *     in `mentions-list-dropdown.tsx` on selection) — used as the node key.
 *   - `ENTITY_IDENTIFIER` is the stable application-level entity reference (user id,
 *     project id, etc.) — used by `renderComponent` and `getMentionedEntityDetails`.
 */

// plane types
import type { TSearchEntities } from "@plane/types";

/**
 * Canonical attribute names persisted on every mention node in the ProseMirror schema.
 *
 * Used as object keys in `addAttributes`/`parseHTML`/`renderHTML` (extension-config.ts)
 * and as accessor keys in the React node view (mention-node-view.tsx). Using an enum
 * (rather than string literals) keeps the schema config and the node view in lockstep —
 * renaming a key here ripples through every consumer at compile time.
 *
 * Values:
 *   - `ID = "id"` — per-insertion UUID, regenerated on every mention selection.
 *   - `ENTITY_IDENTIFIER = "entity_identifier"` — stable reference to the mentioned
 *     application entity (user id, project id, etc.).
 *   - `ENTITY_NAME = "entity_name"` — entity type discriminant (`TSearchEntities`,
 *     e.g. `"user_mention"`, `"project"`); dispatches the chip renderer.
 */
export enum EMentionComponentAttributeNames {
  ID = "id",
  ENTITY_IDENTIFIER = "entity_identifier",
  ENTITY_NAME = "entity_name",
}

/**
 * Strongly-typed shape of `node.attrs` for a mention node.
 *
 * Field semantics:
 *   - `id` (string | null) — per-insertion UUID; nullable because HTML parsed without
 *     this attribute (legacy content, stripped serialization) should not crash the
 *     node view.
 *   - `entity_identifier` (string | null) — application entity id; nullable for the
 *     same reason. When null, the consumer's `renderComponent` receives the empty
 *     string (see `mention-node-view.tsx`).
 *   - `entity_name` (TSearchEntities | null) — union discriminant from `@plane/types`
 *     used to choose the right chip variant. Defaults to `"user_mention"` in the node
 *     view when null, so the renderer always receives a defined entity type.
 *
 * The "all-nullable" model is intentional: it allows HTML produced by older versions
 * of the editor (or by external sources like notification emails) to round-trip
 * without throwing, even when one or more attributes are missing.
 */
export type TMentionComponentAttributes = {
  [EMentionComponentAttributeNames.ID]: string | null;
  [EMentionComponentAttributeNames.ENTITY_IDENTIFIER]: string | null;
  [EMentionComponentAttributeNames.ENTITY_NAME]: TSearchEntities | null;
};
