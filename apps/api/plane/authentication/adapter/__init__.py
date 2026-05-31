# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Base adapter layer for the Plane authentication subsystem.

The most architecturally foundational portion of the auth subsystem:
every authentication provider (OAuth + credentials) extends classes
defined here, and every authentication error/exception flows through
definitions here.

Module layout:

* :mod:`.base`       -- :class:`Adapter` base class with shared
                        orchestration: signup eligibility,
                        :func:`zxcvbn` password validation, avatar
                        download/upload to S3, account sync, and the
                        :meth:`~Adapter.complete_login_or_signup`
                        lifecycle.
* :mod:`.credential` -- :class:`CredentialAdapter` for credential
                        flows (email/password, magic-code).
* :mod:`.oauth`      -- :class:`OauthAdapter` for OAuth flows against
                        Google, GitHub, GitLab, and Gitea.
* :mod:`.error`      -- :data:`AUTHENTICATION_ERROR_CODES` (canonical
                        numeric error vocabulary) and
                        :class:`AuthenticationException` (response-
                        ready carrier).
* :mod:`.exception`  -- :func:`auth_exception_handler`, the DRF
                        exception handler that normalizes
                        :class:`NotAuthenticated` and
                        :class:`Throttled` into Plane's authentication
                        error envelope.

This ``__init__`` re-exports nothing; consumers import directly from
the submodule that owns each symbol (e.g.
``from plane.authentication.adapter.base import Adapter``).

Async-infrastructure note (per AAP section 0.2.2): this layer is pure
adapter logic and contains no direct Redis or RabbitMQ access. The
only Celery handoff originates in :mod:`.base` via
``user_activation_email.delay(...)`` which routes through Celery +
RabbitMQ. Redis in this codebase is reserved for caching and selected
ephemeral auth artefacts (e.g. magic-code TTL data); Django sessions
themselves are persisted to PostgreSQL via the custom
``plane.db.models.session`` engine (see
``apps/api/plane/settings/common.py`` ``SESSION_ENGINE``), not Redis.
Higher-level Celery handoffs (e.g. magic-link code email,
forgot-password email) live in :mod:`plane.authentication.views` and
:mod:`plane.authentication.provider.credentials.magic_code`.
"""
