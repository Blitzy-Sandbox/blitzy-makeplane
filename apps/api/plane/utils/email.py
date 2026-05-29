# SPDX-FileCopyrightText: 2023-present Plane Software, Inc.
# SPDX-License-Identifier: LicenseRef-Plane-Commercial
#
# Licensed under the Plane Commercial License (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# https://plane.so/legals/eula
#
# DO NOT remove or modify this notice.
# NOTICE: Proprietary and confidential. Unauthorized use or distribution is prohibited.

"""HTML-to-plain-text conversion for email bodies.

Provides :func:`generate_plain_text_from_html` to populate the ``text/plain``
alternative of multi-part HTML emails so recipients on text-only mail clients
still receive a readable body. The conversion removes ``<style>`` blocks via
regex, strips remaining markup through Django's
:func:`django.utils.html.strip_tags`, and collapses runs of blank lines so the
output stays compact.

Consumers (Celery tasks that send HTML email):
  - :mod:`plane.bgtasks.email_notification_task`
  - :mod:`plane.bgtasks.magic_link_code_task`
  - :mod:`plane.bgtasks.forgot_password_task`
  - :mod:`plane.bgtasks.user_activation_email_task`
  - :mod:`plane.bgtasks.user_deactivation_email_task`
  - :mod:`plane.bgtasks.user_email_update_task`
  - :mod:`plane.bgtasks.project_invitation_task`
  - :mod:`plane.bgtasks.project_add_user_email_task`
  - :mod:`plane.bgtasks.workspace_invitation_task`
  - :mod:`plane.bgtasks.analytic_plot_export`
  - :mod:`plane.bgtasks.webhook_task`

These callers are enqueued to Celery and consumed by Celery workers brokered
by RabbitMQ (per AAP §0.2.2 — Celery via RabbitMQ; Redis is caching/session
only). This helper itself is synchronous and runs inside the worker process.
"""

# Python imports
import re

# Django imports
from django.utils.html import strip_tags


def generate_plain_text_from_html(html_content):
    """Convert an HTML email body to a plain-text alternative.

    Used to populate the ``text/plain`` part of multi-part email messages so
    recipients with text-only clients receive a readable body. The conversion
    drops ``<style>`` blocks (and their contents) via regex, strips all
    remaining HTML markup through Django's :func:`django.utils.html.strip_tags`,
    collapses runs of blank lines, and normalizes leading and trailing
    whitespace so the output is compact.

    Args:
        html_content (str): The HTML content to convert to plain text.

    Returns:
        str: Clean plain text without HTML tags, ``<style>`` blocks, or
        excessive blank lines.
    """
    # Remove style tags and their content
    html_content = re.sub(r"<style[^>]*>.*?</style>", "", html_content, flags=re.DOTALL | re.IGNORECASE)

    # Strip HTML tags
    text_content = strip_tags(html_content)

    # Remove excessive empty lines
    text_content = re.sub(r"\n\s*\n\s*\n+", "\n\n", text_content)

    # Ensure there's a leading and trailing whitespace
    text_content = "\n\n" + text_content.lstrip().rstrip() + "\n\n"

    return text_content
