/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Subscription tier catalog, billing-frequency defaults, and upgrade/marketing
 * URL maps consumed by CE billing and license surfaces under
 * `apps/web/ce/components/{workspace/billing,license/modal}/**` and
 * `apps/web/core/components/license/modal/**`.
 */

import type { IPaymentProduct, TBillingFrequency, TProductBillingFrequency } from "@plane/types";
import { EProductSubscriptionEnum } from "@plane/types";

/**
 * Default billing frequency per subscription tier; `FREE`/`ONE` are non-recurring
 * and paid tiers default to monthly to anchor the UI toggle on the lower-commitment option.
 *
 * Consumers: `apps/web/ce/components/workspace/billing/root.tsx`.
 */
export const DEFAULT_PRODUCT_BILLING_FREQUENCY: TProductBillingFrequency = {
  [EProductSubscriptionEnum.FREE]: undefined,
  [EProductSubscriptionEnum.ONE]: undefined,
  [EProductSubscriptionEnum.PRO]: "month",
  [EProductSubscriptionEnum.BUSINESS]: "month",
  [EProductSubscriptionEnum.ENTERPRISE]: "month",
};

/**
 * Subscription tiers eligible for the monthly/yearly toggle; excludes `FREE` and `ONE`
 * which have no recurring frequency.
 *
 * Consumers: `apps/web/ce/components/workspace/billing/{root,comparison/plan-detail}.tsx`.
 */
export const SUBSCRIPTION_WITH_BILLING_FREQUENCY = [
  EProductSubscriptionEnum.PRO,
  EProductSubscriptionEnum.BUSINESS,
  EProductSubscriptionEnum.ENTERPRISE,
];

/**
 * Catalog of paid-tier products with monthly/yearly `prices` (cents); `is_active=false`
 * (Enterprise) suppresses inline checkout and routes users to the sales CTA instead.
 *
 * Consumers: `apps/web/ce/components/license/modal/upgrade-modal.tsx`.
 */
export const PLANE_COMMUNITY_PRODUCTS: Record<string, IPaymentProduct> = {
  [EProductSubscriptionEnum.PRO]: {
    id: EProductSubscriptionEnum.PRO,
    name: "Plane Pro",
    description:
      "More views, more cycles powers, more pages features, new reports, and better dashboards are waiting to be unlocked.",
    type: "PRO",
    prices: [
      {
        id: `price_monthly_${EProductSubscriptionEnum.PRO}`,
        unit_amount: 800,
        recurring: "month",
        currency: "usd",
        workspace_amount: 800,
        product: EProductSubscriptionEnum.PRO,
      },
      {
        id: `price_yearly_${EProductSubscriptionEnum.PRO}`,
        unit_amount: 7200,
        recurring: "year",
        currency: "usd",
        workspace_amount: 7200,
        product: EProductSubscriptionEnum.PRO,
      },
    ],
    payment_quantity: 1,
    is_active: true,
  },
  [EProductSubscriptionEnum.BUSINESS]: {
    id: EProductSubscriptionEnum.BUSINESS,
    name: "Plane Business",
    description:
      "The earliest packaging of Business at $10 a seat a month billed annually, $12 a seat a month billed monthly for Plane Cloud",
    type: "BUSINESS",
    prices: [
      {
        id: `price_yearly_${EProductSubscriptionEnum.BUSINESS}`,
        unit_amount: 15600,
        recurring: "year",
        currency: "usd",
        workspace_amount: 15600,
        product: EProductSubscriptionEnum.BUSINESS,
      },
      {
        id: `price_monthly_${EProductSubscriptionEnum.BUSINESS}`,
        unit_amount: 1500,
        recurring: "month",
        currency: "usd",
        workspace_amount: 1500,
        product: EProductSubscriptionEnum.BUSINESS,
      },
    ],
    payment_quantity: 1,
    is_active: true,
  },
  [EProductSubscriptionEnum.ENTERPRISE]: {
    id: EProductSubscriptionEnum.ENTERPRISE,
    name: "Plane Enterprise",
    description: "",
    type: "ENTERPRISE",
    prices: [
      {
        id: `price_yearly_${EProductSubscriptionEnum.ENTERPRISE}`,
        unit_amount: 0,
        recurring: "year",
        currency: "usd",
        workspace_amount: 0,
        product: EProductSubscriptionEnum.ENTERPRISE,
      },
      {
        id: `price_monthly_${EProductSubscriptionEnum.ENTERPRISE}`,
        unit_amount: 0,
        recurring: "month",
        currency: "usd",
        workspace_amount: 0,
        product: EProductSubscriptionEnum.ENTERPRISE,
      },
    ],
    payment_quantity: 1,
    is_active: false,
  },
};

/**
 * "Talk to Sales" marketing URL used as the fallback CTA for tiers without
 * self-service checkout (`FREE`, `ONE`, `ENTERPRISE`).
 *
 * Consumers: `apps/web/core/components/license/modal/card/plan-upgrade.tsx`,
 * `apps/web/ce/components/{license/modal/upgrade-modal,workspace/billing/comparison/plan-detail}.tsx`.
 */
export const TALK_TO_SALES_URL = "https://plane.so/talk-to-sales";

/**
 * Self-hosted upgrade URLs keyed by tier×frequency; Pro/Business route to
 * `app.plane.so/upgrade/...?plan={month|year}` and other tiers fall back to `TALK_TO_SALES_URL`.
 *
 * Consumers: `apps/web/ce/components/{license/modal/upgrade-modal,workspace/billing/comparison/plan-detail}.tsx`.
 */
export const SUBSCRIPTION_REDIRECTION_URLS: Record<EProductSubscriptionEnum, Record<TBillingFrequency, string>> = {
  [EProductSubscriptionEnum.FREE]: {
    month: TALK_TO_SALES_URL,
    year: TALK_TO_SALES_URL,
  },
  [EProductSubscriptionEnum.ONE]: {
    month: TALK_TO_SALES_URL,
    year: TALK_TO_SALES_URL,
  },
  [EProductSubscriptionEnum.PRO]: {
    month: "https://app.plane.so/upgrade/pro/self-hosted?plan=month",
    year: "https://app.plane.so/upgrade/pro/self-hosted?plan=year",
  },
  [EProductSubscriptionEnum.BUSINESS]: {
    month: "https://app.plane.so/upgrade/business/self-hosted?plan=month",
    year: "https://app.plane.so/upgrade/business/self-hosted?plan=year",
  },
  [EProductSubscriptionEnum.ENTERPRISE]: {
    month: TALK_TO_SALES_URL,
    year: TALK_TO_SALES_URL,
  },
};

/**
 * Tier marketing/"Learn more" URLs; `FREE`/`ONE`/`ENTERPRISE` route to sales while
 * `PRO`/`BUSINESS` link to their landing pages.
 *
 * Consumers: `apps/web/ce/components/license/modal/upgrade-modal.tsx`.
 */
export const SUBSCRIPTION_WEBPAGE_URLS: Record<EProductSubscriptionEnum, string> = {
  [EProductSubscriptionEnum.FREE]: TALK_TO_SALES_URL,
  [EProductSubscriptionEnum.ONE]: TALK_TO_SALES_URL,
  [EProductSubscriptionEnum.PRO]: "https://plane.so/pro",
  [EProductSubscriptionEnum.BUSINESS]: "https://plane.so/business",
  [EProductSubscriptionEnum.ENTERPRISE]: "https://plane.so/business",
};
