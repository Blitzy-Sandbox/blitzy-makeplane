/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Subscribe/unsubscribe toggle button for the issue detail header.
 *
 * Rendered purpose: a small button with `Bell`/`BellOff` icon and "Subscribe"/"Unsubscribe" label
 * (responsive copy on small screens) that toggles the current user's subscription to the active
 * work item. Renders a skeleton `Loader.Item` while the subscription state has not been resolved.
 *
 * Props (TIssueSubscription, exported):
 *   - workspaceSlug (string, required): scopes the subscription mutation
 *   - projectId (string, required): scopes the subscription mutation and permission check
 *   - issueId (string, required): the work item to subscribe to / unsubscribe from
 *   - serviceType (EIssueServiceType, optional, default=ISSUES): selects which issue-detail
 *     hook namespace to call (ISSUES vs EPICS), so the same component can drive both surfaces
 *
 * MobX stores read:
 *   - `useIssueDetail(serviceType)` — `subscription.getSubscriptionByIssueId(issueId)`,
 *     `createSubscription`, `removeSubscription`
 *   - `useUserPermissions()` — `allowPermissions([ADMIN, MEMBER], PROJECT, ...)` to disable the button
 *     for users without sufficient project role
 *
 * Side effects:
 *   - Mutations: `createSubscription(workspaceSlug, projectId, issueId)` or
 *     `removeSubscription(workspaceSlug, projectId, issueId)` (the store action internally posts to
 *     the issue-subscriber endpoint in `apps/api`).
 *   - Toast emissions: success ("Subscribed"/"Unsubscribed") or error variant via
 *     `setToast(...)` from `@plane/propel/toast`, with i18n-keyed messages.
 *   - Local `loading` state guards against double-clicks during the in-flight mutation.
 *
 * Derived state notes:
 *   - `isNil(isSubscribed)` distinguishes "subscription state not yet fetched" (renders the skeleton)
 *     from "fetched, currently false" (renders the Subscribe variant).
 *   - The button is disabled both when `!isEditable` (no project role) and during `loading`.
 *
 * Consumers:
 *   - `./issue-detail-quick-actions.tsx` — rendered in the issue-detail header quick-actions row
 *     (work-item / epic detail page)
 *   - `../peek-overview/header.tsx` — rendered in the peek-overview header alongside other
 *     quick-action buttons
 */

import { useState } from "react";
import { isNil } from "lodash-es";
import { observer } from "mobx-react";
import { Bell, BellOff } from "lucide-react";
// plane-i18n
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// UI
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EIssueServiceType } from "@plane/types";
import { Loader } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUserPermissions } from "@/hooks/store/user";

export type TIssueSubscription = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  serviceType?: EIssueServiceType;
};

export const IssueSubscription = observer(function IssueSubscription(props: TIssueSubscription) {
  const { workspaceSlug, projectId, issueId, serviceType = EIssueServiceType.ISSUES } = props;
  const { t } = useTranslation();
  // hooks
  const {
    subscription: { getSubscriptionByIssueId },
    createSubscription,
    removeSubscription,
  } = useIssueDetail(serviceType);
  // state
  const [loading, setLoading] = useState(false);
  // hooks
  const { allowPermissions } = useUserPermissions();

  const isSubscribed = getSubscriptionByIssueId(issueId);
  const isEditable = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );

  const handleSubscription = async () => {
    setLoading(true);
    try {
      if (isSubscribed) await removeSubscription(workspaceSlug, projectId, issueId);
      else await createSubscription(workspaceSlug, projectId, issueId);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("toast.success"),
        message: isSubscribed
          ? t("issue.subscription.actions.unsubscribed")
          : t("issue.subscription.actions.subscribed"),
      });
      setLoading(false);
    } catch {
      setLoading(false);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: t("common.error.message"),
      });
    }
  };

  if (isNil(isSubscribed))
    return (
      <Loader>
        <Loader.Item width="106px" height="28px" />
      </Loader>
    );

  return (
    <div>
      <Button
        prependIcon={isSubscribed ? <BellOff /> : <Bell className="h-3 w-3" />}
        variant="secondary"
        className="hover:!bg-accent-primary/20"
        onClick={handleSubscription}
        disabled={!isEditable || loading}
        size="lg"
      >
        {loading ? (
          <span>
            <span className="hidden sm:block">{t("common.loading")}</span>
          </span>
        ) : isSubscribed ? (
          <div className="hidden sm:block">{t("common.actions.unsubscribe")}</div>
        ) : (
          <div className="hidden sm:block">{t("common.actions.subscribe")}</div>
        )}
      </Button>
    </div>
  );
});
