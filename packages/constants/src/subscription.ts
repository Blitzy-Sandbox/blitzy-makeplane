/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Marketing feature list for the Enterprise plan — drives the upgrade modal /
 * pricing comparison card for the highest tier.
 *
 * Consumers: workspace settings billing pages, upgrade modals in
 * `apps/web/core/components/workspace/billing/**`.
 */
export const ENTERPRISE_PLAN_FEATURES = [
  "Private + managed deployments",
  "GAC",
  "LDAP support",
  "Databases + Formulas",
  "Unlimited and full Automation Flows",
  "Full-suite professional services",
];

/**
 * Marketing feature list for the Business plan — drives the upgrade modal /
 * pricing comparison card for the mid-high tier.
 *
 * Consumers: workspace settings billing pages, upgrade modals in
 * `apps/web/core/components/workspace/billing/**`.
 */
export const BUSINESS_PLAN_FEATURES = [
  "Project Templates",
  "Workflows + Approvals",
  "Decision + Loops Automation",
  "Custom Reports",
  "Nested Pages",
  "Intake Forms",
];

/**
 * Marketing feature list for the Pro plan — drives the upgrade modal /
 * pricing comparison card for the entry paid tier.
 *
 * Consumers: workspace settings billing pages, upgrade modals in
 * `apps/web/core/components/workspace/billing/**`.
 */
export const PRO_PLAN_FEATURES = [
  "Dashboards + Reports",
  "Full Time Tracking + Bulk Ops",
  "Teamspaces",
  "Trigger And Action",
  "Wikis",
  "Popular integrations",
];

/**
 * Marketing feature list for the One (self-hosted) plan — surfaced in upgrade
 * prompts on self-hosted instances.
 *
 * Consumers: workspace settings billing pages, upgrade modals in
 * `apps/web/core/components/workspace/billing/**`.
 */
export const ONE_PLAN_FEATURES = [
  "OIDC + SAML for SSO",
  "Active Cycles",
  "Real-time collab + public views and page",
  "Link pages in issues and vice-versa",
  "Time-tracking + limited bulk ops",
  "Docker, Kubernetes and more",
];

/**
 * Marketing feature list for the Free → paid upgrade CTA — distilled set of
 * "what you get by upgrading" benefits shown in workspace billing pages.
 *
 * Consumers: workspace settings billing pages, upgrade modals in
 * `apps/web/core/components/workspace/billing/**`.
 */
export const FREE_PLAN_UPGRADE_FEATURES = [
  "OIDC + SAML for SSO",
  "Time Tracking and Bulk Ops",
  "Integrations",
  "Public Views and Pages",
];
