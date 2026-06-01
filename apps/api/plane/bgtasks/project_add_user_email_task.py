# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that emails a project-addition notification to a new project member.

Distinct from ``project_invitation_task.py``: this task is invoked when an
existing workspace member is *directly added* to a project (no acceptance
flow). Invitations to non-members go through ``project_invitation_task.py``.

Trigger: explicit ``.delay(current_site, project_member_id, invitor_id)`` from
``apps/api/plane/app/views/project/member.py`` (the bulk-add project member
endpoint).

Async infrastructure: queued onto RabbitMQ and consumed by Celery workers
(per the project's queue/cache split). Redis is used elsewhere only for
caching and session state -- it is not the task broker.
"""

# Python imports
import logging

# Third party imports
from celery import shared_task

# Third party imports
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string


# Module imports
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception
from plane.db.models import ProjectMember
from plane.db.models import User


@shared_task
def project_add_user_email(current_site, project_member_id, invitor_id):
    """Email a project-addition notification to the newly added project member.

    Trigger:
        Explicit ``project_add_user_email.delay(current_site,
        project_member_id, invitor_id)`` from
        ``apps/api/plane/app/views/project/member.py`` (the bulk-add project
        member endpoint) when an existing workspace member is directly added
        to a project. The Celery message is routed via RabbitMQ and consumed
        by the worker.

    Side effects:
        - Sends one SMTP email (subject ``"You have been invited to a Plane
          project"``; multipart HTML+plain-text rendered from
          ``emails/notifications/project_addition.html``) to the new project
          member's address using the instance-configured SMTP backend from
          :func:`plane.license.utils.instance_value.get_email_configuration`.
        - Embeds a deep-link URL of the form
          ``{current_site}/{workspace.slug}/projects/{project_id}/issues``
          in the email body.
        - No database writes. No webhook fan-out. No cache invalidation.

    Idempotency:
        NON-idempotent. Each invocation produces one outbound email; the
        caller is responsible for gating on the project-member creation
        event so duplicate triggers do not generate duplicate "you have
        been added" emails.

    Args:
        current_site: Scheme + host prefix used to build the project URL.
        project_member_id: Primary key of the newly created
            ``ProjectMember`` row whose ``member.email`` is the recipient.
        invitor_id: Primary key of the ``User`` who added the member; used
            to populate the inviter's first name in the email body.

    Returns:
        ``None``. Errors are swallowed: any exception during user/project
        lookup, template rendering, or SMTP delivery is forwarded to
        :func:`plane.utils.exception_logger.log_exception` so a failed email
        never poisons the worker.
    """
    try:
        # Get the invitor
        invitor = User.objects.get(pk=invitor_id)
        inviter_first_name = invitor.first_name
        # Get the project member
        project_member = ProjectMember.objects.get(pk=project_member_id)
        # Get the project member details
        project_name = project_member.project.name
        workspace_name = project_member.workspace.name
        member_email = project_member.member.email
        project_url = f"{current_site}/{project_member.workspace.slug}/projects/{project_member.project_id}/issues"
        # set the context
        context = {
            "project_name": project_name,
            "workspace_name": workspace_name,
            "email": member_email,
            "inviter_first_name": inviter_first_name,
            "project_url": project_url,
        }

        # Get the email configuration
        (
            EMAIL_HOST,
            EMAIL_HOST_USER,
            EMAIL_HOST_PASSWORD,
            EMAIL_PORT,
            EMAIL_USE_TLS,
            EMAIL_USE_SSL,
            EMAIL_FROM,
        ) = get_email_configuration()

        # Set the subject
        subject = "You have been invited to a Plane project"

        # Render the email template
        html_content = render_to_string("emails/notifications/project_addition.html", context)
        text_content = generate_plain_text_from_html(html_content)
        # Initialize the connection
        connection = get_connection(
            host=EMAIL_HOST,
            port=int(EMAIL_PORT),
            username=EMAIL_HOST_USER,
            password=EMAIL_HOST_PASSWORD,
            use_tls=EMAIL_USE_TLS == "1",
            use_ssl=EMAIL_USE_SSL == "1",
        )
        # Send the email
        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_content,
            from_email=EMAIL_FROM,
            to=[member_email],
            connection=connection,
        )
        # Attach the html content
        msg.attach_alternative(html_content, "text/html")
        # Send the email
        msg.send()
        # Log the success
        logging.getLogger("plane.worker").info("Email sent successfully.")
        return
    except Exception as e:
        log_exception(e)
        return
