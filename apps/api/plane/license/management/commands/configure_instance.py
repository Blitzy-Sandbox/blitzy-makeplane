# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command that seeds and maintains ``InstanceConfiguration`` rows from environment variables.

Invocation:
    ``python manage.py configure_instance`` (no CLI arguments)

This command is idempotent on re-run: it uses
``InstanceConfiguration.objects.get_or_create`` per key, so existing rows are
preserved with a stdout warning while newly-created rows take their values
from the environment-driven ``plane.utils.instance_config_variables``
registry. The command raises ``CommandError`` if the ``SECRET_KEY`` env
variable is missing, because that key is the derivation source for Fernet
encryption applied to entries flagged ``is_encrypted=True``; rotating
``SECRET_KEY`` invalidates every previously encrypted value.

After the main configuration loop, four OAuth provider toggles
(``IS_GOOGLE_ENABLED``, ``IS_GITHUB_ENABLED``, ``IS_GITLAB_ENABLED``,
``IS_GITEA_ENABLED``) are seeded as an atomic group: if ANY of the four
already exists, NONE are recreated and all four log a warning. Each
toggle's value is ``"1"`` when the corresponding client_id/secret/host
triple is present (in ``InstanceConfiguration`` or the environment), else
``"0"``.

Startup contract (per architectural context): the ``migrator`` container
MUST have applied the license app's migrations before this command runs,
because it writes to the ``instance_configurations`` table.
"""

# Python imports
import os

# Django imports
from django.core.management.base import BaseCommand, CommandError

# Module imports
from plane.license.models import InstanceConfiguration
from plane.utils.instance_config_variables import instance_config_variables


class Command(BaseCommand):
    """Seed ``InstanceConfiguration`` rows from environment variables; idempotent on re-run.

    Invocation:
        ``python manage.py configure_instance`` (no CLI arguments)

    Hard precondition:
        ``SECRET_KEY`` env var MUST be set or ``CommandError`` is raised.
        The key is required because Fernet encryption keys are derived from
        it for entries flagged ``is_encrypted=True``.

    Side effects (DB writes):
        - For each entry in ``plane.utils.instance_config_variables``,
          calls ``InstanceConfiguration.objects.get_or_create`` keyed by
          ``key``. On creation, sets ``category``, ``is_encrypted``, and
          ``value`` (Fernet-encrypted via
          ``plane.license.utils.encryption.encrypt_data`` when
          ``is_encrypted=True``). Already-existing rows are left untouched
          and produce stdout warnings.
        - For OAuth provider toggles ``IS_GOOGLE_ENABLED``,
          ``IS_GITHUB_ENABLED``, ``IS_GITLAB_ENABLED``,
          ``IS_GITEA_ENABLED``: if NONE exist in the DB, each is computed
          from its client/secret/host env vars and persisted under
          ``category="AUTHENTICATION"``. If ANY already exists, ALL four
          are skipped with warnings (deliberate atomic-batch policy).

    Side effects (encryption):
        Values with ``is_encrypted=True`` are passed through
        ``plane.license.utils.encryption.encrypt_data`` (Fernet symmetric
        encryption derived from Django's ``SECRET_KEY``). Reading them
        back requires ``decrypt_data`` from the same module.

    Environment variables read:
        ``SECRET_KEY`` (mandatory) plus the variables enumerated in
        ``plane.utils.instance_config_variables`` (typically email,
        instance, and AI settings), plus the OAuth triples
        ``GOOGLE_CLIENT_ID``/``GOOGLE_CLIENT_SECRET``,
        ``GITHUB_CLIENT_ID``/``GITHUB_CLIENT_SECRET``,
        ``GITLAB_HOST``/``GITLAB_CLIENT_ID``/``GITLAB_CLIENT_SECRET``,
        ``GITEA_HOST``/``GITEA_CLIENT_ID``/``GITEA_CLIENT_SECRET``.
    """

    help = "Configure instance variables"

    def handle(self, *args, **options):
        """Validate prerequisites, seed configuration rows, and seed OAuth provider toggles.

        Execution phases:
            1. **Precondition check** -- raise ``CommandError`` if
               ``SECRET_KEY`` env var is missing (Fernet key derivation
               source).
            2. **Configuration seeding** -- iterate over
               ``plane.utils.instance_config_variables``; for each entry
               call ``InstanceConfiguration.objects.get_or_create(key=...)``.
               On newly-created rows set ``category``, ``is_encrypted``,
               and ``value`` (encrypted via ``encrypt_data`` when
               ``is_encrypted=True``). On existing rows emit a warning.
            3. **OAuth provider toggles** -- check whether ANY of
               ``IS_GOOGLE_ENABLED``/``IS_GITHUB_ENABLED``/
               ``IS_GITLAB_ENABLED``/``IS_GITEA_ENABLED`` already exists.
               If none exist, compute each based on client_id/secret/host
               env vars (using ``get_configuration_value`` to read from DB
               first then env fallback) and persist the rows. Otherwise
               skip the entire group with warnings.

        Lazy imports:
            ``encrypt_data`` and ``get_configuration_value`` are imported
            inside ``handle()`` to defer Fernet/encryption setup until
            command execution (avoids pulling encryption machinery at
            module import time).

        Note:
            The GitLab branch defaults ``GITLAB_HOST`` to
            ``"https://gitlab.com"`` if unset; the Gitea branch has NO
            host default (self-hosted Gitea instances must configure it
            explicitly).
        """
        from plane.license.utils.encryption import encrypt_data
        from plane.license.utils.instance_value import get_configuration_value

        mandatory_keys = ["SECRET_KEY"]

        for item in mandatory_keys:
            if not os.environ.get(item):
                raise CommandError(f"{item} env variable is required.")

        for item in instance_config_variables:
            obj, created = InstanceConfiguration.objects.get_or_create(key=item.get("key"))
            if created:
                obj.category = item.get("category")
                obj.is_encrypted = item.get("is_encrypted", False)
                if item.get("is_encrypted", False):
                    obj.value = encrypt_data(item.get("value"))
                else:
                    obj.value = item.get("value")
                obj.save()
                self.stdout.write(self.style.SUCCESS(f"{obj.key} loaded with value from environment variable."))
            else:
                self.stdout.write(self.style.WARNING(f"{obj.key} configuration already exists"))

        keys = ["IS_GOOGLE_ENABLED", "IS_GITHUB_ENABLED", "IS_GITLAB_ENABLED", "IS_GITEA_ENABLED"]
        if not InstanceConfiguration.objects.filter(key__in=keys).exists():
            for key in keys:
                if key == "IS_GOOGLE_ENABLED":
                    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET = get_configuration_value(
                        [
                            {
                                "key": "GOOGLE_CLIENT_ID",
                                "default": os.environ.get("GOOGLE_CLIENT_ID", ""),
                            },
                            {
                                "key": "GOOGLE_CLIENT_SECRET",
                                "default": os.environ.get("GOOGLE_CLIENT_SECRET", "0"),
                            },
                        ]
                    )
                    if bool(GOOGLE_CLIENT_ID) and bool(GOOGLE_CLIENT_SECRET):
                        value = "1"
                    else:
                        value = "0"
                    InstanceConfiguration.objects.create(
                        key=key,
                        value=value,
                        category="AUTHENTICATION",
                        is_encrypted=False,
                    )
                    self.stdout.write(self.style.SUCCESS(f"{key} loaded with value from environment variable."))
                if key == "IS_GITHUB_ENABLED":
                    GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET = get_configuration_value(
                        [
                            {
                                "key": "GITHUB_CLIENT_ID",
                                "default": os.environ.get("GITHUB_CLIENT_ID", ""),
                            },
                            {
                                "key": "GITHUB_CLIENT_SECRET",
                                "default": os.environ.get("GITHUB_CLIENT_SECRET", "0"),
                            },
                        ]
                    )
                    if bool(GITHUB_CLIENT_ID) and bool(GITHUB_CLIENT_SECRET):
                        value = "1"
                    else:
                        value = "0"
                    InstanceConfiguration.objects.create(
                        key="IS_GITHUB_ENABLED",
                        value=value,
                        category="AUTHENTICATION",
                        is_encrypted=False,
                    )
                    self.stdout.write(self.style.SUCCESS(f"{key} loaded with value from environment variable."))
                if key == "IS_GITLAB_ENABLED":
                    GITLAB_HOST, GITLAB_CLIENT_ID, GITLAB_CLIENT_SECRET = get_configuration_value(
                        [
                            {
                                "key": "GITLAB_HOST",
                                "default": os.environ.get("GITLAB_HOST", "https://gitlab.com"),
                            },
                            {
                                "key": "GITLAB_CLIENT_ID",
                                "default": os.environ.get("GITLAB_CLIENT_ID", ""),
                            },
                            {
                                "key": "GITLAB_CLIENT_SECRET",
                                "default": os.environ.get("GITLAB_CLIENT_SECRET", ""),
                            },
                        ]
                    )
                    if bool(GITLAB_HOST) and bool(GITLAB_CLIENT_ID) and bool(GITLAB_CLIENT_SECRET):
                        value = "1"
                    else:
                        value = "0"
                    InstanceConfiguration.objects.create(
                        key="IS_GITLAB_ENABLED",
                        value=value,
                        category="AUTHENTICATION",
                        is_encrypted=False,
                    )
                    self.stdout.write(self.style.SUCCESS(f"{key} loaded with value from environment variable."))
                if key == "IS_GITEA_ENABLED":
                    GITEA_HOST, GITEA_CLIENT_ID, GITEA_CLIENT_SECRET = get_configuration_value(
                        [
                            {
                                "key": "GITEA_HOST",
                                "default": os.environ.get("GITEA_HOST", ""),
                            },
                            {
                                "key": "GITEA_CLIENT_ID",
                                "default": os.environ.get("GITEA_CLIENT_ID", ""),
                            },
                            {
                                "key": "GITEA_CLIENT_SECRET",
                                "default": os.environ.get("GITEA_CLIENT_SECRET", ""),
                            },
                        ]
                    )
                    if bool(GITEA_HOST) and bool(GITEA_CLIENT_ID) and bool(GITEA_CLIENT_SECRET):
                        value = "1"
                    else:
                        value = "0"
                    InstanceConfiguration.objects.create(
                        key="IS_GITEA_ENABLED",
                        value=value,
                        category="AUTHENTICATION",
                        is_encrypted=False,
                    )
                    self.stdout.write(self.style.SUCCESS(f"{key} loaded with value from environment variable."))
        else:
            for key in keys:
                self.stdout.write(self.style.WARNING(f"{key} configuration already exists"))
