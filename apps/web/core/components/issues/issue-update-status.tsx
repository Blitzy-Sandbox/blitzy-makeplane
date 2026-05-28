/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compact "Saving…" / "Saved" indicator used by editable work item fields (title, description).
 *
 * Rendered purpose: a tiny status row with a spinning `RefreshCw` icon while a write is in flight and a
 * static "Saved" label after completion, with a fade-in / fade-out transition controlled by the
 * `isSubmitting` state.
 *
 * Props:
 *   - isSubmitting (TNameDescriptionLoader, required): "submitting" | "submitted" | "saved" — the spinner is
 *     shown for any state other than "submitted" / "saved"; the label switches between "Saving…" and "Saved"
 *
 * MobX stores read: none — pure UI primitive that reflects the caller-supplied loader state.
 *
 * Side effects: none.
 *
 * Derived state notes:
 *   - `TNameDescriptionLoader` from `@plane/types` enumerates the loader states; this component fans them out
 *     into spinner visibility and label text.
 *
 * Consumers: rendered next to editable name/description fields on issue-detail surfaces — e.g.,
 * `apps/web/core/components/issues/issue-detail/main-content.tsx`, peek-overview header, and modal
 * create/edit issue flows that share the `useNameDescriptionUpdate` debounced-save pattern.
 */
import React from "react";
import { observer } from "mobx-react";
import { RefreshCw } from "lucide-react";
// types
import type { TNameDescriptionLoader } from "@plane/types";

type Props = {
  isSubmitting: TNameDescriptionLoader;
};

export const NameDescriptionUpdateStatus = observer(function NameDescriptionUpdateStatus(props: Props) {
  const { isSubmitting } = props;

  return (
    <>
      <div
        className={`flex items-center gap-x-2 transition-all duration-300 ${
          isSubmitting === "saved" ? "fade-out" : "fade-in"
        }`}
      >
        {isSubmitting !== "submitted" && isSubmitting !== "saved" && (
          <RefreshCw className="size-3.5 animate-spin stroke-tertiary" />
        )}
        <span className="text-13 text-tertiary">{isSubmitting === "submitting" ? "Saving..." : "Saved"}</span>
      </div>
    </>
  );
});
