# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Reusable OpenAPI response definitions for drf-spectacular.

Centralizes the ``OpenApiResponse`` instances used by view decorators in
``apps/api/plane/utils/openapi/decorators.py`` so every endpoint emits a
consistent response shape (description, example payload, error_code) for the
same logical condition.

Response categories:

  - Authentication & authorization — ``UNAUTHORIZED_RESPONSE``,
    ``FORBIDDEN_RESPONSE``, ``ADMIN_ONLY_RESPONSE``.
  - Generic resource state — ``NOT_FOUND_RESPONSE``,
    ``VALIDATION_ERROR_RESPONSE``, ``INVALID_REQUEST_RESPONSE``,
    ``REQUIRED_FIELDS_RESPONSE``, ``CONFLICT_RESPONSE``.
  - Success acknowledgements — ``DELETED_RESPONSE``, ``ARCHIVED_RESPONSE``,
    ``UNARCHIVED_RESPONSE``.
  - Domain-specific 404s — ``PROJECT_NOT_FOUND_RESPONSE``,
    ``WORKSPACE_NOT_FOUND_RESPONSE``, ``ISSUE_NOT_FOUND_RESPONSE``,
    ``WORK_ITEM_NOT_FOUND_RESPONSE``, ``LABEL_NOT_FOUND_RESPONSE``,
    ``MODULE_NOT_FOUND_RESPONSE``, ``MODULE_ISSUE_NOT_FOUND_RESPONSE``,
    ``COMMENT_NOT_FOUND_RESPONSE``, ``LINK_NOT_FOUND_RESPONSE``,
    ``ATTACHMENT_NOT_FOUND_RESPONSE``, ``ASSET_NOT_FOUND_RESPONSE``.
  - Domain-specific 409s and 422s — ``EXTERNAL_ID_EXISTS_RESPONSE``,
    ``PROJECT_NAME_TAKEN_RESPONSE``, ``LABEL_NAME_EXISTS_RESPONSE``,
    ``CYCLE_CANNOT_ARCHIVE_RESPONSE``, ``STATE_NAME_EXISTS_RESPONSE``,
    ``STATE_CANNOT_DELETE_RESPONSE``, ``CANNOT_DELETE_RESPONSE``,
    ``CANNOT_ARCHIVE_RESPONSE``, ``ASSET_CONFLICT_RESPONSE``.
  - File asset responses — ``PRESIGNED_URL_SUCCESS_RESPONSE``,
    ``GENERIC_ASSET_UPLOAD_SUCCESS_RESPONSE``,
    ``GENERIC_ASSET_VALIDATION_ERROR_RESPONSE``,
    ``ASSET_DOWNLOAD_SUCCESS_RESPONSE``, ``ASSET_DOWNLOAD_ERROR_RESPONSE``,
    ``ASSET_UPDATED_RESPONSE``, ``ASSET_DELETED_RESPONSE``.
  - Search — ``BAD_SEARCH_REQUEST_RESPONSE``.
  - Paginated envelopes — :func:`create_paginated_response` (factory that
    builds an ``inline_serializer`` matching the response envelope produced
    by :class:`plane.utils.paginator.BasePaginator`).

Every response carries a stable ``error_code`` string (e.g.,
``AUTHENTICATION_REQUIRED``, ``PERMISSION_DENIED``, ``RESOURCE_NOT_FOUND``)
so API clients can branch on the code rather than parsing free-text messages.
"""

from drf_spectacular.utils import OpenApiResponse, OpenApiExample, inline_serializer
from rest_framework import serializers
from .examples import get_sample_for_schema


# Authentication & Authorization Responses
UNAUTHORIZED_RESPONSE = OpenApiResponse(
    description="Authentication credentials were not provided or are invalid.",
    examples=[
        OpenApiExample(
            name="Unauthorized",
            value={
                "error": "Authentication credentials were not provided",
                "error_code": "AUTHENTICATION_REQUIRED",
            },
        )
    ],
)

FORBIDDEN_RESPONSE = OpenApiResponse(
    description="Permission denied. User lacks required permissions.",
    examples=[
        OpenApiExample(
            name="Forbidden",
            value={
                "error": "You do not have permission to perform this action",
                "error_code": "PERMISSION_DENIED",
            },
        )
    ],
)


# Resource Responses
NOT_FOUND_RESPONSE = OpenApiResponse(
    description="The requested resource was not found.",
    examples=[
        OpenApiExample(
            name="Not Found",
            value={"error": "Not found", "error_code": "RESOURCE_NOT_FOUND"},
        )
    ],
)

VALIDATION_ERROR_RESPONSE = OpenApiResponse(
    description="Validation error occurred with the provided data.",
    examples=[
        OpenApiExample(
            name="Validation Error",
            value={
                "error": "Validation failed",
                "details": {"field_name": ["This field is required."]},
            },
        )
    ],
)

# Generic Success Responses
DELETED_RESPONSE = OpenApiResponse(
    description="Resource deleted successfully",
    examples=[
        OpenApiExample(
            name="Deleted Successfully",
            value={"message": "Resource deleted successfully"},
        )
    ],
)

ARCHIVED_RESPONSE = OpenApiResponse(
    description="Resource archived successfully",
    examples=[
        OpenApiExample(
            name="Archived Successfully",
            value={"message": "Resource archived successfully"},
        )
    ],
)

UNARCHIVED_RESPONSE = OpenApiResponse(
    description="Resource unarchived successfully",
    examples=[
        OpenApiExample(
            name="Unarchived Successfully",
            value={"message": "Resource unarchived successfully"},
        )
    ],
)

# Specific Error Responses
INVALID_REQUEST_RESPONSE = OpenApiResponse(
    description="Invalid request data provided",
    examples=[
        OpenApiExample(
            name="Invalid Request",
            value={
                "error": "Invalid request data",
                "details": "Specific validation errors",
            },
        )
    ],
)

CONFLICT_RESPONSE = OpenApiResponse(
    description="Resource conflict - duplicate or constraint violation",
    examples=[
        OpenApiExample(
            name="Resource Conflict",
            value={
                "error": "Resource with the same identifier already exists",
                "id": "550e8400-e29b-41d4-a716-446655440000",
            },
        )
    ],
)

ADMIN_ONLY_RESPONSE = OpenApiResponse(
    description="Only admin or creator can perform this action",
    examples=[
        OpenApiExample(
            name="Admin Only",
            value={"error": "Only admin or creator can perform this action"},
        )
    ],
)

CANNOT_DELETE_RESPONSE = OpenApiResponse(
    description="Resource cannot be deleted due to constraints",
    examples=[
        OpenApiExample(
            name="Cannot Delete",
            value={"error": "Resource cannot be deleted", "reason": "Has dependencies"},
        )
    ],
)

CANNOT_ARCHIVE_RESPONSE = OpenApiResponse(
    description="Resource cannot be archived in current state",
    examples=[
        OpenApiExample(
            name="Cannot Archive",
            value={
                "error": "Resource cannot be archived",
                "reason": "Not in valid state",
            },
        )
    ],
)

REQUIRED_FIELDS_RESPONSE = OpenApiResponse(
    description="Required fields are missing",
    examples=[
        OpenApiExample(
            name="Required Fields Missing",
            value={"error": "Required fields are missing", "fields": ["name", "type"]},
        )
    ],
)

# Project-specific Responses
PROJECT_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Project not found",
    examples=[
        OpenApiExample(
            name="Project Not Found",
            value={"error": "Project not found"},
        )
    ],
)

WORKSPACE_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Workspace not found",
    examples=[
        OpenApiExample(
            name="Workspace Not Found",
            value={"error": "Workspace not found"},
        )
    ],
)

PROJECT_NAME_TAKEN_RESPONSE = OpenApiResponse(
    description="Project name already taken",
    examples=[
        OpenApiExample(
            name="Project Name Taken",
            value={"error": "Project name already taken"},
        )
    ],
)

# Issue-specific Responses
ISSUE_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Issue not found",
    examples=[
        OpenApiExample(
            name="Issue Not Found",
            value={"error": "Issue not found"},
        )
    ],
)

WORK_ITEM_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Work item not found",
    examples=[
        OpenApiExample(
            name="Work Item Not Found",
            value={"error": "Work item not found"},
        )
    ],
)

EXTERNAL_ID_EXISTS_RESPONSE = OpenApiResponse(
    description="Resource with same external ID already exists",
    examples=[
        OpenApiExample(
            name="External ID Exists",
            value={
                "error": "Resource with the same external id and external source already exists",  # noqa: E501
                "id": "550e8400-e29b-41d4-a716-446655440000",
            },
        )
    ],
)

# Label-specific Responses
LABEL_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Label not found",
    examples=[
        OpenApiExample(
            name="Label Not Found",
            value={"error": "Label not found"},
        )
    ],
)

LABEL_NAME_EXISTS_RESPONSE = OpenApiResponse(
    description="Label with the same name already exists",
    examples=[
        OpenApiExample(
            name="Label Name Exists",
            value={"error": "Label with the same name already exists in the project"},
        )
    ],
)

# Module-specific Responses
MODULE_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Module not found",
    examples=[
        OpenApiExample(
            name="Module Not Found",
            value={"error": "Module not found"},
        )
    ],
)

MODULE_ISSUE_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Module issue not found",
    examples=[
        OpenApiExample(
            name="Module Issue Not Found",
            value={"error": "Module issue not found"},
        )
    ],
)

# Cycle-specific Responses
CYCLE_CANNOT_ARCHIVE_RESPONSE = OpenApiResponse(
    description="Cycle cannot be archived",
    examples=[
        OpenApiExample(
            name="Cycle Cannot Archive",
            value={"error": "Only completed cycles can be archived"},
        )
    ],
)

# State-specific Responses
STATE_NAME_EXISTS_RESPONSE = OpenApiResponse(
    description="State with the same name already exists",
    examples=[
        OpenApiExample(
            name="State Name Exists",
            value={"error": "State with the same name already exists"},
        )
    ],
)

STATE_CANNOT_DELETE_RESPONSE = OpenApiResponse(
    description="State cannot be deleted",
    examples=[
        OpenApiExample(
            name="State Cannot Delete",
            value={
                "error": "State cannot be deleted",
                "reason": "Default state or has issues",
            },
        )
    ],
)

# Comment-specific Responses
COMMENT_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Comment not found",
    examples=[
        OpenApiExample(
            name="Comment Not Found",
            value={"error": "Comment not found"},
        )
    ],
)

# Link-specific Responses
LINK_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Link not found",
    examples=[
        OpenApiExample(
            name="Link Not Found",
            value={"error": "Link not found"},
        )
    ],
)

# Attachment-specific Responses
ATTACHMENT_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Attachment not found",
    examples=[
        OpenApiExample(
            name="Attachment Not Found",
            value={"error": "Attachment not found"},
        )
    ],
)

# Search-specific Responses
BAD_SEARCH_REQUEST_RESPONSE = OpenApiResponse(
    description="Bad request - invalid search parameters",
    examples=[
        OpenApiExample(
            name="Bad Search Request",
            value={"error": "Invalid search parameters"},
        )
    ],
)


# Pagination Response Templates
def create_paginated_response(
    item_schema,
    schema_name,
    description="Paginated results",
    example_name="Paginated Response",
):
    """Build an ``OpenApiResponse`` describing a paginated list of ``item_schema``.

    The returned response wraps ``item_schema`` in an ``inline_serializer``
    envelope matching the wire format produced by
    :class:`plane.utils.paginator.BasePaginator.paginate`:

    Envelope fields:
        - ``grouped_by``         (str, nullable) — grouping dimension name.
        - ``sub_grouped_by``     (str, nullable) — sub-grouping dimension name.
        - ``total_count``        (int) — total matching rows.
        - ``next_cursor``        (str) — opaque cursor for the next page.
        - ``prev_cursor``        (str) — opaque cursor for the previous page.
        - ``next_page_results``  (bool) — whether a next page exists.
        - ``prev_page_results``  (bool) — whether a previous page exists.
        - ``count``              (int) — rows on this page.
        - ``total_pages``        (int) — total number of pages.
        - ``total_results``      (int) — alias of ``total_count`` for legacy
          consumers.
        - ``extra_stats``        (dict, nullable) — aggregate stats payload.
        - ``results``            (list[item_schema]) — page rows; sample data
          is resolved via :func:`plane.utils.openapi.examples.get_sample_for_schema`.

    Args:
        item_schema: Serializer / OpenAPI schema describing a single row.
        schema_name: Name for the generated inline serializer
            (e.g., ``"PaginatedIssueResponse"``).
        description: Human-readable description of what the list contains.
        example_name: Lookup key passed to ``get_sample_for_schema`` to
            populate the ``results`` field's example payload.

    Returns:
        OpenApiResponse: Drf-spectacular response describing the paginated
        envelope.
    """
    return OpenApiResponse(
        description=description,
        response=inline_serializer(
            name=schema_name,
            fields={
                "grouped_by": serializers.CharField(allow_null=True),
                "sub_grouped_by": serializers.CharField(allow_null=True),
                "total_count": serializers.IntegerField(),
                "next_cursor": serializers.CharField(),
                "prev_cursor": serializers.CharField(),
                "next_page_results": serializers.BooleanField(),
                "prev_page_results": serializers.BooleanField(),
                "count": serializers.IntegerField(),
                "total_pages": serializers.IntegerField(),
                "total_results": serializers.IntegerField(),
                "extra_stats": serializers.CharField(allow_null=True),
                "results": serializers.ListField(child=item_schema()),
            },
        ),
        examples=[
            OpenApiExample(
                name=example_name,
                value={
                    "grouped_by": "state",
                    "sub_grouped_by": "priority",
                    "total_count": 150,
                    "next_cursor": "20:1:0",
                    "prev_cursor": "20:0:0",
                    "next_page_results": True,
                    "prev_page_results": False,
                    "count": 20,
                    "total_pages": 8,
                    "total_results": 150,
                    "extra_stats": None,
                    "results": [get_sample_for_schema(schema_name)],
                },
                summary=example_name,
            )
        ],
    )


# Asset-specific Responses
PRESIGNED_URL_SUCCESS_RESPONSE = OpenApiResponse(description="Presigned URL generated successfully")

GENERIC_ASSET_UPLOAD_SUCCESS_RESPONSE = OpenApiResponse(
    description="Presigned URL generated successfully",
    examples=[
        OpenApiExample(
            name="Generic Asset Upload Response",
            value={
                "upload_data": {
                    "url": "https://s3.amazonaws.com/bucket-name",
                    "fields": {
                        "key": "workspace-id/uuid-filename.pdf",
                        "AWSAccessKeyId": "AKIA...",
                        "policy": "eyJ...",
                        "signature": "abc123...",
                    },
                },
                "asset_id": "550e8400-e29b-41d4-a716-446655440000",
                "asset_url": "https://cdn.example.com/workspace-id/uuid-filename.pdf",
            },
        )
    ],
)

GENERIC_ASSET_VALIDATION_ERROR_RESPONSE = OpenApiResponse(
    description="Validation error",
    examples=[
        OpenApiExample(
            name="Missing required fields",
            value={"error": "Name and size are required fields.", "status": False},
        ),
        OpenApiExample(
            name="Invalid file type",
            value={"error": "Invalid file type.", "status": False},
        ),
    ],
)

ASSET_CONFLICT_RESPONSE = OpenApiResponse(
    description="Asset with same external ID already exists",
    examples=[
        OpenApiExample(
            name="Duplicate external asset",
            value={
                "message": "Asset with same external id and source already exists",
                "asset_id": "550e8400-e29b-41d4-a716-446655440000",
                "asset_url": "https://cdn.example.com/existing-file.pdf",
            },
        )
    ],
)

ASSET_DOWNLOAD_SUCCESS_RESPONSE = OpenApiResponse(
    description="Presigned download URL generated successfully",
    examples=[
        OpenApiExample(
            name="Asset Download Response",
            value={
                "asset_id": "550e8400-e29b-41d4-a716-446655440000",
                "asset_url": "https://s3.amazonaws.com/bucket/file.pdf?signed-url",
                "asset_name": "document.pdf",
                "asset_type": "application/pdf",
            },
        )
    ],
)

ASSET_DOWNLOAD_ERROR_RESPONSE = OpenApiResponse(
    description="Bad request",
    examples=[
        OpenApiExample(name="Asset not uploaded", value={"error": "Asset not yet uploaded"}),
    ],
)

ASSET_UPDATED_RESPONSE = OpenApiResponse(description="Asset updated successfully")

ASSET_DELETED_RESPONSE = OpenApiResponse(description="Asset deleted successfully")

ASSET_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Asset not found",
    examples=[OpenApiExample(name="Asset not found", value={"error": "Asset not found"})],
)
