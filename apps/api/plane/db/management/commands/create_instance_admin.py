# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command to promote an existing user to instance admin."""

# Django imports
from django.core.management.base import BaseCommand, CommandError

# Module imports
from plane.license.models import Instance, InstanceAdmin
from plane.db.models import User


class Command(BaseCommand):
    """Create an ``InstanceAdmin`` association attaching an existing user to the latest ``Instance``.

    CLI signature:
        ``python manage.py create_instance_admin <admin_email>``

    Side effects:
        Calls ``InstanceAdmin.objects.get_or_create`` with ``role=20`` (Admin —
        hardcoded). The instance reference is resolved via ``Instance.objects.last()``,
        which selects the most recently created instance row.

    Idempotency:
        Soft-idempotent — ``get_or_create`` does not duplicate rows, but the command
        deliberately raises ``CommandError`` ("already an instance admin") when the
        association already exists so the operator notices.

    Trigger context:
        Operator-invoked promotion. Typically used during initial deployment or to
        recover from accidental admin removal.
    """

    help = "Add a new instance admin"

    def add_arguments(self, parser):
        """Register the ``admin_email`` positional argument on the argparse parser."""
        # Positional argument
        parser.add_argument("admin_email", type=str, help="Instance Admin Email")

    def handle(self, *args, **options):
        """Resolve the user and instance, then create an ``InstanceAdmin`` row with ``role=20``."""
        admin_email = options.get("admin_email", False)

        if not admin_email:
            raise CommandError("Please provide the email of the admin.")

        user = User.objects.filter(email=admin_email).first()
        if user is None:
            raise CommandError("User with the provided email does not exist.")

        try:
            # Get the instance
            instance = Instance.objects.last()

            # Get or create an instance admin
            _, created = InstanceAdmin.objects.get_or_create(user=user, instance=instance, role=20)

            if not created:
                raise CommandError("The provided email is already an instance admin.")

            self.stdout.write(self.style.SUCCESS("Successfully created the admin"))
        except Exception as e:
            print(e)
            raise CommandError("Failed to create the instance admin.")
