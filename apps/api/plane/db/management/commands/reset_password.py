# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command to reset a user's password from the console."""

# Python imports
import getpass

# Django imports
from django.core.management import BaseCommand, CommandError

# Third party imports
from zxcvbn import zxcvbn

# Module imports
from plane.db.models import User


class Command(BaseCommand):
    """Reset a user's password after a double-confirmation prompt and a ``zxcvbn`` strength check.

    CLI signature:
        ``python manage.py reset_password <email>``

    Console interaction:
        Uses ``getpass.getpass`` twice (entry + confirmation) so the new password is
        never echoed to the terminal.

    Side effects:
        - Calls ``user.set_password(new_password)`` to update the password hash.
        - Sets ``is_password_autoset=False`` so the user is no longer treated as
          holding an auto-generated default password.
        - Rejects weak passwords by raising ``CommandError`` when
          ``zxcvbn(password)['score'] < 3``.

    Idempotency:
        Idempotent for the new password -- re-running with the same chosen password
        rehashes and saves but produces the same observable login behavior.

    Trigger context:
        Operator-invoked manual recovery when a user has lost access to their email
        inbox and cannot use the self-service flow.
    """

    help = "Reset password of the user with the given email"

    def add_arguments(self, parser):
        """Register the ``email`` positional argument on the argparse parser."""
        # Positional argument
        parser.add_argument("email", type=str, help="user email")

    def handle(self, *args, **options):
        """Resolve the user by email, prompt twice for a password, validate strength, and persist the new hash."""
        # get the user email from console
        email = options.get("email", False)

        # raise error if email is not present
        if not email:
            self.stderr.write("Error: Email is required")
            return

        # filter the user
        user = User.objects.filter(email=email).first()

        # Raise error if the user is not present
        if not user:
            self.stderr.write(f"Error: User with {email} does not exists")
            return

        # get password for the user
        password = getpass.getpass("Password: ")
        confirm_password = getpass.getpass("Password (again): ")

        # If the passwords doesn't match raise error
        if password != confirm_password:
            self.stderr.write("Error: Your passwords didn't match.")
            return

        # Blank passwords should not be allowed
        if password.strip() == "":
            self.stderr.write("Error: Blank passwords aren't allowed.")
            return

        results = zxcvbn(password)

        if results["score"] < 3:
            raise CommandError("Password is too common please set a complex password")

        # Set user password
        user.set_password(password)
        user.is_password_autoset = False
        user.save()

        self.stdout.write(self.style.SUCCESS("User password updated successfully"))
