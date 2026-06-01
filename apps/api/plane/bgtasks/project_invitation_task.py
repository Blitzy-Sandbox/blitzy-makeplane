# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that emails a project invitation link to a non-member.

Intended trigger: explicit ``project_invitation.delay(email, project_id,
token, current_site, invitor)`` from
``apps/api/plane/app/views/project/invite.py`` when a workspace user
invites a non-project-member to a project.

# INTENT UNCLEAR: the documented caller is currently unreachable. The
# trailing loop in ``ProjectMemberInviteViewSet.create`` shadows the
# imported ``project_invitation`` task by rebinding the local name
# ``project_invitations`` to the list returned by
# ``ProjectMemberInvite.objects.bulk_create(...)`` and then calling
# ``.delay(...)`` on that list. Lists have no ``.delay`` attribute, so the
# loop raises ``AttributeError`` before any invitation message is queued.
# The view's docstring already flags this with ``INTENT UNCLEAR``. The
# fix is in the view, not this task; the task body itself is well-formed
# and would work as documented once the caller is corrected. Per the
# documentation-only system boundary the view code is not modified here.

Distinct from ``project_add_user_email_task.py``: this task drives the
invitation acceptance flow (the invitee must follow the link to join), while
``project_add_user_email_task.py`` handles direct adds of existing workspace
members (no acceptance step).

Async infrastructure: queued onto RabbitMQ and consumed by Celery workers.
Redis is used elsewhere only for caching and session state -- it is not the
task broker.
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
from plane.db.models import Project, ProjectMemberInvite, User
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception


@shared_task
def project_invitation(email, project_id, token, current_site, invitor):
    """Email a project invitation link and persist the rendered message on the invite.

    Trigger:
        Intended caller: ``project_invitation.delay(email, project_id,
        token, current_site, invitor)`` from
        ``apps/api/plane/app/views/project/invite.py`` when a workspace
        user invites a non-project-member to a project.

        # INTENT UNCLEAR: the documented caller is currently unreachable.
        # ``ProjectMemberInviteViewSet.create`` rebinds the local name
        # ``project_invitations`` to the list returned by
        # ``ProjectMemberInvite.objects.bulk_create(...)`` and then calls
        # ``.delay(...)`` on that list. Because lists have no ``.delay``
        # attribute, the loop raises ``AttributeError`` before this task
        # is ever queued. The view's docstring already flags this with
        # ``INTENT UNCLEAR``; the fix belongs in the view and is out of
        # scope for this documentation-only pass. When the caller is
        # corrected the Celery message will route via RabbitMQ and be
        # consumed by the worker in the normal way.

    Side effects:
        - DB write: updates ``ProjectMemberInvite.message`` (looked up by
          ``token=token, email=email``) with the rendered plain-text
          invitation body, then ``.save()``. This persists the message so
          it can be displayed or re-sent later -- it is not obvious from
          the task name, so callers should be aware that this "email task"
          mutates the invite row.
        - Sends one SMTP email (multipart HTML + plain-text rendered from
          ``emails/invitations/project_invitation.html``) using the
          instance-configured SMTP backend from
          ``get_email_configuration()``. The subject embeds the invitor's
          display name and the project name.
        - Embeds a deep-link URL of the form
          ``{current_site}/project-invitations/?invitation_id=<id>``
          ``&email=<email>&slug=<workspace_slug>&project_id=<project_id>``
          in the email body.
        - No webhook fan-out. No cache invalidation.

    Idempotency:
        NON-idempotent. Duplicate triggers re-send the email and re-save
        the message body on the invite row. The saved value is
        deterministic for a given ``(token, email)`` pair (so re-saves are
        not destructive), but duplicate emails are produced.

    Args:
        email: Invitee's email address.
        project_id: Primary key of the ``Project``.
        token: Invitation token matching a ``ProjectMemberInvite`` row.
        current_site: Scheme + host prefix used to build the invitation
            URL.
        invitor: Email of the user issuing the invite; looked up via
            ``User.objects.get(email=invitor)``.

    Returns:
        ``None``. Errors are swallowed: missing ``Project`` or
        ``ProjectMemberInvite`` rows return silently, and any other
        exception is forwarded to ``log_exception`` and then swallowed so a
        failed email never poisons the worker.
    """
    try:
        user = User.objects.get(email=invitor)
        project = Project.objects.get(pk=project_id)
        project_member_invite = ProjectMemberInvite.objects.get(token=token, email=email)

        relativelink = f"/project-invitations/?invitation_id={project_member_invite.id}&email={email}&slug={project.workspace.slug}&project_id={str(project_id)}"  # noqa: E501
        abs_url = current_site + relativelink

        subject = f"{user.first_name or user.display_name or user.email} invited you to join {project.name} on Plane"

        context = {
            "email": email,
            "first_name": user.first_name,
            "project_name": project.name,
            "invitation_url": abs_url,
            "current_site": current_site,
        }

        html_content = render_to_string("emails/invitations/project_invitation.html", context)

        text_content = generate_plain_text_from_html(html_content)

        project_member_invite.message = text_content
        project_member_invite.save()

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
            to=[email],
            connection=connection,
        )

        msg.attach_alternative(html_content, "text/html")
        msg.send()
        logging.getLogger("plane.worker").info("Email sent successfully.")
        return
    except (Project.DoesNotExist, ProjectMemberInvite.DoesNotExist):
        return
    except Exception as e:
        log_exception(e)
        return
