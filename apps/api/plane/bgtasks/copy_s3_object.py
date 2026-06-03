# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery task that duplicates ``FileAsset`` rows and copies S3 objects for duplicated pages/issues.

Trigger
    Invoked explicitly via ``.delay(entity_name, entity_identifier,
    project_id, slug, user_id)`` from page-duplicate and issue-duplicate
    endpoints (see ``apps/api/plane/app/views/page/base.py``) when a user
    duplicates a page or an issue. There is no Celery Beat schedule and no
    signal binding for this task -- it only runs in response to an explicit
    duplication API call.

Supported entity types
    ``"PAGE"`` (``plane.db.models.page.Page``) and ``"ISSUE"``
    (``plane.db.models.issue.Issue``), wired through the
    ``model_class = {"PAGE": Page, "ISSUE": Issue}`` dispatch dictionary
    inside the task body.

Async infrastructure
    Messages are queued onto **RabbitMQ** and consumed by Celery workers
    (per the project-wide "Celery via RabbitMQ" architectural rule). Redis
    is **not** the task broker -- it is reserved for caching and session
    storage.

Optional ``apps/live`` integration
    If ``settings.LIVE_URL`` is configured, the task POSTs the rewritten
    HTML to ``{LIVE_URL}/convert-document/`` so the live-server's Y.js
    collaborative document representation stays in sync with the
    duplicated HTML. When ``LIVE_URL`` is unset the round-trip is skipped
    and the task succeeds without populating ``description_binary`` /
    ``description_json``.
"""

# Python imports
import uuid
import base64
import requests
from bs4 import BeautifulSoup

# Django imports
from django.conf import settings

# Module imports
from plane.db.models import FileAsset, Page, Issue
from plane.utils.exception_logger import log_exception
from plane.settings.storage import S3Storage
from celery import shared_task
from plane.utils.url import normalize_url_path


def get_entity_id_field(entity_type, entity_id):
    """Return the ``FileAsset`` foreign-key kwargs mapping for the given entity type.

    Each ``FileAsset`` row is anchored to exactly one owning entity
    (workspace, project, user, issue, page, comment, or draft issue). This
    helper resolves the ``FileAsset.EntityTypeContext`` discriminator into
    the keyword argument expected by ``FileAsset.objects.create(...)`` so
    that the duplicated asset row points at the correct owning entity.
    Returns an empty dict for unknown entity types (caller continues
    without a typed FK).
    """
    entity_mapping = {
        FileAsset.EntityTypeContext.WORKSPACE_LOGO: {"workspace_id": entity_id},
        FileAsset.EntityTypeContext.PROJECT_COVER: {"project_id": entity_id},
        FileAsset.EntityTypeContext.USER_AVATAR: {"user_id": entity_id},
        FileAsset.EntityTypeContext.USER_COVER: {"user_id": entity_id},
        FileAsset.EntityTypeContext.ISSUE_ATTACHMENT: {"issue_id": entity_id},
        FileAsset.EntityTypeContext.ISSUE_DESCRIPTION: {"issue_id": entity_id},
        FileAsset.EntityTypeContext.PAGE_DESCRIPTION: {"page_id": entity_id},
        FileAsset.EntityTypeContext.COMMENT_DESCRIPTION: {"comment_id": entity_id},
        FileAsset.EntityTypeContext.DRAFT_ISSUE_DESCRIPTION: {"draft_issue_id": entity_id},
    }
    return entity_mapping.get(entity_type, {})


def extract_asset_ids(html, tag):
    """Return the list of ``src`` attribute values for every ``tag`` element in ``html``.

    Used to enumerate the ``FileAsset`` ids referenced by ``image-component``
    tags in a page/issue's ``description_html``. Parsing failures are
    logged and yield an empty list rather than propagating an exception
    so a single malformed HTML payload cannot poison the entire
    duplication pipeline.
    """
    try:
        soup = BeautifulSoup(html, "html.parser")
        return [tag.get("src") for tag in soup.find_all(tag) if tag.get("src")]
    except Exception as e:
        log_exception(e)
        return []


def replace_asset_ids(html, tag, duplicated_assets):
    """Replace each ``tag`` element's old asset ``src`` in ``html`` with the new duplicated id.

    ``duplicated_assets`` is the list of ``{"old_asset_id", "new_asset_id"}``
    pairs produced by :func:`copy_assets`. The original ``html`` is
    returned unchanged on parse error to preserve the caller's content.
    """
    try:
        soup = BeautifulSoup(html, "html.parser")
        for mention_tag in soup.find_all(tag):
            for asset in duplicated_assets:
                if mention_tag.get("src") == asset["old_asset_id"]:
                    mention_tag["src"] = asset["new_asset_id"]
        return str(soup)
    except Exception as e:
        log_exception(e)
        return html


def update_description(entity, duplicated_assets, tag):
    """Update ``entity.description_html`` to reference duplicated asset ids and persist the row.

    DB side effect: issues a single ``entity.save()``. Returns the new HTML
    so the caller can forward it to the live server without re-reading
    from the database.
    """
    updated_html = replace_asset_ids(entity.description_html, tag, duplicated_assets)
    entity.description_html = updated_html
    entity.save()
    return updated_html


# Get the description binary and description from the live server
def sync_with_external_service(entity_name, description_html):
    """Send the duplicated HTML to ``apps/live`` and return the converted Y.js representation.

    POSTs to ``{settings.LIVE_URL}/convert-document/`` with
    ``{"description_html", "variant"}`` where ``variant`` is ``"rich"``
    for pages and ``"document"`` for issues. On HTTP 200 the parsed JSON
    body (containing ``description_json`` and a base64
    ``description_binary``) is returned to the caller. Returns an empty
    dict when ``LIVE_URL`` is unset, when the live server responds with
    any non-200 status, or when the request raises -- enabling
    single-process deployments without the live server to skip the
    round-trip without failing duplication.
    """
    try:
        data = {
            "description_html": description_html,
            "variant": "rich" if entity_name == "PAGE" else "document",
        }

        live_url = settings.LIVE_URL
        if not live_url:
            return {}

        url = normalize_url_path(f"{live_url}/convert-document/")

        response = requests.post(url, json=data, headers=None)
        if response.status_code == 200:
            return response.json()
    except requests.RequestException as e:
        log_exception(e)
    return {}


def copy_assets(entity, entity_identifier, project_id, asset_ids, user_id):
    """Duplicate the ``FileAsset`` rows referenced by ``asset_ids`` and copy the underlying S3 objects.

    For each source asset a new ``FileAsset`` row is created with a freshly
    generated destination key (``{workspace_id}/{uuid4-hex}-{name}``), the
    object is server-side copied via ``S3Storage.copy_object`` -- avoiding
    a download/upload round-trip through the API process -- and once all
    rows are written they are bulk-flipped to ``is_uploaded=True``. The
    returned list of ``{"new_asset_id", "old_asset_id"}`` mappings is
    consumed by :func:`replace_asset_ids` to rewrite the duplicated
    entity's ``description_html``.

    Side effects:
        - One ``FileAsset.objects.create`` per source asset (rows are
          attributed to ``user_id`` via ``created_by_id``).
        - One ``S3Storage.copy_object`` per source asset.
        - One bulk ``FileAsset.objects.filter(...).update(is_uploaded=True)``
          across the new rows.

    Non-idempotent: re-invoking with the same arguments produces a fresh
    set of ``FileAsset`` rows and fresh S3 keys each time.
    """
    duplicated_assets = []
    workspace = entity.workspace
    storage = S3Storage()
    original_assets = FileAsset.objects.filter(workspace=workspace, project_id=project_id, id__in=asset_ids)

    for original_asset in original_assets:
        destination_key = f"{workspace.id}/{uuid.uuid4().hex}-{original_asset.attributes.get('name')}"
        duplicated_asset = FileAsset.objects.create(
            attributes={
                "name": original_asset.attributes.get("name"),
                "type": original_asset.attributes.get("type"),
                "size": original_asset.attributes.get("size"),
            },
            asset=destination_key,
            size=original_asset.size,
            workspace=workspace,
            created_by_id=user_id,
            entity_type=original_asset.entity_type,
            project_id=project_id,
            storage_metadata=original_asset.storage_metadata,
            **get_entity_id_field(original_asset.entity_type, entity_identifier),
        )
        storage.copy_object(original_asset.asset, destination_key)
        duplicated_assets.append(
            {
                "new_asset_id": str(duplicated_asset.id),
                "old_asset_id": str(original_asset.id),
            }
        )
    if duplicated_assets:
        FileAsset.objects.filter(pk__in=[item["new_asset_id"] for item in duplicated_assets]).update(is_uploaded=True)

    return duplicated_assets


@shared_task
def copy_s3_objects_of_description_and_assets(entity_name, entity_identifier, project_id, slug, user_id):
    """Duplicate ``FileAsset`` rows and copy underlying S3 objects for the duplicated entity.

    Pipeline:
        1. Extract ``image-component`` asset ids from the duplicated
           entity's ``description_html``.
        2. Duplicate each referenced ``FileAsset`` row and server-side
           copy its S3 object via :func:`copy_assets`.
        3. Rewrite the duplicated entity's ``description_html`` to point
           at the new asset ids and persist it via
           :func:`update_description`.
        4. If ``settings.LIVE_URL`` is configured, ask ``apps/live`` to
           convert the new HTML into a Y.js binary plus JSON
           representation and persist them back onto the entity so
           collaborative editors see the duplicated content immediately.

    Trigger:
        Explicit ``copy_s3_objects_of_description_and_assets.delay(
        entity_name, entity_identifier, project_id, slug, user_id)`` from
        page-duplicate and issue-duplicate endpoints (see
        ``apps/api/plane/app/views/page/base.py``). The Celery message is
        routed via **RabbitMQ** and consumed by the worker. There is no
        Celery Beat entry and no signal binding.

    Side effects:
        - **HTML parse**: parses ``description_html`` with BeautifulSoup
          to extract ``image-component`` ``src`` attributes referencing
          ``FileAsset`` rows.
        - **DB writes**: duplicates each referenced ``FileAsset`` row
          (fresh primary key, ``created_by_id=user_id``), rewrites
          ``image-component`` ``src`` attributes to point at the new
          asset ids, and persists the rewritten ``description_html`` on
          the duplicated entity. May additionally persist
          ``description_binary`` / ``description_json`` when the live
          server responds successfully.
        - **S3 copy**: for each duplicated ``FileAsset``, calls
          ``S3Storage().copy_object(source_key, dest_key)`` to copy the
          underlying object server-side.
        - **External call (optional)**: if ``settings.LIVE_URL`` is
          configured, POSTs the new HTML to
          ``{LIVE_URL}/convert-document/`` so the live-server's Y.js doc
          stays in sync.
        - **No** emails. **No** webhook fan-out. **No** cache
          invalidation.

    Idempotency:
        NON-idempotent. Each invocation generates fresh ``FileAsset`` ids
        and fresh S3 keys; duplicate invocations would duplicate rows and
        copy S3 objects again. The caller is responsible for one-shot
        duplication semantics.

    Error handling:
        All exceptions are swallowed and logged via ``log_exception``;
        the task returns an empty list on failure rather than retrying.
        Partial progress (some assets copied before the failure) is left
        in place.

    Args:
        entity_name: One of ``"PAGE"`` or ``"ISSUE"`` -- discriminator
            used to dispatch via the ``model_class`` mapping inside the
            task body. Any other value raises ``ValueError`` (which is
            caught and logged).
        entity_identifier: Primary key of the **duplicated** entity (the
            new row whose ``description_html`` was copied verbatim from
            the source and now needs its asset references rewritten).
        project_id: Project primary key; scopes the ``FileAsset`` lookup
            to assets owned by the same project as the duplicated entity.
        slug: Workspace slug. Accepted for parity with related task
            signatures; the current implementation does not read it.
        user_id: Primary key of the user who initiated the duplication,
            recorded as ``created_by_id`` on the new ``FileAsset`` rows.
    """
    try:
        model_class = {"PAGE": Page, "ISSUE": Issue}.get(entity_name)
        if not model_class:
            raise ValueError(f"Unsupported entity_name: {entity_name}")

        entity = model_class.objects.get(id=entity_identifier)
        asset_ids = extract_asset_ids(entity.description_html, "image-component")

        duplicated_assets = copy_assets(entity, entity_identifier, project_id, asset_ids, user_id)

        updated_html = update_description(entity, duplicated_assets, "image-component")

        external_data = sync_with_external_service(entity_name, updated_html)

        if external_data:
            entity.description_json = external_data.get("description_json")
            entity.description_binary = base64.b64decode(external_data.get("description_binary"))
            entity.save()

        return
    except Exception as e:
        log_exception(e)
        return []
