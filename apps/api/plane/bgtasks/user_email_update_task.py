# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery tasks for email-address-update verification and confirmation.

Two ``@shared_task``s live here:

1. ``send_email_update_magic_code`` — emails the magic-link verification code
   to a user's **proposed new** address. Triggered by
   ``plane.app.views.user.base.UserEndpoint`` when a user submits an email
   change request (see ``apps/api/plane/app/views/user/base.py:162``).

2. ``send_email_update_confirmation`` — emails a "your email address was
   updated" confirmation. Triggered TWICE from
   ``apps/api/plane/app/views/user/base.py:243`` and line 245 after a
   successful email change, so both the old and new addresses receive the
   confirmation.

Async infrastructure: queued onto **RabbitMQ** and consumed by Celery workers
(per AAP §0.2.2 architectural rule). Redis is **not** the task broker; it
holds the verification code as cache state.
"""

# Python imports
import logging

# Third party imports
from celery import shared_task

# Django imports
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string

# Module imports
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception


@shared_task
def send_email_update_magic_code(email, token):
    """Email the magic-link verification code to the user's *new* email address.

    Trigger:
        Explicit ``send_email_update_magic_code.delay(new_email, token)`` from
        ``apps/api/plane/app/views/user/base.py:162`` when a user submits an
        email change request. The Celery message is routed via **RabbitMQ** and
        consumed by the worker.

    Side effects:
        - Sends one SMTP email (multipart HTML+plain-text rendered from
          ``emails/auth/magic_signin.html`` with subject ``"Verify your new
          email address"``) to ``email`` using the instance-configured SMTP
          backend from ``get_email_configuration()``.
        - **No** database writes. **No** webhook fan-out. **No** cache
          invalidation. (The verification code has been written to Redis by the
          *caller*, not by this task.)

    Idempotency:
        NON-idempotent. Each invocation produces one outbound email; the caller
        is expected to throttle / regenerate-and-resend at the request layer.

    Args:
        email: The *new* email address being verified (recipient).
        token: One-time magic-link verification code embedded in the email
            subject and body.
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

        # Send the mail
        subject = "Verify your new email address"
        context = {"code": token, "email": email}

        html_content = render_to_string("emails/auth/magic_signin.html", context)
        text_content = generate_plain_text_from_html(html_content)

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
            to=[email],
            connection=connection,
        )
        msg.attach_alternative(html_content, "text/html")
        msg.send()
        logging.getLogger("plane.worker").info("Email sent successfully.")
        return
    except Exception as e:
        log_exception(e)
        return


@shared_task
def send_email_update_confirmation(email):
    """Send a confirmation email to the user after their email address has been successfully updated.

    Trigger:
        Explicit ``send_email_update_confirmation.delay(email)`` from
        ``apps/api/plane/app/views/user/base.py:243`` and line 245 after a
        successful email change. The caller invokes this task **twice** —
        once with the new email and once with the old — so both addresses
        receive a confirmation. The Celery message is routed via **RabbitMQ**
        and consumed by the worker.

    Side effects:
        - Sends one SMTP email (multipart HTML+plain-text rendered from
          ``emails/user/email_updated.html`` with subject ``"Plane email
          address successfully updated"``) using the instance-configured SMTP
          backend from ``get_email_configuration()``.
        - **No** database writes. **No** webhook fan-out. **No** cache
          invalidation.

    Idempotency:
        NON-idempotent. Each invocation produces one outbound email; the caller
        is expected to gate this on a one-shot email-change transition.

    Args:
        email: The new email address that was successfully updated (the
            recipient — the caller invokes this task once with the new
            address and once with the old to notify both).
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

        # Send the confirmation email
        subject = "Plane email address successfully updated"
        context = {"email": email}

        html_content = render_to_string("emails/user/email_updated.html", context)
        text_content = generate_plain_text_from_html(html_content)

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
            to=[email],
            connection=connection,
        )
        msg.attach_alternative(html_content, "text/html")
        msg.send()
        logging.getLogger("plane.worker").info(f"Email update confirmation sent successfully to {email}.")
        return
    except Exception as e:
        log_exception(e)
        return
