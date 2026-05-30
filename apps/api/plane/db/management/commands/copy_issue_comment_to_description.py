# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command to backfill ``Description`` rows from legacy ``IssueComment`` records."""

# Django imports
from django.core.management.base import BaseCommand
from django.db import transaction

# Module imports
from plane.db.models import Description
from plane.db.models import IssueComment


class Command(BaseCommand):
    """Create ``Description`` rows for every ``IssueComment`` that has no ``description_id`` yet.

    CLI signature:
        ``python manage.py copy_issue_comment_to_description``

    Side effects:
        - Bulk-inserts ``Description`` rows mirroring each unlinked ``IssueComment``'s
          ``comment_json`` / ``comment_html`` / ``comment_stripped`` payload (plus
          audit and tenancy fields).
        - Bulk-updates ``IssueComment.description_id`` to point at the newly created
          ``Description`` rows.
        - Each batch of 500 rows is processed inside a single ``transaction.atomic()``
          block so partial failures roll back cleanly.

    Idempotency:
        Idempotent across re-runs because the query filters on
        ``description_id__isnull=True`` — once a comment is linked to a description it
        is excluded from subsequent passes.

    Trigger context:
        One-time data backfill assisting the migration from ``IssueComment``'s legacy
        inline body fields to the unified ``Description`` table.
    """

    help = "Create Description records for existing IssueComment"

    def handle(self, *args, **kwargs):
        """Loop through unlinked ``IssueComment`` rows in batches of 500 and link each to a new ``Description``."""
        batch_size = 500

        while True:
            comments = list(
                IssueComment.objects.filter(description_id__isnull=True).order_by("created_at")[:batch_size]
            )

            if not comments:
                break

            with transaction.atomic():
                descriptions = [
                    Description(
                        created_at=comment.created_at,
                        updated_at=comment.updated_at,
                        description_json=comment.comment_json,
                        description_html=comment.comment_html,
                        description_stripped=comment.comment_stripped,
                        project_id=comment.project_id,
                        created_by_id=comment.created_by_id,
                        updated_by_id=comment.updated_by_id,
                        workspace_id=comment.workspace_id,
                    )
                    for comment in comments
                ]

                created_descriptions = Description.objects.bulk_create(descriptions)

                comments_to_update = []
                for comment, description in zip(comments, created_descriptions):
                    comment.description_id = description.id
                    comments_to_update.append(comment)

                IssueComment.objects.bulk_update(comments_to_update, ["description_id"])

        self.stdout.write(self.style.SUCCESS("Successfully Copied IssueComment to Description"))
