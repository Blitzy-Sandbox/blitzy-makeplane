# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command to add or reactivate a project member."""

# Django imports
from typing import Any
from django.core.management import BaseCommand, CommandError

# Module imports
from plane.db.models import (
    User,
    WorkspaceMember,
    ProjectMember,
    Project,
    ProjectUserProperty,
)


class Command(BaseCommand):
    """Add a user to a project as a member, or reactivate them if a row already exists.

    CLI signature:
        ``python manage.py create_project_member --project_id <uuid> --user_email <email> [--role <int>]``

    Side effects:
        - Verifies the user is already an active ``WorkspaceMember`` of the project's
          workspace; raises ``CommandError`` otherwise (workspace membership is a
          precondition for project membership).
        - On existing ``ProjectMember`` row: updates ``is_active=True`` and ``role`` in
          place.
        - On missing ``ProjectMember`` row: inserts a new row.
        - Always ensures a ``ProjectUserProperty`` row exists for the (user, project)
          pair via ``get_or_create`` so per-user project preferences are immediately
          available.

    Idempotency:
        Idempotent — re-running with the same arguments either no-ops or updates the
        existing row to the requested role.

    Trigger context:
        Operator-invoked manual membership management. Useful when the admin UI is
        unavailable or when bulk-onboarding via shell.
    """

    help = "Add a member to a project. If present in the workspace"

    def add_arguments(self, parser):
        """Register the ``--project_id``, ``--user_email``, and ``--role`` flag arguments."""
        # Positional argument
        parser.add_argument("--project_id", type=str, nargs="?", help="Project ID")
        parser.add_argument("--user_email", type=str, nargs="?", help="User Email")
        parser.add_argument("--role", type=int, nargs="?", help="Role of the user in the project")

    def handle(self, *args: Any, **options: Any):
        """Validate inputs, enforce workspace membership, and create or update the ``ProjectMember`` row."""
        try:
            if not options["project_id"]:
                raise CommandError("Project ID is required")
            if not options["user_email"]:
                raise CommandError("User Email is required")

            project_id = options["project_id"]
            user_email = options["user_email"]
            role = options.get("role", 20)

            print(f"Role: {role}")

            user = User.objects.filter(email=user_email).first()
            if not user:
                raise CommandError("User not found")

            # Check if the project exists
            project = Project.objects.filter(pk=project_id).first()
            if not project:
                raise CommandError("Project not found")

            # Check if the user exists in the workspace
            if not WorkspaceMember.objects.filter(workspace=project.workspace, member=user, is_active=True).exists():
                raise CommandError("User not member in workspace")


            if ProjectMember.objects.filter(project=project, member=user).exists():
                # Update the project member
                ProjectMember.objects.filter(project=project, member=user).update(
                    is_active=True, role=role
                )
            else:
                # Create the project member
                ProjectMember.objects.create(project=project, member=user, role=role)

            # Issue Property
            ProjectUserProperty.objects.get_or_create(user=user, project=project)

            # Success message
            self.stdout.write(self.style.SUCCESS(f"User {user_email} added to project {project_id}"))
            return
        except CommandError as e:
            self.stdout.write(self.style.ERROR(e))
            return
