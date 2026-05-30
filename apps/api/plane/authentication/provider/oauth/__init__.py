# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""OAuth provider subpackage for Plane's authentication backend.

This subpackage groups Plane's third-party OAuth 2.0
authorization-code integrations. Every provider in this subpackage
subclasses :class:`plane.authentication.adapter.oauth.OauthAdapter`
and follows the same authorization-code flow with provider-specific
endpoints, scopes, profile-to-user field mappings, and (where
required) post-callback policy enforcement (e.g., GitHub
organization-membership gating).

Supported providers and their ``provider`` attribute (the
``Account.provider`` column value used by lookups):

* :mod:`.google` -- :class:`GoogleOAuthProvider`
  (``provider = "google"``). Cloud-hosted OAuth via
  ``accounts.google.com``; uses ``access_type=offline`` +
  ``prompt=consent`` to force refresh-token issuance.
* :mod:`.github` -- :class:`GitHubOAuthProvider`
  (``provider = "github"``). Cloud-hosted OAuth via
  ``github.com``; includes organization-membership enforcement
  when ``GITHUB_ORGANIZATION_ID`` is configured (the ``read:org``
  scope is appended and members-only access is enforced before
  user data is set).
* :mod:`.gitlab` -- :class:`GitLabOAuthProvider`
  (``provider = "gitlab"``). Configurable host (defaults to
  ``https://gitlab.com``); supports both SaaS and self-hosted
  GitLab via ``GITLAB_HOST``.
* :mod:`.gitea` -- :class:`GiteaOAuthProvider`
  (``provider = "gitea"``). Fully self-hosted only; the host
  MUST be configured via ``GITEA_HOST`` with a validated
  ``http``/``https`` scheme to prevent SSRF-style
  misconfiguration.

Architecture (per AAP section 0.2.2):
    Provider instances are stateless adapters instantiated per
    request. OAuth access/refresh tokens are persisted by
    :meth:`OauthAdapter.create_update_account` (base class) into
    the :class:`~plane.db.models.Account` row, not by the provider
    classes themselves. This subpackage contributes only the
    per-provider configuration, endpoint wiring, and
    profile-to-user-payload mapping; persistence is invoked from
    :meth:`plane.authentication.adapter.base.Adapter.complete_login_or_signup`.

This module exports nothing. There is intentionally no ``__all__``
list and no re-exports; consumers must import the concrete provider
class directly, e.g.::

    from plane.authentication.provider.oauth.google import (
        GoogleOAuthProvider,
    )
"""
