# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Domain-scoped ``@extend_schema`` wrappers for DRF ViewSet documentation.

Each decorator in this module wraps drf-spectacular's ``extend_schema`` with
domain-specific defaults so call sites in ``apps/api/plane/api/views/`` stay
concise and consistent. The defaults are:

  - ``tags``       — single-element list naming the OpenAPI tag (e.g.,
    ``["Workspaces"]``, ``["Cycles"]``).
  - ``parameters`` — list of pre-bound :class:`OpenApiParameter` instances
    (e.g., ``[WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER]``).
  - ``responses``  — mapping of status code to pre-bound
    :class:`OpenApiResponse` instances (typically 401 / 403 / 404).

Merge semantics (see :func:`_merge_schema_options`):
  - ``responses`` keys are MERGED (caller-supplied ``responses={409: ...}``
    appends to the defaults).
  - ``parameters`` lists are EXTENDED (caller-supplied parameters append to
    the defaults).
  - All other ``**kwargs`` (``summary``, ``description``, ``request``,
    ``examples``, ``operation_id``, ...) REPLACE the defaults via
    ``dict.update``.

These decorators are runtime no-ops when ``settings.ENABLE_DRF_SPECTACULAR``
is falsy because no schema is generated; they remain attached to view
methods regardless.
"""

from drf_spectacular.utils import extend_schema
from .parameters import WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER
from .responses import UNAUTHORIZED_RESPONSE, FORBIDDEN_RESPONSE, NOT_FOUND_RESPONSE


def _merge_schema_options(defaults, kwargs):
    """Merge caller-supplied ``kwargs`` into the decorator's ``defaults`` dict.

    Merge rules:
      - ``responses`` — dict update (extra status codes append).
      - ``parameters`` — list extend (extra parameters append).
      - All other keys — replace via ``dict.update``.
    """
    # Merge responses
    if "responses" in kwargs:
        defaults["responses"].update(kwargs["responses"])
        kwargs = {k: v for k, v in kwargs.items() if k != "responses"}

    # Merge parameters
    if "parameters" in kwargs:
        defaults["parameters"].extend(kwargs["parameters"])
        kwargs = {k: v for k, v in kwargs.items() if k != "parameters"}

    defaults.update(kwargs)
    return defaults


def user_docs(**kwargs):
    """Apply ``["Users"]`` tag and a 401 default response.

    Used by user-account endpoints under ``/api/v1/users/`` and
    ``/api/v1/workspaces/<slug>/users/``. No path parameters are added
    because user endpoints address the authenticated user via session token.
    """
    defaults = {
        "tags": ["Users"],
        "parameters": [],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def workspace_docs(**kwargs):
    """Apply ``["Workspaces"]`` tag, ``WORKSPACE_SLUG_PARAMETER``, and 401/403/404 default responses.

    Used by workspace endpoints under ``/api/v1/workspaces/<slug>/``.
    """
    defaults = {
        "tags": ["Workspaces"],
        "parameters": [WORKSPACE_SLUG_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def project_docs(**kwargs):
    """Apply ``["Projects"]`` tag and 401/403/404 default responses.

    Used by project endpoints under ``/api/v1/workspaces/<slug>/projects/``.
    Callers append ``PROJECT_ID_PARAMETER`` themselves via the ``parameters=``
    kwarg.
    """
    defaults = {
        "tags": ["Projects"],
        "parameters": [WORKSPACE_SLUG_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def cycle_docs(**kwargs):
    """Apply ``["Cycles"]`` tag, ``WORKSPACE_SLUG_PARAMETER`` + ``PROJECT_ID_PARAMETER``, and 401/403/404 defaults.

    Used by cycle endpoints under
    ``/api/v1/workspaces/<slug>/projects/<project_id>/cycles/``.
    """
    defaults = {
        "tags": ["Cycles"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def issue_docs(**kwargs):
    """Apply ``["Work Items"]`` tag and 401/403/404 default responses.

    Used by issue (work item) endpoints under
    ``/api/v1/workspaces/<slug>/projects/<project_id>/issues/``.
    """
    defaults = {
        "tags": ["Work Items"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def intake_docs(**kwargs):
    """Apply ``["Intake"]`` tag and 401/403/404 default responses.

    Used by intake-issue endpoints under
    ``/api/v1/workspaces/<slug>/projects/<project_id>/intake-issues/``.
    """
    defaults = {
        "tags": ["Intake"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def asset_docs(**kwargs):
    """Apply ``["Assets"]`` tag and 401/403 default responses.

    Used by file-asset endpoints (presigned URL generation, upload finalization,
    download). Note: 404 is NOT in the defaults because asset existence is
    a domain check that the endpoint returns explicitly when relevant.
    """
    defaults = {
        "tags": ["Assets"],
        "parameters": [],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


# Issue-related decorators for specific tags
def work_item_docs(**kwargs):
    """Apply ``["Work Items"]`` tag and 401/403/404 default responses.

    Alias-style decorator paralleling :func:`issue_docs`; used in the external
    ``/api/v1/`` surface where the terminology is ``work item`` rather than
    ``issue``.
    """
    defaults = {
        "tags": ["Work Items"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def label_docs(**kwargs):
    """Apply ``["Labels"]`` tag and 401/403/404 default responses.

    Used by label endpoints under
    ``/api/v1/workspaces/<slug>/projects/<project_id>/labels/``.
    """
    defaults = {
        "tags": ["Labels"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def issue_link_docs(**kwargs):
    """Apply ``["Work Item Links"]`` tag and 401/403/404 default responses.

    Used by issue-link endpoints under
    ``.../issues/<issue_id>/links/``.
    """
    defaults = {
        "tags": ["Work Item Links"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def issue_comment_docs(**kwargs):
    """Apply ``["Work Item Comments"]`` tag and 401/403/404 default responses.

    Used by issue-comment endpoints under
    ``.../issues/<issue_id>/comments/``.
    """
    defaults = {
        "tags": ["Work Item Comments"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def issue_activity_docs(**kwargs):
    """Apply ``["Work Item Activity"]`` tag and 401/403/404 default responses.

    Used by issue-activity (audit log) endpoints under
    ``.../issues/<issue_id>/activities/``.
    """
    defaults = {
        "tags": ["Work Item Activity"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def issue_attachment_docs(**kwargs):
    """Apply ``["Work Item Attachments"]`` tag and 401/403/404 default responses.

    Used by issue-attachment endpoints under
    ``.../issues/<issue_id>/attachments/``.
    """
    defaults = {
        "tags": ["Work Item Attachments"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def work_item_relation_docs(**kwargs):
    """Apply ``["Work Item Relations"]`` tag and 401/403/404 default responses.

    Used by issue-relation endpoints (blocks/blocked_by/duplicate_of/etc.).
    """
    defaults = {
        "tags": ["Work Item Relations"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def module_docs(**kwargs):
    """Apply ``["Modules"]`` tag and 401/403/404 default responses.

    Used by module endpoints under
    ``/api/v1/workspaces/<slug>/projects/<project_id>/modules/``.
    """
    defaults = {
        "tags": ["Modules"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def module_issue_docs(**kwargs):
    """Apply ``["Modules"]`` tag and 401/403/404 default responses.

    Used by module-issue (issue ↔ module association) endpoints under
    ``.../modules/<module_id>/module-issues/``.
    """
    defaults = {
        "tags": ["Modules"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def state_docs(**kwargs):
    """Apply ``["States"]`` tag and 401/403/404 default responses.

    Used by state (workflow column) endpoints under
    ``/api/v1/workspaces/<slug>/projects/<project_id>/states/``.
    """
    defaults = {
        "tags": ["States"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))


def sticky_docs(**kwargs):
    """Apply ``["Stickies"]`` tag, ``WORKSPACE_SLUG_PARAMETER``, 401/403/404 defaults, and a default summary.

    Used by sticky-note endpoints under ``/api/v1/workspaces/<slug>/stickies/``.
    The decorator additionally sets ``summary`` to a sticky-specific default
    (overridable via ``**kwargs``).
    """
    defaults = {
        "tags": ["Stickies"],
        "summary": "Endpoints for sticky create/update/delete and fetch sticky details",
        "parameters": [WORKSPACE_SLUG_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }

    return extend_schema(**_merge_schema_options(defaults, kwargs))

def estimate_docs(**kwargs):
    """Apply ``["Estimates"]`` tag and 401/403/404 default responses.

    Used by estimate endpoints under
    ``/api/v1/workspaces/<slug>/projects/<project_id>/estimates/``.
    """
    defaults = {
        "tags": ["Estimates"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }
    return extend_schema(**_merge_schema_options(defaults, kwargs))

def estimate_point_docs(**kwargs):
    """Apply ``["Estimate Points"]`` tag and 401/403/404 default responses.

    Used by estimate-point endpoints under
    ``.../estimates/<estimate_id>/estimate-points/``.
    """
    defaults = {
        "tags": ["Estimate Points"],
        "parameters": [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        "responses": {
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: NOT_FOUND_RESPONSE,
        },
    }
    return extend_schema(**_merge_schema_options(defaults, kwargs))