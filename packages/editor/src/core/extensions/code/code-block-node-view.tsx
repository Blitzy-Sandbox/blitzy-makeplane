/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * React node view for the editor's code-block extension.
 *
 * Used by `./index.tsx` `CustomCodeBlockExtension.addNodeView()` via
 * `ReactNodeViewRenderer`. Renders the code-block container chrome
 * (rounded background, padding, hover-revealed copy button) around
 * TipTap's `<NodeViewContent>` which receives the syntax-highlighted
 * `<code>` text content. Lowlight applies decorations to the
 * `<NodeViewContent>` through the `LowlightPlugin` registered by
 * `code-block-lowlight.ts`.
 *
 * NOT used by `./without-props.tsx` — that variant omits `addNodeView`
 * and falls back to default DOM rendering.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import ts from "highlight.js/lib/languages/typescript";
import { common, createLowlight } from "lowlight";
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { CopyIcon } from "@plane/propel/icons";
// ui
import { Tooltip } from "@plane/propel/tooltip";
// plane utils
import { cn } from "@plane/utils";
// types
import type { TCodeBlockAttributes } from "./types";
import { ECodeBlockAttributeNames } from "./types";

// we just have ts support for now
const lowlight = createLowlight(common);
lowlight.register("ts", ts);

/**
 * Props for `CodeBlockComponent`.
 *
 * Only the `node` from `NodeViewProps` is destructured; other TipTap
 * NodeView props (editor, getPos, updateAttributes, deleteNode, etc.)
 * are unused by this component because the only writable interaction
 * is the copy-to-clipboard action which reads node text without
 * mutating attributes.
 */
type Props = {
  node: ProseMirrorNode;
};

/**
 * Renders the editor's code block container chrome (rounded background,
 * padding, hover-revealed copy button) around TipTap's
 * `<NodeViewContent as="code">`. The `<code>` content itself is
 * managed and syntax-highlighted by ProseMirror + lowlight via the
 * `LowlightPlugin`; this component only owns the surrounding UI.
 *
 * Side effects:
 *   - `copyToClipboard` writes `node.textContent` (text nodes only — no
 *     formatting, no language metadata) to the system clipboard via
 *     `navigator.clipboard.writeText`, then flips a 1s visual "copied"
 *     indicator. Errors (e.g. clipboard permission denied) fall back to
 *     the default un-copied state.
 *   - `e.preventDefault()` + `e.stopPropagation()` on the copy button
 *     prevents the click bubbling into ProseMirror as a selection event.
 *
 * State: local `useState<boolean>` `copied` flag — no MobX stores read.
 * The component does NOT call `updateAttributes`; the code block's
 * `language` attribute is set elsewhere (input rule / paste handling).
 *
 * Accessibility:
 *   - Native `<button type="button">` is keyboard-focusable and
 *     activatable via Tab + Enter/Space.
 *   - `<Tooltip tooltipContent="Copy code">` from `@plane/propel/tooltip`
 *     supplies the descriptive tooltip; ARIA wiring is handled by the
 *     Tooltip component.
 *
 * Rendered by `CustomCodeBlockExtension.addNodeView()` in `./index.tsx`
 * via `ReactNodeViewRenderer`. Not used by `./without-props.tsx`.
 *
 * @param props - See {@link Props}; only `node` is consumed.
 */
export function CodeBlockComponent({ node }: Props) {
  const [copied, setCopied] = useState(false);
  // derived values
  const attrs = node.attrs as TCodeBlockAttributes;

  const copyToClipboard = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      setCopied(false);
    }
    // preventDefault + stopPropagation block ProseMirror from treating the
    // click as a code-block text selection — the copy button is non-content UI.
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <NodeViewWrapper key={attrs[ECodeBlockAttributeNames.ID]} className="code-block group/code relative">
      <Tooltip tooltipContent="Copy code">
        <button
          type="button"
          className={cn(
            "group/button absolute top-2 right-2 z-10 hidden size-8 items-center justify-center rounded-md border border-subtle bg-layer-1 backdrop-blur-sm transition duration-150 ease-in-out group-hover/code:flex",
            {
              "bg-success-subtle hover:bg-success-subtle-1 active:bg-success-subtle-1": copied,
            }
          )}
          onClick={(e) => void copyToClipboard(e)}
        >
          {copied ? (
            <CheckIcon className="h-3 w-3 text-success-primary" strokeWidth={3} />
          ) : (
            <CopyIcon className="h-3 w-3 text-tertiary group-hover/button:text-primary" />
          )}
        </button>
      </Tooltip>

      <pre className="my-2 rounded-lg bg-layer-3 p-4 text-primary">
        <NodeViewContent as="code" className="whitespace-pre-wrap" />
      </pre>
    </NodeViewWrapper>
  );
}
