# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Resolve Plane instance configuration values from persisted DB rows or environment variables.

The lookup source is controlled by ``settings.SKIP_ENV_VAR``:
  * Truthy — read ``key``/``value``/``is_encrypted`` rows from
    :class:`plane.license.models.InstanceConfiguration` and Fernet-decrypt values
    flagged as encrypted via :func:`plane.license.utils.encryption.decrypt_data`.
  * Falsy — bypass the DB and read values directly from ``os.environ``.

Consumed by email-sending paths (notification tasks, password-reset flow) and by
any code that needs to resolve runtime instance settings without hard-coding a
source. The DB-backed branch assumes the ``instance_configurations`` table
exists, which holds because the ``migrator`` container runs Django migrations
before any API/worker process starts (see AAP architectural context).
"""

# Python imports
import os

# Django imports
from django.conf import settings

# Module imports
from plane.license.models import InstanceConfiguration
from plane.license.utils.encryption import decrypt_data


def get_configuration_value(keys):
    """Resolve a batch of configuration keys, returning values in input order.

    Lookup source is controlled by ``settings.SKIP_ENV_VAR``: when truthy,
    values are read from :class:`InstanceConfiguration` rows (with
    :func:`decrypt_data` applied to rows where ``is_encrypted=True``); when
    falsy, values are read directly from ``os.environ``. In both branches,
    the descriptor's ``default`` is returned when no match is found.

    Args:
        keys: Ordered list of descriptor dicts; each item must include a
            ``key`` string and may include a ``default`` value used when the
            key is missing from the chosen source.

    Returns:
        tuple: Resolved string values in the same order as the input
        descriptors.
    """
    environment_list = []
    if settings.SKIP_ENV_VAR:
        # Get the configurations
        instance_configuration = InstanceConfiguration.objects.values("key", "value", "is_encrypted")

        for key in keys:
            for item in instance_configuration:
                if key.get("key") == item.get("key"):
                    if item.get("is_encrypted", False):
                        environment_list.append(decrypt_data(item.get("value")))
                    else:
                        environment_list.append(item.get("value"))

                    break
            else:
                environment_list.append(key.get("default"))
    else:
        # Get the configuration from os
        for key in keys:
            environment_list.append(os.environ.get(key.get("key"), key.get("default")))

    return tuple(environment_list)


def get_email_configuration():
    """Resolve the canonical 7-tuple of SMTP email settings.

    Returns:
        tuple: ``(EMAIL_HOST, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, EMAIL_PORT,
        EMAIL_USE_TLS, EMAIL_USE_SSL, EMAIL_FROM)`` resolved via
        :func:`get_configuration_value`. Defaults fall back to ``EMAIL_PORT=587``,
        ``EMAIL_USE_TLS="1"``, ``EMAIL_USE_SSL="0"``, and
        ``EMAIL_FROM="Team Plane <team@mailer.plane.so>"`` with the remaining
        defaults sourced from live ``os.environ`` values.
    """
    return get_configuration_value(
        [
            {"key": "EMAIL_HOST", "default": os.environ.get("EMAIL_HOST")},
            {"key": "EMAIL_HOST_USER", "default": os.environ.get("EMAIL_HOST_USER")},
            {
                "key": "EMAIL_HOST_PASSWORD",
                "default": os.environ.get("EMAIL_HOST_PASSWORD"),
            },
            {"key": "EMAIL_PORT", "default": os.environ.get("EMAIL_PORT", 587)},
            {"key": "EMAIL_USE_TLS", "default": os.environ.get("EMAIL_USE_TLS", "1")},
            {"key": "EMAIL_USE_SSL", "default": os.environ.get("EMAIL_USE_SSL", "0")},
            {
                "key": "EMAIL_FROM",
                "default": os.environ.get("EMAIL_FROM", "Team Plane <team@mailer.plane.so>"),
            },
        ]
    )
