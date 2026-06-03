# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Credential-adapter scaffold for non-OAuth authentication flows.

Hosts :class:`CredentialAdapter`, a thin
:class:`~plane.authentication.adapter.base.Adapter` subclass that
standardizes the lifecycle for credential-based login flows
(email/password, magic-code). The scaffold itself contains no
provider-specific logic; concrete subclasses live in
:mod:`plane.authentication.provider.credentials`
(``email.EmailProvider`` and ``magic_code.MagicCodeProvider``) and
implement the provider-specific :meth:`set_user_data` payload assembly
that this adapter then hands off to the shared
:meth:`~plane.authentication.adapter.base.Adapter.complete_login_or_signup`
orchestration in the base.

The base adapter reads and writes the ``User``, ``Profile``, ``Account``,
``FileAsset``, and ``WorkspaceMemberInvite`` tables; this module
therefore depends on the migrator startup contract (Django migrations
applied to the target revision before any authentication request is
served).
"""

from plane.authentication.adapter.base import Adapter


class CredentialAdapter(Adapter):
    """Adapter scaffold for credential-based authentication flows.

    Subclass of :class:`Adapter` that standardizes the lifecycle for
    credential flows (email/password and magic-code login). Wires the
    request, provider name, and optional ``callback`` through the base
    via :meth:`__init__`, then exposes :meth:`authenticate` which
    assembles the user data via :meth:`set_user_data` (implemented by
    the concrete subclass) and hands off to the shared
    :meth:`~plane.authentication.adapter.base.Adapter.complete_login_or_signup`
    orchestration.

    Unlike :class:`~plane.authentication.adapter.oauth.OauthAdapter`,
    this adapter has no token-exchange phase; credentials are validated
    directly inside the concrete provider's :meth:`set_user_data` before
    it populates ``self.user_data``. All shared concerns — password
    strength validation, signup eligibility, provider-sync gating,
    avatar upload, and login-metadata persistence — live in the base
    :class:`Adapter` and are reached transitively through
    ``complete_login_or_signup``.

    Concrete subclasses live in
    :mod:`plane.authentication.provider.credentials` (``email.EmailProvider``
    for email/password sign-in and ``magic_code.MagicCodeProvider`` for
    one-time magic-code sign-in).
    """

    def __init__(self, request, provider, callback=None):
        """Initialize the credential adapter for a request/provider pair.

        Args:
            request: The inbound Django ``HttpRequest``; used downstream
                by :meth:`Adapter.save_user_data` to resolve client IP,
                user agent, and tenant context.
            provider: Short identifier for the credential flow
                (e.g. ``"email"`` or ``"magic-code"``); stamped onto
                ``User.last_login_medium`` on successful authentication.
            callback: Optional callable invoked from
                :meth:`Adapter.complete_login_or_signup` with
                ``(user, is_signup, request)`` once authentication
                succeeds. Used by callers that need to run side effects
                (e.g. attaching the user to a pending workspace invite)
                without subclassing.
        """
        super().__init__(request=request, provider=provider, callback=callback)
        self.request = request
        self.provider = provider

    def authenticate(self):
        """Run the credential authentication lifecycle and return the user.

        Calls :meth:`set_user_data` (implemented by the concrete
        subclass) to validate the inbound credentials and populate
        ``self.user_data``, then hands off to
        :meth:`Adapter.complete_login_or_signup` which sanitizes the
        email, creates or fetches the matching :class:`User`, syncs
        profile data when sync is enabled, persists login metadata, and
        invokes the optional ``callback``.

        Returns:
            plane.db.models.User: The authenticated user, ready to be
            passed to :func:`django.contrib.auth.login`.

        Raises:
            plane.authentication.adapter.error.AuthenticationException:
                When ``set_user_data`` rejects the inbound credentials,
                when the user does not satisfy the base adapter's
                signup-eligibility check, or when password-strength
                validation fails inside the base for newly created
                users.
        """
        self.set_user_data()
        return self.complete_login_or_signup()
