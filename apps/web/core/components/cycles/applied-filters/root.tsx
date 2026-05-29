/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX-observed root that renders the cycle list's "applied filters" strip — one
 * removable chip per applied filter key (status, start_date, end_date) plus a
 * single clear-all affordance, gated by project-level edit permission unless the
 * caller forces editing on.
 *
 * Props:
 *   - appliedFilters (TCycleFilters, required): the currently applied filter slice
 *     keyed by filter name (status, start_date, end_date) → array of selected values.
 *     A null / empty object short-circuits rendering to `null`.
 *   - handleClearAllFilters (() => void, required): caller-owned callback invoked when
 *     the user clicks the "Clear all" chip; typically wired to the cycle-filter
 *     store's reset action in the parent route.
 *   - handleRemoveFilter ((key, value) => void, required): caller-owned callback
 *     invoked when the user removes either a single value (passed as `value`) or
 *     the entire filter group (passed with `value = null`).
 *   - alwaysAllowEditing (boolean, optional): when true, bypasses the
 *     useUserPermissions check and always renders remove + clear-all controls — used
 *     by views (e.g., archived cycles) where the caller has already gated edit
 *     access at a higher level.
 *
 * MobX stores read:
 *   - useUserPermissions (user permissions store): allowPermissions(ADMIN | MEMBER,
 *     PROJECT) — gates remove + clear-all controls behind project-level edit access
 *     unless `alwaysAllowEditing` overrides.
 *
 * Side effects:
 *   - None directly — all mutations are delegated to the parent via the prop
 *     callbacks (handleClearAllFilters, handleRemoveFilter). No service calls, no
 *     navigations, no toasts. The store actions live in the consumer route.
 *
 * Composition:
 *   - Delegates the `status` filter key to `AppliedStatusFilters` (./status).
 *   - Delegates `start_date` / `end_date` keys (DATE_FILTERS) to `AppliedDateFilters`
 *     (./date).
 *
 * Consumers: cycle list / archived-cycle list routes that surface an applied-filters
 * strip above the cycles grid.
 */
import { observer } from "mobx-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { CloseIcon } from "@plane/propel/icons";
import type { TCycleFilters } from "@plane/types";
import { Tag } from "@plane/ui";
import { replaceUnderscoreIfSnakeCase } from "@plane/utils";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { AppliedDateFilters } from "./date";
import { AppliedStatusFilters } from "./status";

type Props = {
  appliedFilters: TCycleFilters;
  handleClearAllFilters: () => void;
  handleRemoveFilter: (key: keyof TCycleFilters, value: string | null) => void;
  alwaysAllowEditing?: boolean;
};

const DATE_FILTERS = ["start_date", "end_date"];

export const CycleAppliedFiltersList = observer(function CycleAppliedFiltersList(props: Props) {
  const { appliedFilters, handleClearAllFilters, handleRemoveFilter, alwaysAllowEditing } = props;
  // store hooks
  const { allowPermissions } = useUserPermissions();
  const { t } = useTranslation();

  if (!appliedFilters) return null;

  if (Object.keys(appliedFilters).length === 0) return null;

  const isEditingAllowed =
    alwaysAllowEditing ||
    allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT);

  return (
    <div className="flex flex-wrap items-stretch gap-2 bg-surface-1">
      {Object.entries(appliedFilters).map(([key, value]) => {
        const filterKey = key as keyof TCycleFilters;

        if (!value) return;
        if (Array.isArray(value) && value.length === 0) return;

        return (
          <Tag key={filterKey}>
            <span className="text-11 text-tertiary">{replaceUnderscoreIfSnakeCase(filterKey)}</span>
            <div className="flex flex-wrap items-center gap-1">
              {filterKey === "status" && (
                <AppliedStatusFilters
                  editable={isEditingAllowed}
                  handleRemove={(val) => handleRemoveFilter("status", val)}
                  values={value}
                />
              )}
              {DATE_FILTERS.includes(filterKey) && (
                <AppliedDateFilters
                  editable={isEditingAllowed}
                  handleRemove={(val) => handleRemoveFilter(filterKey, val)}
                  values={value}
                />
              )}
              {isEditingAllowed && (
                <button
                  type="button"
                  className="grid place-items-center text-tertiary hover:text-secondary"
                  onClick={() => handleRemoveFilter(filterKey, null)}
                >
                  <CloseIcon height={12} width={12} strokeWidth={2} />
                </button>
              )}
            </div>
          </Tag>
        );
      })}
      {isEditingAllowed && (
        <button type="button" onClick={handleClearAllFilters}>
          <Tag>
            {t("common.clear_all")}
            <CloseIcon height={12} width={12} strokeWidth={2} />
          </Tag>
        </button>
      )}
    </div>
  );
});
