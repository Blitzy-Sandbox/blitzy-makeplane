# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command to activate a user account by email."""

# Django imports
from django.core.management import BaseCommand, CommandError

# Module imports
from plane.db.models import User


class Command(BaseCommand):
    """Activate a user account by setting ``is_active=True`` on the matching ``User`` row.

    CLI signature:
        ``python manage.py activate_user <email>``

    Side effects:
        Writes ``is_active=True`` to the ``User`` row whose email equals the positional
        ``email`` argument.

    Idempotency:
        Idempotent — re-running on an already-active user re-saves the row without
        changing observable state.
    """

    help = "Make the user with the given email active"

    def add_arguments(self, parser):
        """Register the ``email`` positional argument on the argparse parser."""
        # Positional argument
        parser.add_argument("email", type=str, help="user email")

    def handle(self, *args, **options):
        """Resolve the user by email and set ``is_active=True``."""
        # get the user email from console
        email = options.get("email", False)

        # raise error if email is not present
        if not email:
            raise CommandError("Error: Email is required")

        # filter the user
        user = User.objects.filter(email=email).first()

        # Raise error if the user is not present
        if not user:
            raise CommandError(f"Error: User with {email} does not exists")

        # Activate the user
        user.is_active = True
        user.save()

        self.stdout.write(self.style.SUCCESS("User activated successfully"))
