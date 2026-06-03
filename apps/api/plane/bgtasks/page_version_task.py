# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that maintains ``PageVersion`` snapshots with coalescing + retention.

Trigger: explicit ``track_page_version.delay(page_id, existing_instance, user_id)``
from ``apps/api/plane/app/views/page/base.py`` after a page save (part of the
apps/live callback chain).

Coalescing window:
    ``PAGE_VERSION_TASK_TIMEOUT = 600`` seconds (10 minutes). Within this
    window for the SAME user, the most recent ``PageVersion`` row is
    updated in place rather than creating a new row -- this prevents
    accumulating dozens of versions during a single editing session.

Retention cap:
    20 versions per page. After the write the oldest excess version is
    hard-deleted so the per-page row count never exceeds the cap.

Async infrastructure: queued onto RabbitMQ and consumed by Celery workers
(per the project architectural rule that Celery uses RabbitMQ as broker;
Redis is reserved for caching / sessions and is not the task broker).
"""

# Python imports
import json


# Third party imports
from celery import shared_task

# Django imports
from django.utils import timezone

# Module imports
from plane.db.models import Page, PageVersion
from plane.utils.exception_logger import log_exception

PAGE_VERSION_TASK_TIMEOUT = 600

@shared_task
def track_page_version(page_id, existing_instance, user_id):
    """Create or update a ``PageVersion`` snapshot, enforcing the 20-version cap.

    Trigger:
        Explicit ``track_page_version.delay(page_id, existing_instance,
        user_id)`` from ``apps/api/plane/app/views/page/base.py`` after a
        page save. Part of the apps/live callback chain. The Celery
        message is routed via RabbitMQ and consumed by the worker.

    Side effects:
        - DB write (one of two paths):
            * UPDATE path -- if the most recent ``PageVersion`` for this
              page was created by ``user_id`` within
              ``PAGE_VERSION_TASK_TIMEOUT`` seconds (600 s = 10 min),
              that row is updated in place with the new content.
            * CREATE path -- otherwise a fresh ``PageVersion`` row is
              created.
        - DB delete (cap enforcement): if the page has more than 20
          versions after the write, the oldest excess version is
          hard-deleted.
        - Short-circuits silently when the ``Page`` no longer exists
          (``Page.DoesNotExist``) or the incoming ``description_html``
          matches the live page (no content change).
        - No emails. No webhook fan-out. No cache invalidation.

    Idempotency:
        NON-idempotent. Repeated calls inside the same coalesce window
        for the same user converge on the same final content but mutate
        the version row (its ``updated_at`` is bumped each call). Calls
        outside the coalesce window or by a different user produce a
        new ``PageVersion`` row, so the side effect is path-dependent.

    Args:
        page_id: Primary key of the ``Page`` being versioned.
        existing_instance: JSON-encoded snapshot of the page's previous
            content (``description_html`` / ``description_json`` / etc.)
            used to detect whether the description actually changed.
        user_id: Primary key of the user whose edit triggered the
            version; stored on the resulting ``PageVersion`` row as
            ``owned_by_id`` and used to gate the coalesce window.
    """
    try:
        # Get the page
        page = Page.objects.get(id=page_id)

        # Get the current instance
        current_instance = json.loads(existing_instance) if existing_instance is not None else {}
        sub_pages = {}


        # Create a version if description_html is updated
        if current_instance.get("description_html") != page.description_html:
            # Fetch the latest page version
            page_version = PageVersion.objects.filter(page_id=page_id).order_by("-last_saved_at").first()

            # Get the latest page version if it exists and is owned by the user
            if (
                page_version
                and str(page_version.owned_by_id) == str(user_id)
                and (timezone.now() - page_version.last_saved_at).total_seconds() <= PAGE_VERSION_TASK_TIMEOUT
            ):
                page_version.description_html = page.description_html
                page_version.description_binary = page.description_binary
                page_version.description_json = page.description
                page_version.description_stripped = page.description_stripped
                page_version.sub_pages_data = sub_pages
                page_version.save(
                    update_fields=[
                        "description_html",
                        "description_binary",
                        "description_json",
                        "description_stripped",
                        "sub_pages_data",
                        "updated_at"
                    ]
                )
            else:
                # Create a new page version
                PageVersion.objects.create(
                    page_id=page_id,
                    workspace_id=page.workspace_id,
                    description_json=page.description,
                    description_html=page.description_html,
                    description_binary=page.description_binary,
                    description_stripped=page.description_stripped,
                    owned_by_id=user_id,
                    last_saved_at=timezone.now(),
                    sub_pages_data=sub_pages,
                )
            # If page versions are greater than 20 delete the oldest one
            if PageVersion.objects.filter(page_id=page_id).count() > 20:
                # Delete the old page version
                PageVersion.objects.filter(page_id=page_id).order_by("last_saved_at").first().delete()

        return
    except Page.DoesNotExist:
        return
    except Exception as e:
        log_exception(e)
        return
