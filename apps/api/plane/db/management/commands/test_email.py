# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command to send a test email through the configured SMTP backend."""

from django.core.mail import EmailMultiAlternatives, get_connection
from django.core.management import BaseCommand, CommandError
from django.template.loader import render_to_string
from django.utils.html import strip_tags

# Module imports
from plane.license.utils.instance_value import get_email_configuration


class Command(BaseCommand):
    """Send a test email to the given receiver via the runtime email configuration.

    CLI signature:
        ``python manage.py test_email <to_email>``

    Side effects:
        - Calls ``plane.license.utils.instance_value.get_email_configuration()`` to
          resolve ``EMAIL_HOST``, ``EMAIL_HOST_USER``, ``EMAIL_HOST_PASSWORD``,
          ``EMAIL_PORT``, ``EMAIL_USE_TLS``, ``EMAIL_USE_SSL``, and ``EMAIL_FROM``
          from the current ``Instance`` configuration.
        - Opens a 30-second-timeout SMTP connection.
        - Renders ``emails/test_email.html`` and a tag-stripped plaintext alternative.
        - Sends one multipart email to ``to_email``.

    Idempotency:
        Idempotent -- re-running sends an additional test email; no application state
        is mutated.

    Trigger context:
        Operator-invoked manual SMTP smoke test after configuration changes or
        deployment.
    """

    def add_arguments(self, parser):
        """Register the ``to_email`` positional argument on the argparse parser."""
        # Positional argument
        parser.add_argument("to_email", type=str, help="receiver's email")

    def handle(self, *args, **options):
        """Resolve email configuration, render the test template, and send a multipart email."""
        receiver_email = options.get("to_email")

        if not receiver_email:
            raise CommandError("Receiver email is required")

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
            timeout=30,
        )
        # Prepare email details
        subject = "Test email from Plane"

        html_content = render_to_string("emails/test_email.html")
        text_content = strip_tags(html_content)

        self.stdout.write(self.style.SUCCESS("Trying to send test email..."))

        # Send the email
        try:
            msg = EmailMultiAlternatives(
                subject=subject,
                body=text_content,
                from_email=EMAIL_FROM,
                to=[receiver_email],
                connection=connection,
            )
            msg.attach_alternative(html_content, "text/html")
            msg.send()
            self.stdout.write(self.style.SUCCESS("Email successfully sent"))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Error: Email could not be delivered due to {e}"))
