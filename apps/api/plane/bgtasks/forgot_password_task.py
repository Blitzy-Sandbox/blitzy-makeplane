# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that emails a password-reset link to a user.

Trigger: explicit ``.delay(first_name, email, uidb64, token, current_site)``
from ``plane.authentication.views.app.password_management.ForgotPasswordEndpoint``
and ``plane.authentication.views.space.password_management.ForgotPasswordSpaceEndpoint``
when a user submits the forgot-password form.

Async infrastructure: queued onto RabbitMQ and consumed by Celery workers
(per the architectural rule that Celery routes through RabbitMQ while Redis is
reserved for caching and sessions only). Redis is not the task broker.
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
def forgot_password(first_name, email, uidb64, token, current_site):
    """Send the password-reset email to ``email`` via the instance SMTP backend.

    Trigger:
        Explicit ``forgot_password.delay(first_name, email, uidb64, token,
        current_site)`` from the forgot-password endpoints in
        ``plane.authentication.views.app.password_management`` and
        ``plane.authentication.views.space.password_management``. The Celery
        message is routed via RabbitMQ and consumed by the worker.

    Side effects:
        - Sends one SMTP email (multipart HTML + plain-text rendered from
          ``emails/auth/forgot_password.html``) to ``email`` using the
          instance-configured SMTP backend returned by
          ``get_email_configuration()``.
        - No database writes. No webhook fan-out. No cache invalidation.
        - On failure, the exception is swallowed and logged via
          ``log_exception``; the task does not retry automatically.

    Idempotency:
        NON-idempotent. Each invocation produces one outbound email; duplicate
        invocations result in duplicate emails. The caller is responsible for
        throttling at the request layer.

    Args:
        first_name: Recipient's first name used in the email greeting template.
        email: Recipient's email address (also the ``to:`` field).
        uidb64: Base64-encoded user id (Django default token framework).
        token: Signed password-reset token (Django default token framework).
        current_site: Scheme + host prefix used to build the absolute reset URL.

    Returns:
        None. The task is invoked for its email-sending side effect only.
    """
    try:
        relative_link = f"/accounts/reset-password/?uidb64={uidb64}&token={token}&email={email}"
        abs_url = str(current_site) + relative_link

        (
            EMAIL_HOST,
            EMAIL_HOST_USER,
            EMAIL_HOST_PASSWORD,
            EMAIL_PORT,
            EMAIL_USE_TLS,
            EMAIL_USE_SSL,
            EMAIL_FROM,
        ) = get_email_configuration()

        subject = "A new password to your Plane account has been requested"

        context = {
            "first_name": first_name,
            "forgot_password_url": abs_url,
            "email": email,
        }

        html_content = render_to_string("emails/auth/forgot_password.html", context)

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
        logging.getLogger("plane.worker").info("Email sent successfully")
        return
    except Exception as e:
        log_exception(e)
        return
