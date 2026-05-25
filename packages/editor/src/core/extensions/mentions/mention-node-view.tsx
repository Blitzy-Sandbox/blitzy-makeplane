/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * React node view for mention nodes — the chip-style renderer mounted by
 * `ReactNodeViewRenderer` in `extension.tsx`.
 *
 * This component does not render the chip's content itself; it delegates to
 * `extension.options.renderComponent`, a caller-injected renderer from `TMentionHandler`
 * (web app, live editor, etc.). That handoff keeps the editor package free of
 * application-specific avatar/icon coupling.
 */

import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
// extension config
import type { TMentionExtensionOptions } from "./extension-config";
// extension types
import type { TMentionComponentAttributes } from "./types";
import { EMentionComponentAttributeNames } from "./types";

/**
 * Mention-specific narrowing of TipTap's `NodeViewProps`: `node.attrs` is typed as
 * `TMentionComponentAttributes` (`id`, `entity_identifier`, `entity_name`) instead of
 * the upstream loose attribute record. Consumed by `MentionNodeView` and by the inline
 * cast in `extension.tsx`'s `addNodeView()` to satisfy TypeScript.
 */
export type MentionNodeViewProps = NodeViewProps & {
  node: NodeViewProps["node"] & {
    attrs: TMentionComponentAttributes;
  };
};

/**
 * Render a mention node as an inline interactive chip.
 *
 * Reads the three Plane-specific attributes from `node.attrs` (`id`, `entity_identifier`,
 * `entity_name`) and forwards `entity_identifier` + `entity_name` to the consumer-supplied
 * `renderComponent` callback. The actual visual element (user avatar + display name, project
 * icon + name, etc.) is produced by the caller — typically a Plane web/live component that
 * resolves the identifier against application state and renders an avatar/badge.
 *
 * Wraps the result in `<NodeViewWrapper className="mention-component inline w-fit">` so the
 * chip flows inline with surrounding text and is the minimum width needed for its contents.
 *
 * Defensive defaults — when an attribute is null (e.g., a mention round-tripped through HTML
 * that lost an attribute), `entity_identifier` falls back to the empty string and
 * `entity_name` falls back to `"user_mention"`. This prevents the consumer renderer from
 * receiving `null` values that would crash downstream lookups.
 *
 * Side effects on click: NONE in this component. Click handling (e.g., navigating to the
 * mentioned entity's detail page) is the responsibility of the consumer's `renderComponent`
 * implementation; the node view layer is purely presentational.
 *
 * Accessibility: keyboard focus and ARIA semantics are likewise the responsibility of the
 * consumer's chip implementation. The wrapper here adds no roles or interactive handlers.
 *
 * @param props - `MentionNodeViewProps`: TipTap node-view props narrowed for mention attrs.
 */
export function MentionNodeView(props: MentionNodeViewProps) {
  const {
    extension,
    node: { attrs },
  } = props;

  return (
    <NodeViewWrapper key={attrs[EMentionComponentAttributeNames.ID]} className="mention-component inline w-fit">
      {(extension.options as TMentionExtensionOptions).renderComponent({
        entity_identifier: attrs[EMentionComponentAttributeNames.ENTITY_IDENTIFIER] ?? "",
        entity_name: attrs[EMentionComponentAttributeNames.ENTITY_NAME] ?? "user_mention",
      })}
    </NodeViewWrapper>
  );
}
