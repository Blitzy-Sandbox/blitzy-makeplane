# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command to repair duplicate issue sequence numbers within a project."""

# Django imports
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Max
from django.db import connection, transaction

# Module imports
from plane.db.models import Project, Issue, IssueSequence
from plane.utils.uuid import convert_uuid_to_integer


class Command(BaseCommand):
    """Re-sequence duplicate ``Issue`` rows sharing the same ``(project, sequence_id)`` tuple.

    CLI signature:
        ``python manage.py fix_duplicate_sequences <issue_identifier>``
        (Also prompts interactively for ``workspace_slug``.)

    Side effects:
        - Resolves the project via ``(workspace.slug, project_identifier)`` parsed
          from ``issue_identifier`` (``PROJ-123`` → identifier=``PROJ``, sequence=123).
        - Inside ``transaction.atomic()``, acquires a PostgreSQL advisory lock via
          ``pg_advisory_xact_lock(<int derived from project UUID>)`` so only one
          transaction per project may execute the re-sequencing block at a time.
          (See tech spec §5.2.1.5 for PG-specific feature usage.)
        - Bulk-updates ``Issue.sequence_id`` and the matching
          ``IssueSequence.sequence`` rows for duplicates beyond the first occurrence,
          assigning fresh sequence numbers starting at ``max(existing) + 1``.

    Idempotency:
        Idempotent on the canonical first occurrence — repeated runs raise
        ``CommandError`` ("No duplicate issues found") once the duplicates are
        re-sequenced.

    Trigger context:
        Operator-invoked manual data repair after rare sequence-collision incidents.
    """

    help = "Fix duplicate sequences"

    def add_arguments(self, parser):
        """Register the ``issue_identifier`` positional argument (e.g., ``PROJ-123``)."""
        # Positional argument
        parser.add_argument("issue_identifier", type=str, help="Issue Identifier")

    def strict_str_to_int(self, s):
        """Convert ``s`` to ``int``, rejecting non-numeric strings (including those with a leading ``+``)."""
        if not s.isdigit() and not (s.startswith("-") and s[1:].isdigit()):
            raise ValueError("Invalid integer string")
        return int(s)

    def handle(self, *args, **options):
        """Acquire a per-project advisory lock and bulk-update the duplicate ``Issue`` and ``IssueSequence`` rows."""
        workspace_slug = input("Workspace slug: ")

        if not workspace_slug:
            raise CommandError("Workspace slug is required")

        issue_identifier = options.get("issue_identifier", False)

        # Validate issue_identifier
        if not issue_identifier:
            raise CommandError("Issue identifier is required")

        # Validate issue identifier
        try:
            identifier = issue_identifier.split("-")

            if len(identifier) != 2:
                raise ValueError("Invalid issue identifier format")

            project_identifier = identifier[0]
            issue_sequence = self.strict_str_to_int(identifier[1])

            # Fetch the project
            project = Project.objects.get(identifier__iexact=project_identifier, workspace__slug=workspace_slug)

            # Get the issues
            issues = Issue.objects.filter(project=project, sequence_id=issue_sequence)
            # Check if there are duplicate issues
            if not issues.count() > 1:
                raise CommandError("No duplicate issues found with the given identifier")

            self.stdout.write(self.style.SUCCESS(f"{issues.count()} issues found with identifier {issue_identifier}"))
            with transaction.atomic():
                # This ensures only one transaction per project can execute this code at a time
                lock_key = convert_uuid_to_integer(project.id)

                # Acquire an exclusive lock using the project ID as the lock key
                with connection.cursor() as cursor:
                    # Get an exclusive lock using the project ID as the lock key
                    cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_key])

                # Get the maximum sequence ID for the project
                last_sequence = IssueSequence.objects.filter(project=project).aggregate(largest=Max("sequence"))[
                    "largest"
                ]

                bulk_issues = []
                bulk_issue_sequences = []

                issue_sequence_map = {isq.issue_id: isq for isq in IssueSequence.objects.filter(project=project)}

                # change the ids of duplicate issues
                for index, issue in enumerate(issues[1:]):
                    updated_sequence_id = last_sequence + index + 1
                    issue.sequence_id = updated_sequence_id
                    bulk_issues.append(issue)

                    # Find the same issue sequence instance from the above queryset
                    sequence_identifier = issue_sequence_map.get(issue.id)
                    if sequence_identifier:
                        sequence_identifier.sequence = updated_sequence_id
                        bulk_issue_sequences.append(sequence_identifier)

                Issue.objects.bulk_update(bulk_issues, ["sequence_id"])
                IssueSequence.objects.bulk_update(bulk_issue_sequences, ["sequence"])

            self.stdout.write(self.style.SUCCESS("Sequence IDs updated successfully"))
        except Exception as e:
            raise CommandError(str(e))
