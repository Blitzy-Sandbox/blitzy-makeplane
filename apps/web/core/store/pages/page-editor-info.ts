/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Editor runtime coordination state — ephemeral, NOT persisted. This MobX class
 * owns the live editor reference and the current asset attachment list for a
 * single page. It exists so that toolbars, floating menus, and asset uploaders
 * can observe and mutate editor-side state without reaching into the TipTap
 * editor instance directly.
 *
 * IMPORTANT: This state is intentionally ephemeral — it is reset every time the
 * page detail view mounts and is never sent to the server. Do NOT add persistent
 * fields here; they belong on `BasePage` (page metadata) or in the editor's own
 * collaborative document (Y.Doc).
 *
 * State slice (observables registered via `makeObservable`):
 *   - editorRef: EditorRefApi | null — `observable.ref`; assigned in the editor component's `useImperativeHandle` setup once the TipTap editor is mounted, and cleared on unmount. Consumers read this to call imperative editor methods (focus, scrollToHeading, blur, executeMenuItemCommand, etc.) exposed by `@plane/editor`.
 *   - assetsList: TEditorAsset[] — plain `observable`; tracks files/images currently attached to the page. Mutated whenever the asset uploader registers a new asset or removes one. Consumed by the page header's attachment indicator and any future asset gallery UI.
 *
 * Actions (registered as `action` in `makeObservable`):
 *   - setEditorRef(editorRef) — `runInAction`-wrapped setter; called once by the page editor component when the imperative handle becomes available.
 *   - updateAssetsList(assets) — `runInAction`-wrapped setter; replaces the asset list wholesale (callers compute the new array externally rather than mutating in place).
 *
 * Exported symbols:
 *   - TPageEditorInstance — type contract on the ephemeral state slice + setters.
 *   - PageEditorInstance — concrete class instantiated exactly once per `BasePage` via `this.editor = new PageEditorInstance()` in the `BasePage` constructor.
 *
 * Consumers:
 *   - apps/web/core/store/pages/base-page.ts — owns one `PageEditorInstance` per page (`editor: PageEditorInstance`). The `BasePage` class itself does not read `editorRef` / `assetsList`; it merely exposes the sub-store.
 *   - apps/web/core/components/pages/editor/** — toolbar, header, summary, floating menus read `editor.editorRef` to invoke imperative editor commands (heading toggles, formatting marks, comment insertion, etc.) and `editor.assetsList` to render attachment counts / previews.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
// plane imports
import type { EditorRefApi, TEditorAsset } from "@plane/editor";

export type TPageEditorInstance = {
  // observables
  assetsList: TEditorAsset[];
  editorRef: EditorRefApi | null;
  // actions
  setEditorRef: (editorRef: EditorRefApi | null) => void;
  updateAssetsList: (assets: TEditorAsset[]) => void;
};

export class PageEditorInstance implements TPageEditorInstance {
  // observables
  editorRef: EditorRefApi | null = null;
  assetsList: TEditorAsset[] = [];

  constructor() {
    makeObservable(this, {
      // observables
      editorRef: observable.ref,
      assetsList: observable,
      // actions
      setEditorRef: action,
      updateAssetsList: action,
    });
  }

  setEditorRef: TPageEditorInstance["setEditorRef"] = (editorRef) => {
    runInAction(() => {
      this.editorRef = editorRef;
    });
  };

  updateAssetsList: TPageEditorInstance["updateAssetsList"] = (assets) => {
    runInAction(() => {
      this.assetsList = assets;
    });
  };
}
