# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Local (non-OAuth) credential-provider subpackage for ``plane.authentication``.

This subpackage groups Plane's non-OAuth credential providers.  Both
providers extend
:class:`plane.authentication.adapter.credential.CredentialAdapter` and
follow the standard Plane adapter contract: validate inputs, populate a
normalised user payload, and delegate persistence to
``Adapter.complete_login_or_signup()``.

Concrete providers:

  * :mod:`.email`       -- :class:`EmailProvider`, the conventional
                          username/password sign-in / sign-up flow.  Its
                          ``provider`` class attribute is the literal
                          ``"email"``.
  * :mod:`.magic_code`  -- :class:`MagicCodeProvider`, a Redis-backed
                          one-time 6-digit-code flow.  Its ``provider``
                          class attribute is the literal ``"magic-code"``
                          (kebab-case) -- this is the canonical key used
                          by the adapter layer for Account / Provider
                          lookups.

Infrastructure note (per AAP section 0.2.2):

  * ``MagicCodeProvider`` stores its short-lived code state in **Redis
    as a cache** under the key ``"magic_<email>"`` with a 600-second
    TTL.  Redis here is the cache, NOT a task queue.
  * The magic-code **email delivery** is enqueued via **Celery on
    RabbitMQ** (``magic_link_code_task.magic_link.delay()``) at the
    view layer (``plane.authentication.views``), NOT inside any
    provider in this subpackage.

This package marker deliberately re-exports nothing (no ``__all__``).
Consumers import directly from the concrete provider, e.g.,
``from plane.authentication.provider.credentials.email import EmailProvider``
or
``from plane.authentication.provider.credentials.magic_code import MagicCodeProvider``.
"""
