# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery tasks for the second half of the notification pipeline: aggregation + email dispatch.

Two ``@shared_task`` callables live here:

1. ``stack_email_notification`` — Beat-scheduled aggregator that runs
   every 5 minutes (see the
   ``check-every-five-minutes-to-send-email-notifications`` entry in
   ``apps/api/plane/celery.py``). It bundles pending
   ``EmailNotificationLog`` rows by ``(receiver, issue)`` so a user
   receives ONE consolidated email per issue per 5-minute window
   instead of one email per change.
2. ``send_email_notification`` — chained from the aggregator via
   ``send_email_notification.delay(...)``; renders and sends the
   actual SMTP email for one ``(receiver, issue)`` group.

Companion: ``apps/api/plane/bgtasks/notification_task.py`` writes the
``EmailNotificationLog`` rows that this aggregator consumes.

Redis is used here in two ways, both of which are caching / coordination
semantics (NOT a Celery broker):

- ``send_email_notification`` calls :func:`acquire_lock` /
  :func:`release_lock` (SET NX EX with a 300-second TTL) keyed by
  ``send_email_notif_<issue_id>_<receiver_id>_<sorted_log_ids>`` to
  guarantee that an identical aggregated batch is not dispatched
  twice if the same Celery task body is delivered to two workers.
- ``send_email_notification`` reads the workspace's frontend base URL
  from ``redis_instance().get(str(issue_id))``; when that key is
  absent the task returns early without sending.

Async infrastructure: every ``@shared_task`` here is queued onto
**RabbitMQ** and consumed by Celery workers (per the architectural
rule that RabbitMQ is the task broker; Redis is used only for
caching and coordination).

See tech spec section 4.6 NOTIFICATION PIPELINE WORKFLOW.
"""

import logging
import re
from datetime import datetime

from bs4 import BeautifulSoup

# Third party imports
from celery import shared_task
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string

# Django imports
from django.utils import timezone

# Module imports
from plane.db.models import EmailNotificationLog, Issue, User
from plane.license.utils.instance_value import get_email_configuration
from plane.settings.redis import redis_instance
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception


def remove_unwanted_characters(input_text):
    """Strip ASCII / Latin-1 control characters from ``input_text`` so it is safe to use as an email subject line."""
    # Remove only control characters and potentially problematic characters for email subjects
    processed_text = re.sub(r"[\x00-\x1F\x7F-\x9F]", "", input_text)
    return processed_text


# acquire and delete redis lock
def acquire_lock(lock_id, expire_time=300):
    """Acquire a Redis lock at ``lock_id`` for ``expire_time`` seconds via ``SET NX EX``.

    Returns truthy on first acquisition, ``None`` if the key already
    exists. Used by :func:`send_email_notification` to dedupe accidental
    duplicate deliveries of the same aggregated batch.
    """
    redis_client = redis_instance()
    """Attempt to acquire a lock with a specified expiration time."""
    return redis_client.set(lock_id, "true", nx=True, ex=expire_time)


def release_lock(lock_id):
    """Release a lock."""
    redis_client = redis_instance()
    redis_client.delete(lock_id)


@shared_task
def stack_email_notification():
    """Aggregate pending ``EmailNotificationLog`` rows and dispatch one consolidated email per ``(receiver, issue)``.

    Trigger:
        Celery Beat — every 5 minutes — via the
        ``check-every-five-minutes-to-send-email-notifications`` schedule
        entry in ``apps/api/plane/celery.py``. The Celery message is
        routed through **RabbitMQ** and consumed by the worker.

    Side effects:
        - **DB read**: queries every ``EmailNotificationLog`` row with
          ``processed_at__isnull=True`` and groups them in-process by
          ``receiver_id`` and then by ``entity_identifier`` (issue id).
        - **Task dispatch**: for every ``(receiver, issue)`` pair,
          ``send_email_notification.delay(issue_id, notification_data,
          receiver_id, email_notification_ids)`` is enqueued onto
          RabbitMQ to render and send the actual email.
        - **DB write**: every aggregated row's ``processed_at`` is set
          to ``timezone.now()`` so it is not re-aggregated on the next
          5-minute Beat tick. This is the idempotency primitive for
          this task.
        - **No** outbound SMTP from this function (delegated to
          ``send_email_notification``).
        - **No** webhook fan-out. **No** cache invalidation.

    Idempotency:
        IDEMPOTENT through the ``processed_at`` flag pattern. The
        ``processed_at__isnull=True`` filter ensures each
        ``EmailNotificationLog`` row is read at most once across all
        Beat ticks; the terminal bulk update marks them processed even
        if delivery fails downstream (delivery is the responsibility
        of ``send_email_notification``, which carries its own Redis
        dedup lock).
    """
    # get all email notifications
    email_notifications = EmailNotificationLog.objects.filter(processed_at__isnull=True).order_by("receiver").values()

    # Create the below format for each of the issues
    # {"issue_id" : { "actor_id1": [ { data }, { data } ], "actor_id2": [ { data }, { data } ] }}

    # Convert to unique receivers list
    receivers = list(set([str(notification.get("receiver_id")) for notification in email_notifications]))
    processed_notifications = []
    # Loop through all the issues to create the emails
    for receiver_id in receivers:
        # Notification triggered for the receiver
        receiver_notifications = [
            notification for notification in email_notifications if str(notification.get("receiver_id")) == receiver_id
        ]
        # create payload for all issues
        payload = {}
        email_notification_ids = []
        for receiver_notification in receiver_notifications:
            payload.setdefault(receiver_notification.get("entity_identifier"), {}).setdefault(
                str(receiver_notification.get("triggered_by_id")), []
            ).append(receiver_notification.get("data"))
            # append processed notifications
            processed_notifications.append(receiver_notification.get("id"))
            email_notification_ids.append(receiver_notification.get("id"))

        # Create emails for all the issues
        for issue_id, notification_data in payload.items():
            send_email_notification.delay(
                issue_id=issue_id,
                notification_data=notification_data,
                receiver_id=receiver_id,
                email_notification_ids=email_notification_ids,
            )

    # Update the email notification log
    EmailNotificationLog.objects.filter(pk__in=processed_notifications).update(processed_at=timezone.now())


def create_payload(notification_data):
    """Fold per-actor ``IssueActivity`` change lists into a deduplicated email-rendering structure.

    Output shape::

        {actor_id: {field: {"old_value": [...], "new_value": [...], "activity_time": "<UTC>"}}}
    """
    # return format {"actor_id":  { "key": { "old_value": [], "new_value": [] } }}
    data = {}
    for actor_id, changes in notification_data.items():
        for change in changes:
            issue_activity = change.get("issue_activity")
            if issue_activity:  # Ensure issue_activity is not None
                field = issue_activity.get("field")
                old_value = str(issue_activity.get("old_value"))
                new_value = str(issue_activity.get("new_value"))

                # Append old_value if it's not empty and not already in the list
                if old_value:
                    (
                        data.setdefault(actor_id, {})
                        .setdefault(field, {})
                        .setdefault("old_value", [])
                        .append(old_value)
                        if old_value not in data.setdefault(actor_id, {}).setdefault(field, {}).get("old_value", [])
                        else None
                    )

                # Append new_value if it's not empty and not already in the list
                if new_value:
                    (
                        data.setdefault(actor_id, {})
                        .setdefault(field, {})
                        .setdefault("new_value", [])
                        .append(new_value)
                        if new_value not in data.setdefault(actor_id, {}).setdefault(field, {}).get("new_value", [])
                        else None
                    )

                if not data.get("actor_id", {}).get("activity_time", False):
                    data[actor_id]["activity_time"] = str(
                        datetime.fromisoformat(issue_activity.get("activity_time").rstrip("Z")).strftime(
                            "%Y-%m-%d %H:%M:%S"
                        )
                    )

    return data


def process_mention(mention_component):
    """Replace ``<mention-component>`` tags in ``mention_component`` HTML with ``@<display_name>`` plain text.

    Each tag's ``entity_identifier`` attribute is resolved against the
    ``User`` table so the rendered email body shows readable handles
    instead of raw HTML mention markup.
    """
    soup = BeautifulSoup(mention_component, "html.parser")
    mentions = soup.find_all("mention-component")
    for mention in mentions:
        user_id = mention["entity_identifier"]
        user = User.objects.get(pk=user_id)
        user_name = user.display_name
        highlighted_name = f"@{user_name}"
        mention.replace_with(highlighted_name)
    return str(soup)


def process_html_content(content):
    """Apply :func:`process_mention` to each HTML string in ``content`` (a list); pass ``None`` through unchanged."""
    if content is None:
        return None
    processed_content_list = []
    for html_content in content:
        processed_content = process_mention(html_content)
        processed_content_list.append(processed_content)
    return processed_content_list


@shared_task
def send_email_notification(issue_id, notification_data, receiver_id, email_notification_ids):
    """Render and send one consolidated notification email for ``(receiver_id, issue_id)``.

    Trigger:
        Explicit ``send_email_notification.delay(issue_id,
        notification_data, receiver_id, email_notification_ids)`` from
        :func:`stack_email_notification`. There is no other call site
        in the codebase. The Celery message is routed through
        **RabbitMQ** and consumed by the worker.

    Side effects:
        - **Redis lock acquire**: :func:`acquire_lock` is called with
          ``lock_id = f"send_email_notif_{issue_id}_{receiver_id}_{sorted_ids}"``
          and a 300-second TTL (the ``expire_time`` default). If the
          key already exists (i.e. the same batch was just queued
          twice), the task short-circuits and logs
          ``"Duplicate email received skipping"``.
        - **Redis cache read**: ``redis_instance().get(str(issue_id))``
          is read to resolve the workspace's frontend base URL used
          when building the issue / project / preference links in the
          email body. If the key is absent the task returns without
          sending.
        - **DB read**: the receiver ``User`` row, the ``Issue`` row,
          and one ``User`` row per actor referenced in
          ``notification_data``.
        - **HTML parse**: :func:`process_mention` /
          :func:`process_html_content` walk the comment / mention HTML
          via BeautifulSoup and rewrite ``mention-component`` tags as
          ``@<display_name>`` text so the rendered email is readable
          plaintext-equivalent.
        - **External (SMTP)**: one ``EmailMultiAlternatives`` message
          (plaintext + HTML alternative) is sent over the SMTP
          connection built from
          :func:`plane.license.utils.instance_value.get_email_configuration`
          (instance-admin-configured ``EMAIL_HOST`` / port / TLS / SSL
          / from-address).
        - **DB write**: on successful send, every
          ``EmailNotificationLog`` row in ``email_notification_ids``
          has its ``sent_at`` set to ``timezone.now()``.
        - **Redis lock release**: :func:`release_lock` is called on
          every exit path (success, SMTP failure,
          ``Issue.DoesNotExist`` / ``User.DoesNotExist``, generic
          exception).
        - **No** webhook fan-out. **No** Plane cache invalidation.

    Idempotency:
        NON-idempotent at the SMTP layer (each successful invocation
        produces one email). Protected upstream in two layers:
        :func:`stack_email_notification` marks every
        ``EmailNotificationLog`` row as processed exactly once per
        Beat tick, and this task's own Redis ``SET NX EX`` lock keyed
        on ``(issue_id, receiver_id, sorted_email_notification_ids)``
        deduplicates accidental duplicate Celery deliveries of the
        same aggregated batch.

    Args:
        issue_id: Primary key of the ``Issue`` the consolidated email
            describes.
        notification_data: Mapping of ``{triggered_by_id: [activity_payload, ...]}``
            assembled by :func:`stack_email_notification` from the
            grouped ``EmailNotificationLog.data`` rows; consumed by
            :func:`create_payload`.
        receiver_id: Primary key of the ``User`` to email.
        email_notification_ids: List of ``EmailNotificationLog``
            primary keys covered by this consolidated email. Used to
            build the Redis lock key (so the lock is unique per batch)
            and to bulk-update ``sent_at`` after a successful send.
    """
    # Convert UUIDs to a sorted, concatenated string
    sorted_ids = sorted(email_notification_ids)
    ids_str = "_".join(str(id) for id in sorted_ids)
    lock_id = f"send_email_notif_{issue_id}_{receiver_id}_{ids_str}"

    # acquire the lock for sending emails
    try:
        if acquire_lock(lock_id=lock_id):
            # get the redis instance
            ri = redis_instance()
            base_api = ri.get(str(issue_id)).decode() if ri.get(str(issue_id)) else None

            # Skip if base api is not present
            if not base_api:
                return

            data = create_payload(notification_data=notification_data)

            # Get email configurations
            (
                EMAIL_HOST,
                EMAIL_HOST_USER,
                EMAIL_HOST_PASSWORD,
                EMAIL_PORT,
                EMAIL_USE_TLS,
                EMAIL_USE_SSL,
                EMAIL_FROM,
            ) = get_email_configuration()

            receiver = User.objects.get(pk=receiver_id)
            issue = Issue.objects.get(pk=issue_id)
            template_data = []
            total_changes = 0
            comments = []
            actors_involved = []
            for actor_id, changes in data.items():
                actor = User.objects.get(pk=actor_id)
                total_changes = total_changes + len(changes)
                comment = changes.pop("comment", False)
                mention = changes.pop("mention", False)
                actors_involved.append(actor_id)
                if comment:
                    comments.append(
                        {
                            "actor_comments": comment,
                            "actor_detail": {
                                "avatar_url": f"{base_api}{actor.avatar_url}",
                                "first_name": actor.first_name,
                                "last_name": actor.last_name,
                            },
                        }
                    )
                if mention:
                    mention["new_value"] = process_html_content(mention.get("new_value"))
                    mention["old_value"] = process_html_content(mention.get("old_value"))
                    comments.append(
                        {
                            "actor_comments": mention,
                            "actor_detail": {
                                "avatar_url": f"{base_api}{actor.avatar_url}",
                                "first_name": actor.first_name,
                                "last_name": actor.last_name,
                            },
                        }
                    )
                activity_time = changes.pop("activity_time")
                # Parse the input string into a datetime object
                formatted_time = datetime.strptime(activity_time, "%Y-%m-%d %H:%M:%S").strftime("%H:%M %p")

                if changes:
                    template_data.append(
                        {
                            "actor_detail": {
                                "avatar_url": f"{base_api}{actor.avatar_url}",
                                "first_name": actor.first_name,
                                "last_name": actor.last_name,
                            },
                            "changes": changes,
                            "issue_details": {
                                "name": issue.name,
                                "identifier": f"{issue.project.identifier}-{issue.sequence_id}",
                            },
                            "activity_time": str(formatted_time),
                        }
                    )

            summary = "Updates were made to the issue by"

            # Send the mail
            subject = f"{issue.project.identifier}-{issue.sequence_id} {remove_unwanted_characters(issue.name)}"
            context = {
                "data": template_data,
                "summary": summary,
                "actors_involved": len(set(actors_involved)),
                "issue": {
                    "issue_identifier": f"{str(issue.project.identifier)}-{str(issue.sequence_id)}",
                    "name": issue.name,
                    "issue_url": f"{base_api}/{str(issue.project.workspace.slug)}/projects/{str(issue.project.id)}/issues/{str(issue.id)}",  # noqa: E501
                },
                "receiver": {"email": receiver.email},
                "issue_url": f"{base_api}/{str(issue.project.workspace.slug)}/projects/{str(issue.project.id)}/issues/{str(issue.id)}",  # noqa: E501
                "project_url": f"{base_api}/{str(issue.project.workspace.slug)}/projects/{str(issue.project.id)}/issues/",  # noqa: E501
                "workspace": str(issue.project.workspace.slug),
                "project": str(issue.project.name),
                "user_preference": f"{base_api}/{str(issue.project.workspace.slug)}/settings/account/notifications/",
                "comments": comments,
                "entity_type": "issue",
            }
            html_content = render_to_string("emails/notifications/issue-updates.html", context)
            text_content = generate_plain_text_from_html(html_content)

            try:
                connection = get_connection(
                    host=EMAIL_HOST,
                    port=int(EMAIL_PORT),
                    username=EMAIL_HOST_USER,
                    password=EMAIL_HOST_PASSWORD,
                    use_tls=EMAIL_USE_TLS == "1",
                    use_ssl=EMAIL_USE_SSL == "1",
                )

                msg = EmailMultiAlternatives(
                    subject=subject,
                    body=text_content,
                    from_email=EMAIL_FROM,
                    to=[receiver.email],
                    connection=connection,
                )
                msg.attach_alternative(html_content, "text/html")
                msg.send()
                logging.getLogger("plane.worker").info("Email Sent Successfully")

                # Update the logs
                EmailNotificationLog.objects.filter(pk__in=email_notification_ids).update(sent_at=timezone.now())

                # release the lock
                release_lock(lock_id=lock_id)
                return
            except Exception as e:
                log_exception(e)
                # release the lock
                release_lock(lock_id=lock_id)
                return
        else:
            logging.getLogger("plane.worker").info("Duplicate email received skipping")
            return
    except (Issue.DoesNotExist, User.DoesNotExist):
        release_lock(lock_id=lock_id)
        return
    except Exception as e:
        log_exception(e)
        release_lock(lock_id=lock_id)
        return
