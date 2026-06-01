# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that emails the account-activation confirmation to a user.

Trigger: explicit ``user_activation_email.delay(current_site, user_id)`` from
the OAuth / magic-link / email-password sign-in path in
``plane.authentication.adapter.base.Adapter.set_user_data`` (see
``apps/api/plane/authentication/adapter/base.py:568``) when a user account
transitions from inactive to active during onboarding.

Async infrastructure: queued onto **RabbitMQ** and consumed by Celery workers
(per AAP §0.2.2 architectural rule). Redis is **not** the task broker; it is
used by the rest of the platform for caching and session state only.
"""

# Python imports
import logging

# Django imports
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import User
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception


@shared_task
def user_activation_email(current_site, user_id):
    """Send the account-activation confirmation email to the user identified by ``user_id``.

    Trigger:
        Explicit ``user_activation_email.delay(current_site, user_id)`` from
        ``plane.authentication.adapter.base.Adapter.set_user_data`` (see
        ``apps/api/plane/authentication/adapter/base.py:568``) when a user
        account is activated during signup / OAuth / magic-link onboarding.
        The Celery message is routed via **RabbitMQ** and consumed by the
        worker.

    Side effects:
        - Sends one SMTP email (multipart HTML+plain-text rendered from
          ``emails/user/user_activation.html`` with subject
          ``f"{user.first_name or user.display_name or user.email} has been
          activated on Plane"``) to ``user.email`` using the
          instance-configured SMTP backend from ``get_email_configuration()``.
        - The template is rendered with the context
          ``{"email": str(user.email), "profile_url": current_site + "/profile"}``.
        - **No** database writes. **No** webhook fan-out. **No** cache
          invalidation.

    Idempotency:
        NON-idempotent. Each invocation produces one outbound email; the
        caller is expected to gate this with a one-shot activation state
        transition (i.e. only enqueue when ``user.is_active`` flips from
        ``False`` to ``True``).

    Error handling:
        Any exception (including ``User.DoesNotExist``) is swallowed by the
        catch-all ``except Exception`` block and forwarded to
        ``log_exception``; the task returns silently rather than re-raising,
        so no Celery retry is triggered.

    Args:
        current_site: Scheme + host prefix used to build the ``profile_url``
            embedded in the email body.
        user_id: Primary key of the ``User`` whose account was activated.
    """
    try:
        # Send email to user when account is activated
        user = User.objects.get(id=user_id)
        subject = f"{user.first_name or user.display_name or user.email} has been activated on Plane"

        context = {"email": str(user.email), "profile_url": current_site + "/profile"}

        # Send email to user
        html_content = render_to_string("emails/user/user_activation.html", context)

        text_content = generate_plain_text_from_html(html_content)
        # Configure email connection from the database
        (
            EMAIL_HOST,
            EMAIL_HOST_USER,
            EMAIL_HOST_PASSWORD,
            EMAIL_PORT,
            EMAIL_USE_TLS,
            EMAIL_USE_SSL,
            EMAIL_FROM,
        ) = get_email_configuration()

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
            to=[user.email],
            connection=connection,
        )

        msg.attach_alternative(html_content, "text/html")
        msg.send()
        logging.getLogger("plane.worker").info("Email sent successfully.")
        return
    except Exception as e:
        log_exception(e)
        return
