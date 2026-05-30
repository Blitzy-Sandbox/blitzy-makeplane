# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Pluggable authentication-provider namespace for ``plane.authentication``.

This package is the integration boundary between Plane's authentication
adapter layer and concrete identity sources. Two subpackages partition the
provider space:

  * :mod:`.oauth`        - Third-party OAuth 2.0 authorization-code providers
                           (Google, GitHub, GitLab, Gitea). All providers
                           extend ``OauthAdapter`` from
                           ``apps/api/plane/authentication/adapter/oauth.py``
                           and follow the standard OAuth 2.0 authorization-code
                           flow with provider-specific endpoints, scopes, and
                           profile mappings.
  * :mod:`.credentials`  - Local credential providers (email/password,
                           magic-code one-time code). Both extend
                           ``CredentialAdapter`` from
                           ``apps/api/plane/authentication/adapter/credential.py``.

Architectural notes (per AAP §0.2.2):

  * Provider classes are **stateless adapters** instantiated per request;
    persistent state (OAuth tokens, account links) is written by
    ``OauthAdapter.set_user_data`` in the adapter layer, not in the providers.
  * ``MagicCodeProvider`` uses **Redis as a cache** to store its short-lived
    one-time-code state (keyed by ``"magic_<email>"`` with TTL). Redis is the
    cache here; the email delivery handoff is performed via **Celery on
    RabbitMQ** (``magic_link_code_task.magic_link.delay()``) at the view
    layer, not inside the provider.

This package marker deliberately re-exports nothing (no ``__all__``);
consumers import directly from the concrete provider submodule.
"""
