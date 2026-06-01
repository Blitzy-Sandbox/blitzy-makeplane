# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that emails a workspace-invitation link to a user.

Trigger: explicit ``workspace_invitation.delay(email, workspace_id,
token, current_site, inviter)`` from
``apps/api/plane/app/views/workspace/invite.py:219`` when a workspace
owner/admin invites a user (existing or new) to the workspace as part of
the ``WorkspaceInvitationsViewSet.create`` bulk-invite flow.

Async infrastructure: queued onto **RabbitMQ** and consumed by Celery
workers (per the architectural rule that RabbitMQ is the task broker;
Redis is used only for caching and session state).
"""

# Python imports
import logging

# Third party imports
from celery import shared_task

# Django imports
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string

# Module imports
from plane.db.models import User, Workspace, WorkspaceMemberInvite
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.email import generate_plain_text_from_html
from plane.utils.exception_logger import log_exception


@shared_task
def workspace_invitation(email, workspace_id, token, current_site, inviter):
    """Email a workspace invitation to ``email`` and persist the rendered message on the invite record.

    Trigger:
        Explicit ``workspace_invitation.delay(email, workspace_id,
        token, current_site, inviter)`` from
        ``apps/api/plane/app/views/workspace/invite.py:219`` when a
        workspace owner/admin invites a user (existing or new) to the
        workspace. The Celery message is routed via **RabbitMQ** and
        consumed by the worker.

    Side effects:
        - **DB write (``WorkspaceMemberInvite``)**: looks up the invite
          row by ``(token=token, email=email)``, assigns the rendered
          plain-text invitation body to ``.message``, then ``.save()`` —
          so the rendered text can later be displayed in-app or used by
          a "resend invite" affordance without re-rendering the
          template.
        - **DB read** (``User`` by ``email=inviter``, ``Workspace`` by
          ``pk=workspace_id``); ``Workspace.DoesNotExist`` and
          ``WorkspaceMemberInvite.DoesNotExist`` are swallowed and the
          task returns silently (no retry).
        - **SMTP send**: one multipart email (subject
          ``f"{inviter_name} has invited you to join them in
          {workspace.name} on Plane"``; HTML rendered from
          ``emails/invitations/workspace_invitation.html`` and a
          plain-text alternative derived via
          :func:`generate_plain_text_from_html`) is dispatched through
          the SMTP connection built from
          :func:`get_email_configuration` (instance-configured EMAIL_*
          values).
        - **Embedded URL**: the email body links to
          ``{current_site}/workspace-invitations/?invitation_id=<invite_id>&slug=<workspace_slug>&token=<token>``
          so the invitee lands on the accept-invite page with all
          fields pre-filled.
        - **Logging**: writes an ``info``-level "Email sent
          successfully" line to the ``plane.worker`` logger on success;
          all other exceptions are funnelled through
          :func:`log_exception` and swallowed.
        - **No** webhook fan-out. **No** cache invalidation.

    Idempotency:
        NON-idempotent — each invocation produces one outbound email and
        re-saves the message body on the invite row. The persisted body
        is deterministic for a given ``(token, email)`` pair, so
        re-saves are not destructive, but the recipient will receive
        duplicate emails on duplicate invocations. The caller is
        expected to enqueue this task at most once per
        ``WorkspaceMemberInvite`` row created during a bulk-invite
        request.

    Args:
        email: Invitee's email address; matches the ``email`` column on
            the target ``WorkspaceMemberInvite`` row.
        workspace_id: Primary key of the ``Workspace`` the invitee is
            being invited to.
        token: Invitation token matching a ``WorkspaceMemberInvite``
            row; combined with ``email`` to look up the invite record
            and embedded in the deep-link URL.
        current_site: Scheme + host prefix (e.g.
            ``"https://app.plane.so"``) used to build the absolute
            invitation URL; resolved upstream from the request via
            ``base_host(request=request, is_app=True)``.
        inviter: Email of the user issuing the invite; looked up via
            ``User.objects.get(email=inviter)`` to derive the display
            name embedded in the email subject and greeting.
    """
    try:
        user = User.objects.get(email=inviter)

        workspace = Workspace.objects.get(pk=workspace_id)
        workspace_member_invite = WorkspaceMemberInvite.objects.get(token=token, email=email)

        # Relative link
        relative_link = (
            f"/workspace-invitations/?invitation_id={workspace_member_invite.id}&slug={workspace.slug}&token={token}"  # noqa: E501
        )

        # The complete url including the domain
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

        # Subject of the email
        subject = f"{user.first_name or user.display_name or user.email} has invited you to join them in {workspace.name} on Plane"  # noqa: E501

        context = {
            "email": email,
            "first_name": user.first_name or user.display_name or user.email,
            "workspace_name": workspace.name,
            "abs_url": abs_url,
        }

        html_content = render_to_string("emails/invitations/workspace_invitation.html", context)

        text_content = generate_plain_text_from_html(html_content)

        workspace_member_invite.message = text_content
        workspace_member_invite.save()

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
    except (Workspace.DoesNotExist, WorkspaceMemberInvite.DoesNotExist):
        return
    except Exception as e:
        log_exception(e)
        return
