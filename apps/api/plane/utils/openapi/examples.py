# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Reusable :class:`OpenApiExample` payloads and ``SAMPLE_*`` data for drf-spectacular.

This module is the **single source of truth** for example data referenced
by ``@extend_schema`` (and its variants) across the schema-generated
OpenAPI surface. Every example value uses the canonical placeholder UUID
``550e8400-e29b-41d4-a716-446655440000`` and ISO-8601 timestamps so that
rendered Swagger / ReDoc pages have stable, copy-pasteable payloads.

The file is laid out in four conceptual divisions:

  1. **Display examples** (top of file, before any banner) — generic entity
     payloads used as both request and response illustration depending on
     the consumer: ``FILE_UPLOAD_EXAMPLE``, ``WORKSPACE_EXAMPLE``,
     ``PROJECT_EXAMPLE``, ``ISSUE_EXAMPLE``, ``USER_EXAMPLE``.
  2. **Request examples** (under the ``REQUEST EXAMPLES`` banner) —
     payloads referenced by ``@extend_schema(request=…)`` and by the
     :func:`plane.utils.openapi.decorators` examples kwarg. Each example's
     ``name`` matches the wire-level serializer class
     (``"IssueCreateSerializer"``, ``"LabelCreateUpdateSerializer"``, …).
  3. **Response examples** (under the ``RESPONSE EXAMPLES`` banner) —
     payloads referenced by ``@extend_schema(responses=…)`` and by the
     :class:`OpenApiResponse` constants in
     :mod:`plane.utils.openapi.responses`.
  4. **Sample data + dispatch** (bottom of file) — bare ``SAMPLE_*`` dicts
     and the :data:`SCHEMA_EXAMPLES` mapping consumed by
     :func:`get_sample_for_schema`, which serves dynamic example resolution
     for paginated envelope schemas
     (``PaginatedIssueResponse`` → ``SAMPLE_ISSUE``, etc.).

Note the pre-existing categorical inconsistencies — ``STICKY_EXAMPLE`` has
no preceding section header, and ``ESTIMATE_CREATE_EXAMPLE`` /
``ESTIMATE_UPDATE_EXAMPLE`` / ``ESTIMATE_POINT_CREATE_EXAMPLE`` /
``ESTIMATE_POINT_UPDATE_EXAMPLE`` are request examples physically located
in the response-examples half of the file. These are intentionally
preserved (no refactoring per project rules).

Loaded transitively via ``apps/api/plane/utils/openapi/__init__.py`` and
only effective when ``settings.ENABLE_DRF_SPECTACULAR`` is truthy (see the
``if settings.ENABLE_DRF_SPECTACULAR:`` block in :mod:`plane.urls`).
"""

from drf_spectacular.utils import OpenApiExample


# ----------------------------------------------------------------------------
# Display Examples — entity payloads usable as either request or response
# illustrations depending on the calling endpoint.
# ----------------------------------------------------------------------------
# File Upload
FILE_UPLOAD_EXAMPLE = OpenApiExample(
    name="File Upload Success",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "asset": "uploads/workspace_1/file_example.pdf",
        "attributes": {
            "name": "example-document.pdf",
            "size": 1024000,
            "mimetype": "application/pdf",
        },
        "created_at": "2024-01-15T10:30:00Z",
        "updated_at": "2024-01-15T10:30:00Z",
    },
)


# Workspace Examples
WORKSPACE_EXAMPLE = OpenApiExample(
    name="Workspace",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "My Workspace",
        "slug": "my-workspace",
        "organization_size": "1-10",
        "created_at": "2024-01-15T10:30:00Z",
        "updated_at": "2024-01-15T10:30:00Z",
    },
)


# Project Examples
PROJECT_EXAMPLE = OpenApiExample(
    name="Project",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Mobile App Development",
        "description": "Development of the mobile application",
        "identifier": "MAD",
        "network": 2,
        "project_lead": "550e8400-e29b-41d4-a716-446655440001",
        "created_at": "2024-01-15T10:30:00Z",
        "updated_at": "2024-01-15T10:30:00Z",
    },
)


# Issue Examples
ISSUE_EXAMPLE = OpenApiExample(
    name="Issue",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Implement user authentication",
        "description": "Add OAuth 2.0 authentication flow",
        "sequence_id": 1,
        "priority": "high",
        "assignees": ["550e8400-e29b-41d4-a716-446655440001"],
        "labels": ["550e8400-e29b-41d4-a716-446655440002"],
        "created_at": "2024-01-15T10:30:00Z",
        "updated_at": "2024-01-15T10:30:00Z",
    },
)


# User Examples
USER_EXAMPLE = OpenApiExample(
    name="User",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "first_name": "John",
        "last_name": "Doe",
        "email": "john.doe@example.com",
        "avatar": "https://example.com/avatar.jpg",
        "avatar_url": "https://example.com/avatar.jpg",
        "display_name": "John Doe",
    },
)


# ============================================================================
# REQUEST EXAMPLES
# ----------------------------------------------------------------------------
# Payloads referenced by ``@extend_schema(request=…, examples=[…])`` and by
# the request-side examples kwarg of the decorators in
# ``plane.utils.openapi.decorators``. Each example's ``name`` argument
# matches the serializer class on the receiving ViewSet — drf-spectacular
# uses that name to associate the example with the request body schema in
# the rendered Swagger / ReDoc page.
# ============================================================================

# ----------------------------------------------------------------------------
# Work Item (Issue) Request Examples
# ----------------------------------------------------------------------------
# ``ISSUE_CREATE_EXAMPLE`` and ``ISSUE_UPDATE_EXAMPLE`` are referenced by
# :func:`plane.utils.openapi.decorators.issue_docs` and the issue
# ViewSet's ``@extend_schema`` calls. ``ISSUE_UPSERT_EXAMPLE`` is the
# external-system variant keyed on (``external_id``, ``external_source``).
ISSUE_CREATE_EXAMPLE = OpenApiExample(
    "IssueCreateSerializer",
    value={
        "name": "New Issue",
        "description": "New issue description",
        "priority": "medium",
        "state": "0ec6cfa4-e906-4aad-9390-2df0303a41cd",
        "assignees": ["0ec6cfa4-e906-4aad-9390-2df0303a41cd"],
        "labels": ["0ec6cfa4-e906-4aad-9390-2df0303a41ce"],
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for creating a work item",
)

ISSUE_UPDATE_EXAMPLE = OpenApiExample(
    "IssueUpdateSerializer",
    value={
        "name": "Updated Issue",
        "description": "Updated issue description",
        "priority": "medium",
        "state": "0ec6cfa4-e906-4aad-9390-2df0303a41cd",
        "assignees": ["0ec6cfa4-e906-4aad-9390-2df0303a41cd"],
        "labels": ["0ec6cfa4-e906-4aad-9390-2df0303a41ce"],
    },
    description="Example request for updating a work item",
)

ISSUE_UPSERT_EXAMPLE = OpenApiExample(
    "IssueUpsertSerializer",
    value={
        "name": "Updated Issue via External ID",
        "description": "Updated issue description",
        "priority": "high",
        "state": "0ec6cfa4-e906-4aad-9390-2df0303a41cd",
        "assignees": ["0ec6cfa4-e906-4aad-9390-2df0303a41cd"],
        "labels": ["0ec6cfa4-e906-4aad-9390-2df0303a41ce"],
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for upserting a work item via external ID",
)

# Label Examples
LABEL_CREATE_EXAMPLE = OpenApiExample(
    "LabelCreateUpdateSerializer",
    value={
        "name": "New Label",
        "color": "#ff0000",
        "description": "New label description",
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for creating a label",
)

LABEL_UPDATE_EXAMPLE = OpenApiExample(
    "LabelCreateUpdateSerializer",
    value={
        "name": "Updated Label",
        "color": "#00ff00",
        "description": "Updated label description",
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for updating a label",
)

# Issue Link Examples
ISSUE_LINK_CREATE_EXAMPLE = OpenApiExample(
    "IssueLinkCreateSerializer",
    value={
        "url": "https://example.com",
        "title": "Example Link",
    },
    description="Example request for creating an issue link",
)

ISSUE_LINK_UPDATE_EXAMPLE = OpenApiExample(
    "IssueLinkUpdateSerializer",
    value={
        "url": "https://example.com",
        "title": "Updated Link",
    },
    description="Example request for updating an issue link",
)

# Issue Comment Examples
ISSUE_COMMENT_CREATE_EXAMPLE = OpenApiExample(
    "IssueCommentCreateSerializer",
    value={
        "comment_html": "<p>New comment content</p>",
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for creating an issue comment",
)

ISSUE_COMMENT_UPDATE_EXAMPLE = OpenApiExample(
    "IssueCommentCreateSerializer",
    value={
        "comment_html": "<p>Updated comment content</p>",
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for updating an issue comment",
)

# ----------------------------------------------------------------------------
# Issue Attachment Request Examples
# ----------------------------------------------------------------------------
# ``ISSUE_ATTACHMENT_UPLOAD_EXAMPLE`` matches the presigned-POST initiate
# request shape (name + mimetype + size). ``ATTACHMENT_UPLOAD_CONFIRM_EXAMPLE``
# is the finalize step body sent after the client uploads to S3/MinIO.
ISSUE_ATTACHMENT_UPLOAD_EXAMPLE = OpenApiExample(
    "IssueAttachmentUploadSerializer",
    value={
        "name": "document.pdf",
        "type": "application/pdf",
        "size": 1024000,
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for creating an issue attachment",
)

ATTACHMENT_UPLOAD_CONFIRM_EXAMPLE = OpenApiExample(
    "ConfirmUpload",
    value={"is_uploaded": True},
    description="Confirm that the attachment has been successfully uploaded",
)

# Cycle Examples
CYCLE_CREATE_EXAMPLE = OpenApiExample(
    "CycleCreateSerializer",
    value={
        "name": "Cycle 1",
        "description": "Cycle 1 description",
        "start_date": "2021-01-01",
        "end_date": "2021-01-31",
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for creating a cycle",
)

CYCLE_UPDATE_EXAMPLE = OpenApiExample(
    "CycleUpdateSerializer",
    value={
        "name": "Updated Cycle",
        "description": "Updated cycle description",
        "start_date": "2021-01-01",
        "end_date": "2021-01-31",
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for updating a cycle",
)

CYCLE_ISSUE_REQUEST_EXAMPLE = OpenApiExample(
    "CycleIssueRequestSerializer",
    value={
        "issues": [
            "0ec6cfa4-e906-4aad-9390-2df0303a41cd",
            "0ec6cfa4-e906-4aad-9390-2df0303a41ce",
        ],
    },
    description="Example request for adding cycle issues",
)

TRANSFER_CYCLE_ISSUE_EXAMPLE = OpenApiExample(
    "TransferCycleIssueRequestSerializer",
    value={
        "new_cycle_id": "0ec6cfa4-e906-4aad-9390-2df0303a41ce",
    },
    description="Example request for transferring cycle issues",
)

# Module Examples
MODULE_CREATE_EXAMPLE = OpenApiExample(
    "ModuleCreateSerializer",
    value={
        "name": "New Module",
        "description": "New module description",
        "start_date": "2021-01-01",
        "end_date": "2021-01-31",
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for creating a module",
)

MODULE_UPDATE_EXAMPLE = OpenApiExample(
    "ModuleUpdateSerializer",
    value={
        "name": "Updated Module",
        "description": "Updated module description",
        "start_date": "2021-01-01",
        "end_date": "2021-01-31",
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for updating a module",
)

MODULE_ISSUE_REQUEST_EXAMPLE = OpenApiExample(
    "ModuleIssueRequestSerializer",
    value={
        "issues": [
            "0ec6cfa4-e906-4aad-9390-2df0303a41cd",
            "0ec6cfa4-e906-4aad-9390-2df0303a41ce",
        ],
    },
    description="Example request for adding module issues",
)

# Project Examples
PROJECT_CREATE_EXAMPLE = OpenApiExample(
    "ProjectCreateSerializer",
    value={
        "name": "New Project",
        "description": "New project description",
        "identifier": "new-project",
        "project_lead": "0ec6cfa4-e906-4aad-9390-2df0303a41ce",
    },
    description="Example request for creating a project",
)

PROJECT_UPDATE_EXAMPLE = OpenApiExample(
    "ProjectUpdateSerializer",
    value={
        "name": "Updated Project",
        "description": "Updated project description",
        "identifier": "updated-project",
        "project_lead": "0ec6cfa4-e906-4aad-9390-2df0303a41ce",
    },
    description="Example request for updating a project",
)

# State Examples
STATE_CREATE_EXAMPLE = OpenApiExample(
    "StateCreateSerializer",
    value={
        "name": "New State",
        "color": "#ff0000",
        "group": "backlog",
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for creating a state",
)

STATE_UPDATE_EXAMPLE = OpenApiExample(
    "StateUpdateSerializer",
    value={
        "name": "Updated State",
        "color": "#00ff00",
        "group": "backlog",
        "external_id": "1234567890",
        "external_source": "github",
    },
    description="Example request for updating a state",
)

# Intake Examples
INTAKE_ISSUE_CREATE_EXAMPLE = OpenApiExample(
    "IntakeIssueCreateSerializer",
    value={
        "issue": {
            "name": "New Issue",
            "description": "New issue description",
            "priority": "medium",
        }
    },
    description="Example request for creating an intake issue",
)

INTAKE_ISSUE_UPDATE_EXAMPLE = OpenApiExample(
    "IntakeIssueUpdateSerializer",
    value={
        "status": 1,
        "issue": {
            "name": "Updated Issue",
            "description": "Updated issue description",
            "priority": "high",
        },
    },
    description="Example request for updating an intake issue",
)


# ============================================================================
# RESPONSE EXAMPLES
# ----------------------------------------------------------------------------
# Payloads referenced by ``@extend_schema(responses=…, examples=[…])`` and
# embedded in the :class:`OpenApiResponse` constants exposed from
# ``plane.utils.openapi.responses`` (e.g., ``CYCLE_RESPONSE``,
# ``MODULE_RESPONSE``). Field values mirror the read-shape of the
# corresponding DRF serializer in ``apps/api/plane/app/serializers/``.
# ============================================================================

# Cycle Response Examples
CYCLE_EXAMPLE = OpenApiExample(
    name="Cycle",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Sprint 1 - Q1 2024",
        "description": "First sprint of the quarter focusing on core features",
        "start_date": "2024-01-01",
        "end_date": "2024-01-14",
        "status": "current",
        "total_issues": 15,
        "completed_issues": 8,
        "cancelled_issues": 1,
        "started_issues": 4,
        "unstarted_issues": 2,
        "backlog_issues": 0,
        "created_at": "2024-01-01T10:30:00Z",
        "updated_at": "2024-01-10T15:45:00Z",
    },
)

# ----------------------------------------------------------------------------
# Transfer Cycle Issue Response Examples
# ----------------------------------------------------------------------------
# Success and two error variants used by the cycle-transfer endpoint:
# ``TRANSFER_CYCLE_ISSUE_SUCCESS_EXAMPLE`` (200), ``..._ERROR_EXAMPLE``
# (400 — missing new_cycle_id), ``TRANSFER_CYCLE_COMPLETED_ERROR_EXAMPLE``
# (400 — target cycle is completed).
TRANSFER_CYCLE_ISSUE_SUCCESS_EXAMPLE = OpenApiExample(
    name="Transfer Cycle Issue Success",
    value={
        "message": "Success",
    },
    description="Successful transfer of cycle issues to new cycle",
)

TRANSFER_CYCLE_ISSUE_ERROR_EXAMPLE = OpenApiExample(
    name="Transfer Cycle Issue Error",
    value={
        "error": "New Cycle Id is required",
    },
    description="Error when required cycle ID is missing",
)

TRANSFER_CYCLE_COMPLETED_ERROR_EXAMPLE = OpenApiExample(
    name="Transfer to Completed Cycle Error",
    value={
        "error": "The cycle where the issues are transferred is already completed",
    },
    description="Error when trying to transfer to a completed cycle",
)

# Module Response Examples
MODULE_EXAMPLE = OpenApiExample(
    name="Module",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Authentication Module",
        "description": "User authentication and authorization features",
        "start_date": "2024-01-01",
        "target_date": "2024-02-15",
        "status": "in-progress",
        "total_issues": 12,
        "completed_issues": 5,
        "cancelled_issues": 0,
        "started_issues": 4,
        "unstarted_issues": 3,
        "backlog_issues": 0,
        "created_at": "2024-01-01T10:30:00Z",
        "updated_at": "2024-01-10T15:45:00Z",
    },
)

# State Response Examples
STATE_EXAMPLE = OpenApiExample(
    name="State",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "In Progress",
        "color": "#f39c12",
        "group": "started",
        "sequence": 2,
        "default": False,
        "created_at": "2024-01-01T10:30:00Z",
        "updated_at": "2024-01-10T15:45:00Z",
    },
)

# Label Response Examples
LABEL_EXAMPLE = OpenApiExample(
    name="Label",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "bug",
        "color": "#ff4444",
        "description": "Issues that represent bugs in the system",
        "created_at": "2024-01-01T10:30:00Z",
        "updated_at": "2024-01-10T15:45:00Z",
    },
)

# Issue Link Response Examples
ISSUE_LINK_EXAMPLE = OpenApiExample(
    name="IssueLink",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "url": "https://github.com/example/repo/pull/123",
        "title": "Fix authentication bug",
        "metadata": {
            "title": "Fix authentication bug",
            "description": "Pull request to fix authentication timeout issue",
            "image": "https://github.com/example/repo/avatar.png",
        },
        "created_at": "2024-01-01T10:30:00Z",
        "updated_at": "2024-01-10T15:45:00Z",
    },
)

# Issue Comment Response Examples
ISSUE_COMMENT_EXAMPLE = OpenApiExample(
    name="IssueComment",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "comment_html": "<p>This issue has been resolved by implementing OAuth 2.0 flow.</p>",  # noqa: E501
        "comment_json": {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {
                            "type": "text",
                            "text": "This issue has been resolved by implementing OAuth 2.0 flow.",  # noqa: E501
                        }
                    ],
                }
            ],
        },
        "actor": {
            "id": "550e8400-e29b-41d4-a716-446655440001",
            "first_name": "John",
            "last_name": "Doe",
            "display_name": "John Doe",
            "avatar": "https://example.com/avatar.jpg",
        },
        "created_at": "2024-01-01T10:30:00Z",
        "updated_at": "2024-01-10T15:45:00Z",
    },
)

# Issue Attachment Response Examples
ISSUE_ATTACHMENT_EXAMPLE = OpenApiExample(
    name="IssueAttachment",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "screenshot.png",
        "size": 1024000,
        "asset_url": "https://s3.amazonaws.com/bucket/screenshot.png?signed-url",
        "attributes": {
            "name": "screenshot.png",
            "type": "image/png",
            "size": 1024000,
        },
        "created_at": "2024-01-01T10:30:00Z",
        "updated_at": "2024-01-10T15:45:00Z",
    },
)

# ----------------------------------------------------------------------------
# Issue Attachment Error Response Examples
# ----------------------------------------------------------------------------
# Returned when a client requests a download URL before the client-side
# S3/MinIO upload step has been confirmed via
# ``ATTACHMENT_UPLOAD_CONFIRM_EXAMPLE``.
ISSUE_ATTACHMENT_NOT_UPLOADED_EXAMPLE = OpenApiExample(
    name="Issue Attachment Not Uploaded",
    value={
        "error": "The asset is not uploaded.",
        "status": False,
    },
    description="Error when trying to download an attachment that hasn't been uploaded yet",  # noqa: E501
)

# Intake Issue Response Examples
INTAKE_ISSUE_EXAMPLE = OpenApiExample(
    name="IntakeIssue",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "status": 0,  # Pending
        "source": "in_app",
        "issue": {
            "id": "550e8400-e29b-41d4-a716-446655440001",
            "name": "Feature request: Dark mode",
            "description": "Add dark mode support to the application",
            "priority": "medium",
            "sequence_id": 124,
        },
        "created_at": "2024-01-01T10:30:00Z",
        "updated_at": "2024-01-10T15:45:00Z",
    },
)

# Module Issue Response Examples
MODULE_ISSUE_EXAMPLE = OpenApiExample(
    name="ModuleIssue",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "module": "550e8400-e29b-41d4-a716-446655440001",
        "issue": "550e8400-e29b-41d4-a716-446655440002",
        "sub_issues_count": 2,
        "created_at": "2024-01-01T10:30:00Z",
        "updated_at": "2024-01-10T15:45:00Z",
    },
)

# Issue Search Response Examples
ISSUE_SEARCH_EXAMPLE = OpenApiExample(
    name="IssueSearchResults",
    value={
        "issues": [
            {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "name": "Fix authentication bug in user login",
                "sequence_id": 123,
                "project__identifier": "MAB",
                "project_id": "550e8400-e29b-41d4-a716-446655440001",
                "workspace__slug": "my-workspace",
            },
            {
                "id": "550e8400-e29b-41d4-a716-446655440002",
                "name": "Add authentication middleware",
                "sequence_id": 124,
                "project__identifier": "MAB",
                "project_id": "550e8400-e29b-41d4-a716-446655440001",
                "workspace__slug": "my-workspace",
            },
        ]
    },
)

# Workspace Member Response Examples
WORKSPACE_MEMBER_EXAMPLE = OpenApiExample(
    name="WorkspaceMembers",
    value=[
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "first_name": "John",
            "last_name": "Doe",
            "display_name": "John Doe",
            "email": "john.doe@example.com",
            "avatar": "https://example.com/avatar.jpg",
            "role": 20,
        },
        {
            "id": "550e8400-e29b-41d4-a716-446655440001",
            "first_name": "Jane",
            "last_name": "Smith",
            "display_name": "Jane Smith",
            "email": "jane.smith@example.com",
            "avatar": "https://example.com/avatar2.jpg",
            "role": 15,
        },
    ],
)

# Project Member Response Examples
PROJECT_MEMBER_EXAMPLE = OpenApiExample(
    name="ProjectMembers",
    value=[
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "first_name": "John",
            "last_name": "Doe",
            "display_name": "John Doe",
            "email": "john.doe@example.com",
            "avatar": "https://example.com/avatar.jpg",
        },
        {
            "id": "550e8400-e29b-41d4-a716-446655440001",
            "first_name": "Jane",
            "last_name": "Smith",
            "display_name": "Jane Smith",
            "email": "jane.smith@example.com",
            "avatar": "https://example.com/avatar2.jpg",
        },
    ],
)

# Cycle Issue Response Examples
CYCLE_ISSUE_EXAMPLE = OpenApiExample(
    name="CycleIssue",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "cycle": "550e8400-e29b-41d4-a716-446655440001",
        "issue": "550e8400-e29b-41d4-a716-446655440002",
        "sub_issues_count": 3,
        "created_at": "2024-01-01T10:30:00Z",
        "updated_at": "2024-01-10T15:45:00Z",
    },
)

STICKY_EXAMPLE = OpenApiExample(
    name="Sticky",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Sticky 1",
        "description_html": "<p>Sticky 1 description</p>",
        "created_at": "2024-01-01T10:30:00Z",
    },
)

# Estimate Examples
ESTIMATE_EXAMPLE = OpenApiExample(
    name="Estimate",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Estimate 1",
        "description": "Estimate 1 description",
    },
    description="Example response for an estimate",
)

ESTIMATE_POINT_EXAMPLE = OpenApiExample(
    name="EstimatePoint",
    value={
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "estimate": "550e8400-e29b-41d4-a716-446655440001",
        "key": 1,
        "value": "1",
    },
    description="Example response for an estimate point",
)
ESTIMATE_CREATE_EXAMPLE = OpenApiExample(
    name="EstimateCreateSerializer",
    value={
        "name": "Estimate 1",
        "description": "Estimate 1 description",
    },
    description="Example request for creating an estimate",
)
ESTIMATE_UPDATE_EXAMPLE = OpenApiExample(
    name="EstimateUpdateSerializer",
    value={
        "name": "Estimate 1",
        "description": "Estimate 1 description",
    },
    description="Example request for updating an estimate",
)

# Estimate Point Examples
ESTIMATE_POINT_CREATE_EXAMPLE = OpenApiExample(
    name="EstimatePointCreateSerializer",
    value=[
        {
            "value": "1",
            "description": "Estimate Point 1 description",
        },
        {
            "value": "2",
            "description": "Estimate Point 2 description",
        },
    ],
    description="Example request for creating an estimate point",
)
ESTIMATE_POINT_UPDATE_EXAMPLE = OpenApiExample(
    name="EstimatePointUpdateSerializer",
    value={
        "value": "1",
        "description": "Estimate Point 1 description",
    },
    description="Example request for updating an estimate point",
)


# ============================================================================
# Sample Data Dictionaries
# ----------------------------------------------------------------------------
# Bare ``dict`` payloads (no ``OpenApiExample`` wrapper) consumed by
# :func:`get_sample_for_schema` and indexed by :data:`SCHEMA_EXAMPLES`
# below. These power dynamic example resolution for paginated envelope
# schemas (e.g., ``PaginatedIssueResponse`` → strip ``"Paginated"`` and
# ``"Response"`` → look up ``"Issue"`` → return ``SAMPLE_ISSUE``).
# ``SAMPLE_GENERIC`` is the fallback when no specific entity match exists.
# ============================================================================
SAMPLE_ISSUE = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Fix authentication bug in user login",
    "description": "Users are unable to log in due to authentication service timeout",
    "priority": "high",
    "sequence_id": 123,
    "state": {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "name": "In Progress",
        "group": "started",
    },
    "assignees": [],
    "labels": [],
    "created_at": "2024-01-15T10:30:00Z",
}

SAMPLE_LABEL = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "bug",
    "color": "#ff4444",
    "description": "Issues that represent bugs in the system",
}

SAMPLE_CYCLE = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Sprint 1 - Q1 2024",
    "description": "First sprint of the quarter focusing on core features",
    "start_date": "2024-01-01",
    "end_date": "2024-01-14",
    "status": "current",
}

SAMPLE_MODULE = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Authentication Module",
    "description": "User authentication and authorization features",
    "start_date": "2024-01-01",
    "target_date": "2024-02-15",
    "status": "in_progress",
}

SAMPLE_PROJECT = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Mobile App Backend",
    "description": "Backend services for the mobile application",
    "identifier": "MAB",
    "network": 2,
}

SAMPLE_STATE = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "In Progress",
    "color": "#ffa500",
    "group": "started",
    "sequence": 2,
}

SAMPLE_COMMENT = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "comment_html": "<p>This issue needs more investigation. I'll look into the database connection timeout.</p>",  # noqa: E501
    "created_at": "2024-01-15T14:20:00Z",
    "actor": {"id": "550e8400-e29b-41d4-a716-446655440002", "display_name": "John Doe"},
}

SAMPLE_LINK = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "url": "https://github.com/example/repo/pull/123",
    "title": "Fix authentication timeout issue",
    "metadata": {},
}

SAMPLE_ACTIVITY = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "field": "priority",
    "old_value": "medium",
    "new_value": "high",
    "created_at": "2024-01-15T11:45:00Z",
    "actor": {
        "id": "550e8400-e29b-41d4-a716-446655440002",
        "display_name": "Jane Smith",
    },
}

SAMPLE_INTAKE = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": 0,
    "issue": {
        "id": "550e8400-e29b-41d4-a716-446655440003",
        "name": "Feature request: Dark mode support",
    },
    "created_at": "2024-01-15T09:15:00Z",
}

SAMPLE_GENERIC = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Sample Item",
    "created_at": "2024-01-15T12:00:00Z",
}

SAMPLE_CYCLE_ISSUE = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "cycle": "550e8400-e29b-41d4-a716-446655440001",
    "issue": "550e8400-e29b-41d4-a716-446655440002",
    "sub_issues_count": 3,
    "created_at": "2024-01-01T10:30:00Z",
}

SAMPLE_STICKY = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Sticky 1",
    "description_html": "<p>Sticky 1 description</p>",
    "created_at": "2024-01-01T10:30:00Z",
}

SAMPLE_ESTIMATE = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Estimate 1",
    "description": "Estimate 1 description",
    "type": "categories",
    "last_used": False,
    "created_at": "2024-01-01T10:30:00Z",
}

SAMPLE_ESTIMATE_POINT = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "estimate": "550e8400-e29b-41d4-a716-446655440001",
    "key": 1,
    "value": "1",
    "description": "Estimate Point 1 description",
    "created_at": "2024-01-01T10:30:00Z",
}

# ----------------------------------------------------------------------------
# Schema-name → sample-data lookup table.
# ----------------------------------------------------------------------------
# Note the dual entry ``"Issue": SAMPLE_ISSUE`` and ``"WorkItem": SAMPLE_ISSUE``
# — both schema names map to the same payload because Plane is in the
# middle of the issue→work-item terminology migration. New schema names
# should be added here as new entities are documented.
SCHEMA_EXAMPLES = {
    "Issue": SAMPLE_ISSUE,
    "WorkItem": SAMPLE_ISSUE,
    "Label": SAMPLE_LABEL,
    "Cycle": SAMPLE_CYCLE,
    "Module": SAMPLE_MODULE,
    "Project": SAMPLE_PROJECT,
    "State": SAMPLE_STATE,
    "Comment": SAMPLE_COMMENT,
    "Link": SAMPLE_LINK,
    "Activity": SAMPLE_ACTIVITY,
    "Intake": SAMPLE_INTAKE,
    "CycleIssue": SAMPLE_CYCLE_ISSUE,
    "Sticky": SAMPLE_STICKY,
    "Estimate": SAMPLE_ESTIMATE,
    "EstimatePoint": SAMPLE_ESTIMATE_POINT,
}


def get_sample_for_schema(schema_name):
    """Return the matching ``SAMPLE_*`` dict for a drf-spectacular schema name.

    Two-pass resolution:

      1. If ``schema_name`` starts with ``"Paginated"`` (e.g.,
         ``"PaginatedIssueResponse"``), strip the ``"Paginated"`` prefix
         AND the ``"Response"`` suffix to obtain the bare entity name
         (``"Issue"``), then look it up in :data:`SCHEMA_EXAMPLES`.
      2. Otherwise look up ``schema_name`` directly in :data:`SCHEMA_EXAMPLES`.

    Falls back to :data:`SAMPLE_GENERIC` when neither lookup matches —
    callers always get a non-None dict suitable for embedding in
    :class:`OpenApiExample`.

    Called from :func:`plane.utils.openapi.responses.create_paginated_response`
    to inject realistic results into the rendered paginated-envelope
    response schema in Swagger / ReDoc.

    Args:
        schema_name: Schema identifier as drf-spectacular sees it. Common
            patterns: bare entity name (``"Issue"``, ``"Cycle"``,
            ``"Module"``, ``"State"``, ``"Label"``, …) or paginated wrapper
            name (``"PaginatedIssueResponse"``, ``"PaginatedCycleResponse"``,
            …).

    Returns:
        dict: Sample data dict matching the schema, or :data:`SAMPLE_GENERIC`
        if no match.
    """
    # Extract base schema name from paginated responses
    if schema_name.startswith("Paginated"):
        base_name = schema_name.replace("Paginated", "").replace("Response", "")
        return SCHEMA_EXAMPLES.get(base_name, SAMPLE_GENERIC)

    return SCHEMA_EXAMPLES.get(schema_name, SAMPLE_GENERIC)
