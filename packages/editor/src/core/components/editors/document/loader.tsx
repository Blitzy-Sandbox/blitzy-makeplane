/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Loading-skeleton module for the document-editor.
 *
 * Provides `DocumentContentLoader`, the deterministic placeholder shown by
 * `PageRenderer` while the editor is initializing or while waiting for
 * collaboration sync. Built from `@plane/ui` loader primitives — renders a
 * document-shaped placeholder of variable-width rows to mimic headings,
 * paragraphs, and avatar/control rows.
 */

// plane imports
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";

type Props = {
  className?: string;
};

/**
 * Deterministic loading skeleton for the document-editor surface.
 *
 * Renders multiple `Loader.Item` rows of varying widths and heights to mimic
 * headings, paragraphs, and avatar/control rows; used by `PageRenderer` while
 * the editor is initializing or while collaboration sync / fallback binary
 * backfill is pending.
 *
 * Props are typed by the local `Props` alias — see its declaration.
 *
 * Purely presentational: no API calls, no state, no DOM mutation outside its
 * own render tree.
 *
 * Consumed by `./page-renderer.tsx` whenever `isLoading === true`.
 */
export function DocumentContentLoader(props: Props) {
  const { className } = props;

  return (
    <div className={cn("document-editor-loader", className)}>
      <Loader className="relative space-y-4">
        <div className="space-y-2">
          <div className="py-2">
            <Loader.Item width="100%" height="36px" />
          </div>
          <Loader.Item width="80%" height="22px" />
          <div className="relative flex items-center gap-2">
            <Loader.Item width="30px" height="30px" />
            <Loader.Item width="30%" height="22px" />
          </div>
          <div className="py-2">
            <Loader.Item width="60%" height="36px" />
          </div>
          <Loader.Item width="70%" height="22px" />
          <Loader.Item width="30%" height="22px" />
          <div className="relative flex items-center gap-2">
            <Loader.Item width="30px" height="30px" />
            <Loader.Item width="30%" height="22px" />
          </div>
          <div className="py-2">
            <Loader.Item width="50%" height="30px" />
          </div>
          <Loader.Item width="100%" height="22px" />
          <div className="py-2">
            <Loader.Item width="30%" height="30px" />
          </div>
          <Loader.Item width="30%" height="22px" />
          <div className="relative flex items-center gap-2">
            <div className="py-2">
              <Loader.Item width="30px" height="30px" />
            </div>
            <Loader.Item width="30%" height="22px" />
          </div>
        </div>
      </Loader>
    </div>
  );
}
