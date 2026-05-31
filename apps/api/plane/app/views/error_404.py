# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""JSON 404 handler installed as Django's ``handler404`` for the API project.

Replaces Django's default HTML "Page not found" page with a JSON body so
unmatched routes return a machine-readable payload to API consumers.
"""

# views.py
from django.http import JsonResponse


def custom_404_view(request, exception=None):
    """Return a JSON 404 response with body ``{"error": "Page not found."}`` for unmatched routes."""
    return JsonResponse({"error": "Page not found."}, status=404)
