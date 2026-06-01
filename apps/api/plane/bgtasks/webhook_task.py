# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery tasks for the outbound webhook fan-out, retry, signed delivery, and auto-deactivation contract.

This module is THE platform's outbound webhook contract — when a
workspace configures a webhook URL, all matching activity is fanned
out through the four ``@shared_task`` entry points defined here:

1. ``webhook_activity`` — fan-out worker. Filters active workspace
   webhooks by event type (``project`` / ``issue`` / ``module`` /
   ``module_issue`` / ``cycle`` / ``cycle_issue`` / ``issue_comment``)
   and dispatches one ``webhook_send_task`` per matching webhook.
   Called directly from the project ``destroy`` endpoint and indirectly
   from ``model_activity`` (this module).

2. ``model_activity`` — diff-detector + dispatcher. Compares
   ``requested_data`` against ``current_instance`` (both JSON
   payloads), and chains to ``webhook_activity`` once per detected
   change (or once for the create case when ``current_instance`` is
   ``None``). Called from entity CRUD endpoints under
   ``apps/api/plane/app/views/`` and ``apps/api/plane/api/views/``.

3. ``webhook_send_task`` — HTTP delivery worker with built-in retry
   semantics, URL re-validation, HMAC-SHA256 signing, and
   auto-deactivation after ``max_retries`` exhaustion.

4. ``send_webhook_deactivation_email`` — sends an out-of-band SMTP
   notification when a webhook is auto-deactivated so the workspace
   admin can investigate / re-enable it.

Supported entity types (``SERIALIZER_MAPPER`` / ``MODEL_MAPPER``):
    ``project``, ``issue``, ``cycle``, ``module``, ``cycle_issue``,
    ``module_issue``, ``issue_comment``, ``user``, ``intake_issue``.

Retry semantics (``webhook_send_task`` decoration):
    ``bind=True, autoretry_for=(requests.RequestException,),
    retry_backoff=600, max_retries=5, retry_jitter=True``. Attempts
    run at approximately ``+0``, ``+10m``, ``+20m``, ``+40m``,
    ``+80m``, ``+160m`` from the initial dispatch (Celery's
    exponential backoff with random jitter to defeat
    worker-thundering-herd).

Security features (do NOT remove without a threat-model review):
    - **HMAC-SHA256 signing**: every payload is signed with the
      webhook's ``secret_key`` and the digest is sent in the
      ``X-Plane-Signature`` request header so the consumer can verify
      authenticity.
    - **URL re-validation at send time**: the destination host is
      re-resolved via ``plane.utils.ip_address.validate_url`` against
      ``settings.WEBHOOK_ALLOWED_IPS`` / ``settings.WEBHOOK_ALLOWED_HOSTS``
      and rejected if it now resolves to a private, loopback, or
      link-local IP. This defeats DNS-rebinding attacks where an
      attacker registers a domain that initially resolves to a public
      IP (passing the create-time check) but later resolves to an
      internal IP — without this re-validation, Plane workers would
      become DNS-rebinding gadgets.
    - **Auto-deactivation**: after ``max_retries`` consecutive
      failures the webhook's ``is_active`` flag is set to ``False``
      and an admin email is dispatched.

Async infrastructure: every task here is queued onto **RabbitMQ** and
consumed by Celery workers (per AAP §0.2.2 architectural rule). Redis
is **not** the task broker.

Each attempt is also recorded via :func:`save_webhook_log` — primary
write to the ``webhook_logs`` MongoDB collection with PostgreSQL
``WebhookLog`` fallback when Mongo is unreachable.

See tech spec §4.5 WEBHOOK DELIVERY WORKFLOW.
"""

import hashlib
import hmac
import json
import logging
import uuid

import requests
from typing import Any, Dict, List, Optional, Union

# Third party imports
from celery import shared_task

# Django imports
from django.conf import settings
from django.db.models import Prefetch
from django.core.mail import EmailMultiAlternatives, get_connection
from django.core.serializers.json import DjangoJSONEncoder
from django.template.loader import render_to_string
from django.core.exceptions import ObjectDoesNotExist

# Module imports
from plane.api.serializers import (
    CycleIssueSerializer,
    CycleSerializer,
    IssueCommentSerializer,
    IssueExpandSerializer,
    ModuleIssueSerializer,
    ModuleSerializer,
    ProjectSerializer,
    UserLiteSerializer,
    IntakeIssueSerializer,
)
from plane.db.models import (
    Cycle,
    CycleIssue,
    Issue,
    IssueComment,
    Module,
    ModuleIssue,
    Project,
    User,
    Webhook,
    WebhookLog,
    IntakeIssue,
    IssueLabel,
    IssueAssignee,
)
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception
from plane.utils.ip_address import validate_url
from plane.settings.mongo import MongoConnection


SERIALIZER_MAPPER = {
    "project": ProjectSerializer,
    "issue": IssueExpandSerializer,
    "cycle": CycleSerializer,
    "module": ModuleSerializer,
    "cycle_issue": CycleIssueSerializer,
    "module_issue": ModuleIssueSerializer,
    "issue_comment": IssueCommentSerializer,
    "user": UserLiteSerializer,
    "intake_issue": IntakeIssueSerializer,
}

MODEL_MAPPER = {
    "project": Project,
    "issue": Issue,
    "cycle": Cycle,
    "module": Module,
    "cycle_issue": CycleIssue,
    "module_issue": ModuleIssue,
    "issue_comment": IssueComment,
    "user": User,
    "intake_issue": IntakeIssue,
}


logger = logging.getLogger("plane.worker")


def get_issue_prefetches():
    """Return Django ``Prefetch`` objects that eagerly load labels and assignees for ``issue`` payload serialization."""
    return [
        Prefetch("label_issue", queryset=IssueLabel.objects.select_related("label")),
        Prefetch("issue_assignee", queryset=IssueAssignee.objects.select_related("assignee")),
    ]


def save_webhook_log(
    webhook: Webhook,
    request_method: str,
    request_headers: str,
    request_body: str,
    response_status: str,
    response_headers: str,
    response_body: str,
    retry_count: int,
    event_type: str,
) -> None:
    """Persist a webhook attempt to MongoDB, falling back to the ``WebhookLog`` table when Mongo is unreachable.

    Side effects:
        - **External write (primary)**: inserts one document into
          the ``webhook_logs`` MongoDB collection (see
          ``plane.settings.mongo.MongoConnection``). MongoDB handles
          high-volume webhook telemetry and retention.
        - **DB write (fallback)**: when the Mongo collection is
          ``None`` or the insert raises, the same payload is written
          to the ``WebhookLog`` PostgreSQL row so no delivery attempt
          is lost.
        - **Log**: failures of either write path are funneled through
          :func:`plane.utils.exception_logger.log_exception` and the
          module logger.

    Idempotency:
        NON-idempotent. Each invocation records one new log row /
        document regardless of whether the same attempt was previously
        logged.
    """
    # webhook_logs
    mongo_collection = MongoConnection.get_collection("webhook_logs")

    log_data = {
        "workspace_id": str(webhook.workspace_id),
        "webhook": str(webhook.id),
        "event_type": str(event_type),
        "request_method": str(request_method),
        "request_headers": str(request_headers),
        "request_body": str(request_body),
        "response_status": str(response_status),
        "response_headers": str(response_headers),
        "response_body": str(response_body),
        "retry_count": retry_count,
    }

    mongo_save_success = False
    if mongo_collection is not None:
        try:
            # insert the log data into the mongo collection
            mongo_collection.insert_one(log_data)
            logger.info("Webhook log saved successfully to mongo")
            mongo_save_success = True
        except Exception as e:
            log_exception(e, warning=True)
            logger.error(f"Failed to save webhook log: {e}")
            mongo_save_success = False

    # if the mongo save is not successful, save the log data into the database
    if not mongo_save_success:
        try:
            # insert the log data into the database
            WebhookLog.objects.create(**log_data)
            logger.info("Webhook log saved successfully to database")
        except Exception as e:
            log_exception(e, warning=True)
            logger.error(f"Failed to save webhook log: {e}")


def get_model_data(event: str, event_id: Union[str, List[str]], many: bool = False) -> Dict[str, Any]:
    """
    Retrieve and serialize model data based on the event type.

    Args:
        event (str): The type of event/model to retrieve data for
        event_id (Union[str, List[str]]): The ID or list of IDs of the model instance(s)
        many (bool): Whether to retrieve multiple instances

    Returns:
        Dict[str, Any]: Serialized model data

    Raises:
        ValueError: If serializer is not found for the event
        ObjectDoesNotExist: If model instance is not found
    """
    model = MODEL_MAPPER.get(event)
    if model is None:
        raise ValueError(f"Model not found for event: {event}")

    try:
        if many:
            queryset = model.objects.filter(pk__in=event_id)
        else:
            queryset = model.objects.get(pk=event_id)

        serializer = SERIALIZER_MAPPER.get(event)

        if serializer is None:
            raise ValueError(f"Serializer not found for event: {event}")

        issue_prefetches = get_issue_prefetches()
        if event == "issue":
            if many:
                queryset = queryset.prefetch_related(*issue_prefetches)
            else:
                issue_id = queryset.id
                queryset = model.objects.filter(pk=issue_id).prefetch_related(*issue_prefetches).first()

            return serializer(queryset, many=many, context={"expand": ["labels", "assignees"]}).data
        else:
            return serializer(queryset, many=many).data
    except ObjectDoesNotExist:
        raise ObjectDoesNotExist(f"No {event} found with id: {event_id}")


@shared_task
def send_webhook_deactivation_email(webhook_id: str, receiver_id: str, current_site: str, reason: str) -> None:
    """Email the workspace user that a webhook was auto-deactivated after exceeding ``max_retries``.

    Trigger:
        Explicit ``send_webhook_deactivation_email.delay(...)`` from
        :func:`webhook_send_task` when the retry chain exhausts
        (``self.request.retries >= self.max_retries`` with
        ``max_retries=5``). The Celery message is routed via
        **RabbitMQ** and consumed by the worker.

    Args:
        webhook_id: ID of the deactivated webhook (also used to build
            the deep-link URL into the workspace settings).
        receiver_id: ID of the user to notify — set to the webhook's
            ``created_by_id`` by the caller.
        current_site: Origin URL used to construct the absolute
            ``settings/webhooks/<id>`` link inside the email body.
        reason: Human-readable failure reason (the last ``requests``
            exception's ``str(e)``) embedded in the email template.

    Side effects:
        - **External**: sends one SMTP email to the receiving user
          notifying them the webhook is now disabled. SMTP credentials
          are resolved at runtime via
          :func:`plane.license.utils.instance_value.get_email_configuration`.
        - **DB read**: loads the ``User`` and ``Webhook`` rows by id
          to build the email body and recipient address.
        - **No** DB writes — the ``webhook.is_active = False`` flip
          is performed by :func:`webhook_send_task` before this task
          is dispatched.
        - **No** webhook fan-out (intentional — this is the
          out-of-band notification path when the webhook itself is
          broken).
        - **No** cache invalidation.

    Idempotency:
        NON-idempotent. Each invocation produces one outbound email;
        duplicate invocations send duplicate emails. Exceptions during
        delivery are logged via
        :func:`plane.utils.exception_logger.log_exception` and
        swallowed so the calling task is not retried.
    """
    try:
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
        webhook = Webhook.objects.get(pk=webhook_id)

        # Get the webhook payload
        subject = "Webhook Deactivated"
        message = f"Webhook {webhook.url} has been deactivated due to failed requests."

        # Send the mail
        context = {
            "email": receiver.email,
            "message": message,
            "webhook_url": f"{current_site}/{str(webhook.workspace.slug)}/settings/webhooks/{str(webhook.id)}",
        }
        html_content = render_to_string("emails/notifications/webhook-deactivate.html", context)
        text_content = generate_plain_text_from_html(html_content)

        # Set the email connection
        connection = get_connection(
            host=EMAIL_HOST,
            port=int(EMAIL_PORT),
            username=EMAIL_HOST_USER,
            password=EMAIL_HOST_PASSWORD,
            use_tls=EMAIL_USE_TLS == "1",
            use_ssl=EMAIL_USE_SSL == "1",
        )

        # Create the email message
        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_content,
            from_email=EMAIL_FROM,
            to=[receiver.email],
            connection=connection,
        )
        msg.attach_alternative(html_content, "text/html")
        msg.send()
        logger.info("Email sent successfully.")
    except Exception as e:
        log_exception(e, warning=True)
        logger.error(f"Failed to send email: {e}")


@shared_task(
    bind=True,
    autoretry_for=(requests.RequestException,),
    retry_backoff=600,
    max_retries=5,
    retry_jitter=True,
)
def webhook_send_task(
    self,
    webhook_id: str,
    slug: str,
    event: str,
    event_data: Optional[Dict[str, Any]],
    action: str,
    current_site: str,
    activity: Optional[Dict[str, Any]],
) -> None:
    """Deliver a signed webhook payload with retry, URL re-validation, and auto-deactivation on persistent failure.

    Decoration semantics:
        ``bind=True`` — receives the task instance as ``self`` so the
        body can read ``self.request.retries`` and ``self.max_retries``.
        ``autoretry_for=(requests.RequestException,)`` — Celery
        automatically re-enqueues this task on any ``requests``
        exception raised below (timeouts, connection failures,
        ``raise_for_status`` 5xx, etc.); the body also performs an
        explicit ``raise requests.RequestException()`` to trigger the
        same path when an attempt has not yet exhausted retries.
        ``retry_backoff=600`` — initial retry delay 600s (10 min),
        doubled on each subsequent retry by Celery's exponential
        backoff.
        ``max_retries=5`` — total attempts: 1 initial + 5 retries.
        ``retry_jitter=True`` — adds randomized jitter to the backoff
        to prevent worker-thundering-herd when many webhooks fail
        simultaneously.

    Trigger:
        Explicit ``webhook_send_task.delay(...)`` from
        :func:`webhook_activity` (this module). The Celery message is
        routed via **RabbitMQ** and consumed by the worker.

    Args:
        self: Celery task instance binding (provided by ``bind=True``).
        webhook_id: Primary key of the target :class:`Webhook` row.
        slug: Workspace slug used to scope the ``Webhook`` lookup so a
            webhook can never deliver cross-workspace.
        event: One of the keys in ``SERIALIZER_MAPPER`` / ``MODEL_MAPPER``
            (e.g. ``"project"``, ``"issue"``, ``"cycle"``,
            ``"module"``, ``"issue_comment"``); sent in the
            ``X-Plane-Event`` header.
        event_data: Pre-serialized entity payload (or ``None`` for a
            ``delete`` event where only the id is required).
        action: HTTP verb that triggered the activity (``POST`` /
            ``PATCH`` / ``PUT`` / ``DELETE``); normalized to a
            human-readable action (``create`` / ``update`` /
            ``delete``) before signing.
        current_site: Origin URL forwarded to
            :func:`send_webhook_deactivation_email` on the final
            failed attempt.
        activity: Optional dict with the field-level diff (``field``,
            ``old_value``, ``new_value``, ``actor``, identifiers)
            included alongside ``data`` in the signed payload.

    Side effects (per attempt):
        - **URL re-validation**: re-resolves the destination host via
          :func:`plane.utils.ip_address.validate_url` against
          ``settings.WEBHOOK_ALLOWED_IPS`` /
          ``settings.WEBHOOK_ALLOWED_HOSTS`` and rejects
          private / loopback / link-local IPs to defeat
          DNS-rebinding attacks (see module docstring).
        - **HMAC-SHA256 signing**: when ``webhook.secret_key`` is set,
          computes
          ``hmac.new(secret_key.encode('utf-8'), payload_bytes, hashlib.sha256).hexdigest()``
          (where ``payload_bytes`` is the UTF-8 JSON encoding of the
          payload) and attaches it as the ``X-Plane-Signature`` request
          header. ``X-Plane-Delivery`` carries a fresh UUID4 so
          consumers can deduplicate retries.
        - **External HTTP POST**: posts the signed JSON payload to
          ``webhook.url`` with a 30s timeout.
        - **Log write**: every attempt (success or failure) is
          recorded by :func:`save_webhook_log` (MongoDB primary,
          PostgreSQL ``WebhookLog`` fallback).
        - **DB write (final attempt)**: on
          ``self.request.retries >= self.max_retries``, sets
          ``webhook.is_active = False`` via a filtered
          ``Webhook.objects.update`` and returns without raising.
        - **Task chain (final attempt)**: dispatches
          ``send_webhook_deactivation_email.delay(webhook_id=...,
          receiver_id=webhook.created_by_id, reason=str(e),
          current_site=current_site)`` to notify the webhook owner.
        - **No** cache invalidation.

    Idempotency:
        NON-idempotent. Webhooks have **at-least-once** delivery
        semantics: the same payload may be delivered multiple times
        on transient failures (e.g. the remote server returns 5xx
        but actually persisted the request). Consumers MUST
        deduplicate using the ``X-Plane-Delivery`` UUID4 header (or
        an equivalent payload-level event id) to be safe.
    """
    try:
        webhook = Webhook.objects.get(id=webhook_id, workspace__slug=slug)

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Autopilot",
            "X-Plane-Delivery": str(uuid.uuid4()),
            "X-Plane-Event": event,
        }

        # # Your secret key
        event_data = json.loads(json.dumps(event_data, cls=DjangoJSONEncoder)) if event_data is not None else None

        activity = json.loads(json.dumps(activity, cls=DjangoJSONEncoder)) if activity is not None else None

        action = {
            "POST": "create",
            "PATCH": "update",
            "PUT": "update",
            "DELETE": "delete",
        }.get(action, action)

        payload = {
            "event": event,
            "action": action,
            "webhook_id": str(webhook.id),
            "workspace_id": str(webhook.workspace_id),
            "data": event_data,
            "activity": activity,
        }

        # Use HMAC for generating signature
        if webhook.secret_key:
            hmac_signature = hmac.new(
                webhook.secret_key.encode("utf-8"),
                json.dumps(payload).encode("utf-8"),
                hashlib.sha256,
            )
            signature = hmac_signature.hexdigest()
            headers["X-Plane-Signature"] = signature
    except Exception as e:
        log_exception(e)
        logger.error(f"Failed to send webhook: {e}")
        return

    try:
        # Re-validate the webhook URL at send time to prevent DNS-rebinding attacks
        validate_url(
            webhook.url,
            allowed_ips=settings.WEBHOOK_ALLOWED_IPS,
            allowed_hosts=settings.WEBHOOK_ALLOWED_HOSTS,
        )

        # Send the webhook event
        response = requests.post(webhook.url, headers=headers, json=payload, timeout=30)

        # Log the webhook request
        save_webhook_log(
            webhook=webhook,
            request_method=action,
            request_headers=headers,
            request_body=payload,
            response_status=response.status_code,
            response_headers=response.headers,
            response_body=response.text,
            retry_count=self.request.retries,
            event_type=event,
        )
        logger.info(f"Webhook {webhook.id} sent successfully")
    except requests.RequestException as e:
        # Log the failed webhook request
        save_webhook_log(
            webhook=webhook,
            request_method=action,
            request_headers=headers,
            request_body=payload,
            response_status=500,
            response_headers="",
            response_body=str(e),
            retry_count=self.request.retries,
            event_type=event,
        )
        logger.error(f"Webhook {webhook.id} failed with error: {e}")
        # Retry logic
        if self.request.retries >= self.max_retries:
            Webhook.objects.filter(pk=webhook.id).update(is_active=False)
            if webhook:
                # send email for the deactivation of the webhook
                send_webhook_deactivation_email.delay(
                    webhook_id=webhook.id,
                    receiver_id=webhook.created_by_id,
                    reason=str(e),
                    current_site=current_site,
                )
            return
        raise requests.RequestException()

    except Exception as e:
        log_exception(e)
        return


@shared_task
def webhook_activity(
    event: str,
    verb: str,
    field: Optional[str],
    old_value: Any,
    new_value: Any,
    actor_id: str | uuid.UUID,
    slug: str,
    current_site: str,
    event_id: str | uuid.UUID,
    old_identifier: Optional[str],
    new_identifier: Optional[str],
) -> None:
    """Fan out a workspace activity to every matching active webhook by dispatching :func:`webhook_send_task` per match.

    Trigger:
        Explicit ``webhook_activity.delay(...)``. Direct callers
        currently include :func:`model_activity` (this module) and
        the project ``destroy`` flow in
        ``apps/api/plane/app/views/project/base.py`` /
        ``apps/api/plane/api/views/project.py`` (where no field-level
        diff is needed). The Celery message is routed via **RabbitMQ**
        and consumed by the worker.

    Args:
        event: Entity type — one of ``project``, ``issue``,
            ``module``, ``module_issue``, ``cycle``, ``cycle_issue``,
            ``issue_comment`` (the keys filtered below). For events
            not in the filter list (``user``, ``intake_issue``), the
            workspace's full active-webhook set is used unfiltered.
        verb: ``created`` / ``updated`` / ``deleted``. When
            ``deleted``, the payload's ``data`` collapses to
            ``{"id": event_id}`` instead of a full serialization
            (the row may already be gone).
        field: Name of the changed field (``None`` for create /
            delete events).
        old_value: Previous value of ``field`` (or ``None``).
        new_value: New value of ``field`` (or ``None``).
        actor_id: ID of the user who performed the action; serialized
            via ``UserLiteSerializer`` and attached to the
            ``activity.actor`` field of the payload.
        slug: Workspace slug used to scope the ``Webhook`` query so
            no webhook can ever deliver cross-workspace.
        current_site: Origin URL forwarded to
            :func:`webhook_send_task` (and ultimately the deactivation
            email link).
        event_id: Primary key of the entity that emitted the event;
            re-fetched and serialized inside this task via
            :func:`get_model_data` to keep the snapshot fresh.
        old_identifier: Optional reference identifier paired with
            ``old_value`` (used by relation-style events).
        new_identifier: Optional reference identifier paired with
            ``new_value``.

    Side effects:
        - **DB read**: queries ``Webhook`` rows scoped by
          ``workspace__slug=slug`` and ``is_active=True``, then
          further filtered on the per-event boolean column
          (``Webhook.project`` / ``.issue`` / ``.module`` / ``.cycle``
          / ``.issue_comment``).
        - **Payload construction**: re-fetches the entity by id and
          serializes it via :func:`get_model_data` (which dispatches
          through ``SERIALIZER_MAPPER``); ``issue`` payloads are
          enriched with prefetched labels and assignees (see
          :func:`get_issue_prefetches`).
        - **Task fan-out**: dispatches
          ``webhook_send_task.delay(webhook_id, slug, event,
          event_data, action=verb, current_site, activity)`` once per
          matching webhook. Each downstream task is independent — one
          slow consumer does not block the others.
        - **No** direct DB writes (serializers may incidentally read
          additional rows).
        - **No** emails. **No** cache invalidation.
        - **Error handling**: ``ObjectDoesNotExist`` is swallowed
          silently to tolerate races where the source row was deleted
          between the activity write and this task running. Other
          exceptions are funneled through
          :func:`plane.utils.exception_logger.log_exception` and also
          swallowed (the task does **not** raise to Celery — at the
          fan-out layer we never want to retry a missing-row event).

    Idempotency:
        NON-idempotent. Each invocation enqueues fan-out tasks;
        duplicate invocations produce duplicate downstream deliveries.
    """
    try:
        webhooks = Webhook.objects.filter(workspace__slug=slug, is_active=True)

        if event == "project":
            webhooks = webhooks.filter(project=True)

        if event == "issue":
            webhooks = webhooks.filter(issue=True)

        if event == "module" or event == "module_issue":
            webhooks = webhooks.filter(module=True)

        if event == "cycle" or event == "cycle_issue":
            webhooks = webhooks.filter(cycle=True)

        if event == "issue_comment":
            webhooks = webhooks.filter(issue_comment=True)

        for webhook in webhooks:
            webhook_send_task.delay(
                webhook_id=webhook.id,
                slug=slug,
                event=event,
                event_data=({"id": event_id} if verb == "deleted" else get_model_data(event=event, event_id=event_id)),
                action=verb,
                current_site=current_site,
                activity={
                    "field": field,
                    "new_value": new_value,
                    "old_value": old_value,
                    "actor": get_model_data(event="user", event_id=actor_id),
                    "old_identifier": old_identifier,
                    "new_identifier": new_identifier,
                },
            )
        return
    except Exception as e:
        # Return if a does not exist error occurs
        if isinstance(e, ObjectDoesNotExist):
            return
        if settings.DEBUG:
            print(e)
        log_exception(e)
        return


@shared_task
def model_activity(model_name, model_id, requested_data, current_instance, actor_id, slug, origin=None):
    """Detect entity field-level changes and chain to :func:`webhook_activity` once per detected change.

    Distinct from :func:`webhook_activity`: this task does NOT itself
    fan out to webhooks. It is the **diff-detector** that turns a
    high-level entity CRUD operation into a sequence of per-field
    ``updated`` events (or a single ``created`` event when there is
    no prior state).

    Trigger:
        Explicit ``model_activity.delay(...)`` from entity CRUD view
        methods. Direct callers include
        ``apps/api/plane/app/views/project/base.py``,
        ``apps/api/plane/app/views/cycle/base.py``,
        ``apps/api/plane/app/views/module/base.py``,
        ``apps/api/plane/app/views/issue/base.py``,
        ``apps/api/plane/app/views/issue/comment.py``,
        ``apps/api/plane/api/views/project.py``,
        ``apps/api/plane/api/views/cycle.py``,
        ``apps/api/plane/api/views/module.py``, and
        ``apps/api/plane/api/views/issue.py``. The Celery message is
        routed via **RabbitMQ** and consumed by the worker.

    Args:
        model_name: Entity type passed through to ``event`` on
            :func:`webhook_activity` (e.g. ``"project"``, ``"cycle"``,
            ``"module"``, ``"issue"``, ``"issue_comment"``).
        model_id: Primary key of the modified entity.
        requested_data: ``dict`` of fields the client submitted on
            the write request.
        current_instance: JSON-serialized snapshot of the row as it
            existed BEFORE the write. ``None`` indicates a create
            (no prior state) — in that case a single ``created``
            event is emitted and the diff loop is skipped.
        actor_id: ID of the user who performed the action;
            propagated to :func:`webhook_activity`.
        slug: Workspace slug used to scope downstream webhook
            queries.
        origin: Origin URL forwarded as ``current_site`` to
            :func:`webhook_activity` (and ultimately to the
            deactivation email link). Defaults to ``None``.

    Side effects:
        - **Task chain (create)**: when ``current_instance`` is
          ``None``, dispatches a single
          ``webhook_activity.delay(verb="created", field=None, ...)``.
        - **Task chain (update)**: otherwise iterates over the keys
          of ``requested_data``, compares them against
          ``json.loads(current_instance)``, and dispatches one
          ``webhook_activity.delay(verb="updated", field=<key>,
          old_value=<prev>, new_value=<requested>, ...)`` per key
          whose value changed.
        - **No** direct DB reads or writes.
        - **No** emails. **No** cache invalidation.

    Idempotency:
        NON-idempotent. Each invocation enqueues fan-out tasks;
        duplicate invocations produce duplicate downstream
        deliveries.
    """
    if current_instance is None:
        webhook_activity.delay(
            event=model_name,
            verb="created",
            field=None,
            old_value=None,
            new_value=None,
            actor_id=actor_id,
            slug=slug,
            current_site=origin,
            event_id=model_id,
            old_identifier=None,
            new_identifier=None,
        )
        return

    # Load the current instance
    current_instance = json.loads(current_instance) if current_instance is not None else None

    # Loop through all keys in requested data and check the current value and requested value
    for key in requested_data:
        # Check if key is present in current instance or not
        if key in current_instance:
            current_value = current_instance.get(key, None)
            requested_value = requested_data.get(key, None)
            if current_value != requested_value:
                webhook_activity.delay(
                    event=model_name,
                    verb="updated",
                    field=key,
                    old_value=current_value,
                    new_value=requested_value,
                    actor_id=actor_id,
                    slug=slug,
                    current_site=origin,
                    event_id=model_id,
                    old_identifier=None,
                    new_identifier=None,
                )

    return
