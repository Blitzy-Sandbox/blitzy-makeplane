/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Runtime React-NodeView wiring for the work-item-embed custom node.
 *
 * Bridges the editor's ProseMirror document model and the host application's work-item card UI. Extends
 * the schema-only `WorkItemEmbedExtensionConfig` (from `./extension-config`) by adding a React
 * `addNodeView()`. The schema lives in the sibling config file — which is ALSO consumed by
 * `core-without-props.ts` for non-React render paths (e.g., `apps/live` PDF export and Y.Doc binary→HTML
 * conversion in `yjs-utils.ts`).
 *
 * First-party origin: the underlying node is a custom ProseMirror node (`Node.create(...)` in
 * `./extension-config.ts`), NOT a wrapper around an upstream `@tiptap/extension-*` package. The
 * conventional "Exposes / Overrides / Hides" triplet used to document third-party TipTap wrappers does
 * NOT apply here; this module instead documents the cross-package NodeView injection contract and the
 * schema-vs-runtime split.
 *
 * Cross-package NodeView injection: the React card UI is NOT bundled in `@plane/editor`. The host app
 * injects it as `widgetCallback`, conforming to `TIssueEmbedConfig.widgetCallback` declared in
 * `packages/editor/src/ce/types/issue-embed.ts`. The host app's `useIssueEmbed` hook
 * (`apps/web/ce/hooks/use-issue-embed.tsx`) supplies the callback, which resolves to
 * `IssueEmbedUpgradeCard` (CE) or a richer interactive issue card (EE). This boundary exists because the
 * card needs MobX store access from the host app, which `@plane/editor` intentionally does not depend on.
 *
 * The extended node is registered under `CORE_EXTENSIONS.WORK_ITEM_EMBED` (string `"issue-embed-component"`).
 */

import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
// local imports
import { WorkItemEmbedExtensionConfig } from "./extension-config";
import type { TWorkItemEmbedAttributes } from "./types";
import { EWorkItemEmbedAttributeNames } from "./types";

/**
 * Local input contract for the {@link WorkItemEmbedExtension} factory.
 *
 * The single `widgetCallback` field is the host-app-provided renderer for the work-item card UI; it is
 * invoked by the React NodeView each time TipTap mounts or re-renders a work-item-embed node.
 *
 * The factory passes three values to `widgetCallback`:
 * - `issueId`: from node attribute `ENTITY_IDENTIFIER`; falls back to `""` when absent so the host app
 *   can fail-soft instead of receiving `undefined`.
 * - `projectId`: from node attribute `PROJECT_IDENTIFIER`; may be `undefined` (e.g., cross-project paste).
 * - `workspaceSlug`: from node attribute `WORKSPACE_IDENTIFIER`; may be `undefined` (e.g., cross-workspace
 *   paste).
 *
 * Expected return: a `React.ReactNode` — the rendered card. Implemented by the host app, e.g.
 * `apps/web/ce/hooks/use-issue-embed.tsx`, conforming to `TIssueEmbedConfig.widgetCallback` in
 * `packages/editor/src/ce/types/issue-embed.ts`.
 */
type Props = {
  widgetCallback: ({
    issueId,
    projectId,
    workspaceSlug,
  }: {
    issueId: string;
    projectId: string | undefined;
    workspaceSlug: string | undefined;
  }) => React.ReactNode;
};

/**
 * Factory that produces a runtime TipTap extension for embedded work-item nodes.
 *
 * Calls `WorkItemEmbedExtensionConfig.extend(...)` to inherit the schema (`block` group, `atom: true`,
 * `selectable`, `draggable`, attributes, `parseHTML`, `renderHTML`) from the sibling config, then adds an
 * `addNodeView()` hook returning a `ReactNodeViewRenderer`. The renderer reads `issueProps.node.attrs`
 * (cast to `TWorkItemEmbedAttributes`) and forwards `issueId`/`projectId`/`workspaceSlug` to the supplied
 * `widgetCallback`. The wrapper is keyed by the node's `ID` attribute (a per-instance id, distinct from
 * `ENTITY_IDENTIFIER` which is the issue id) to enable correct React reconciliation across reorderings.
 *
 * Insertion: the inherited schema does NOT declare a custom `addCommands()`, so consumers insert
 * work-item-embed nodes via TipTap's generic
 * `editor.chain().insertContent({ type: CORE_EXTENSIONS.WORK_ITEM_EMBED, attrs: { id, entity_identifier,
 * project_identifier, workspace_identifier, entity_name } })` or via paste/import of HTML containing the
 * `<issue-embed-component …>` tag. There is no typed `insertWorkItemEmbed(...)` command on this factory;
 * call sites compose insertion through these generic primitives.
 *
 * Non-React render paths (server-side / PDF export in `apps/live`, Y.Doc binary→HTML/JSON conversion in
 * `packages/editor/src/core/helpers/yjs-utils.ts`) bypass this factory entirely and use the schema-only
 * `WorkItemEmbedExtensionConfig` directly via `core-without-props.ts`. This schema-vs-runtime split is
 * intentional and load-bearing.
 *
 * @param props - See {@link Props}; only `widgetCallback` is required.
 * @returns A TipTap `Node` extension produced via `WorkItemEmbedExtensionConfig.extend(...)` with a React
 *   NodeView attached. The return type is inferred from `Node.extend(...)`; do not annotate explicitly.
 */
export function WorkItemEmbedExtension(props: Props) {
  return WorkItemEmbedExtensionConfig.extend({
    addNodeView() {
      return ReactNodeViewRenderer((issueProps: NodeViewProps) => {
        const attrs = issueProps.node.attrs as TWorkItemEmbedAttributes;
        return (
          <NodeViewWrapper key={attrs[EWorkItemEmbedAttributeNames.ID]}>
            {props.widgetCallback({
              issueId: attrs[EWorkItemEmbedAttributeNames.ENTITY_IDENTIFIER] ?? "",
              projectId: attrs[EWorkItemEmbedAttributeNames.PROJECT_IDENTIFIER],
              workspaceSlug: attrs[EWorkItemEmbedAttributeNames.WORKSPACE_IDENTIFIER],
            })}
          </NodeViewWrapper>
        );
      });
    },
  });
}
