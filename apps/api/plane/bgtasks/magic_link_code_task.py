# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that emails the magic-link / passwordless login code.

Trigger: explicit ``magic_link.delay(email, key, token)`` from
``plane.authentication.views.app.magic.MagicGenerateEndpoint`` and the
``space``-side equivalent, invoked when a user requests a magic-link login.

Async infrastructure: queued onto **RabbitMQ** and consumed by Celery workers
(per the project architectural rule "Celery via RabbitMQ"). Redis is NOT the
task broker; Redis is used elsewhere in the auth flow strictly for caching
the issued ``key``/``token`` pair.
"""

# Python imports
import logging

# Third party imports
from celery import shared_task

# Django imports
# Third party imports
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string

# Module imports
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception


@shared_task
def magic_link(email, key, token):
    """Send the magic-link login code email to ``email`` via the instance SMTP backend.

    Trigger:
        Explicit ``magic_link.delay(email, key, token)`` from
        ``plane.authentication.views.app.magic.MagicGenerateEndpoint`` and
        the ``space``-side equivalent. The Celery message is routed via
        **RabbitMQ** and consumed by the worker.

    Side effects:
        - Sends one SMTP email (multipart HTML + plain-text rendered from
          ``emails/auth/magic_signin.html``) to ``email`` using the
          instance-configured SMTP backend from ``get_email_configuration()``.
        - Email subject embeds the ``token`` directly so users can read the
          code without opening the message body.
        - **No** database writes. **No** webhook fan-out. **No** cache
          invalidation. (The token is written to Redis by the caller, not by
          this task.)
        - On any exception the failure is recorded via ``log_exception`` and
          the task returns silently rather than raising; this prevents the
          worker from retrying and disclosing the code in a re-delivery.

    Idempotency:
        NON-idempotent. Each invocation produces one outbound email; duplicate
        invocations result in duplicate emails. The caller is responsible for
        throttling at the request layer.

    Args:
        email: Recipient's email address (also the login identifier).
        key: Redis key under which the auth side stored the token; accepted
            for signature parity with the caller but not consumed by this
            task body.
            # INTENT UNCLEAR: 'key' is accepted but never referenced inside
            # this function; likely retained for parity with the caller
            # signature and future audit logging.
        token: One-time magic-link code embedded in the email subject and
            body.
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
        subject = f"Your unique Plane login code is {token}"
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
