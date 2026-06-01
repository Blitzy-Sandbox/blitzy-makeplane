# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""External integration endpoints: LLM proxy (OpenAI / Anthropic / Gemini) and Unsplash image search.

These views proxy third-party APIs from the authenticated Plane backend so
provider API keys never reach the browser. Credentials and provider
selection are read from :class:`plane.license.models.InstanceConfiguration`
when ``settings.SKIP_ENV_VAR`` is set (instance-admin UI flow, values
Fernet-encrypted at rest) and fall back to the process environment
otherwise (``LLM_API_KEY`` / ``LLM_PROVIDER`` / ``LLM_MODEL`` /
``UNSPLASH_ACCESS_KEY``) -- see
:func:`plane.license.utils.instance_value.get_configuration_value`.

Provider abstraction:

* :class:`LLMProvider` -- base class capturing the per-provider metadata
  (display name, supported model allowlist, default model).
* :class:`OpenAIProvider`, :class:`AnthropicProvider`,
  :class:`GeminiProvider` -- concrete provider classes registered in
  ``SUPPORTED_PROVIDERS`` and resolved at request time from
  ``LLM_PROVIDER``.

LLM completion is performed via the OpenAI Python SDK
(:class:`openai.OpenAI`), which is also used as the protocol client for
Anthropic and Gemini through the same chat-completions interface (Gemini
requires a ``"gemini/"`` model prefix per provider conventions).

The three HTTP endpoints exposed are:

* :class:`GPTIntegrationEndpoint` -- project-scoped POST that returns the
  generated text plus the project and workspace detail payloads.
* :class:`WorkspaceGPTIntegrationEndpoint` -- workspace-scoped POST that
  returns only the generated text payload.
* :class:`UnsplashEndpoint` -- workspace-agnostic GET that proxies the
  Unsplash search/browse API.

These are synchronous proxies; long-running upstream LLM calls block the
request thread. The endpoints intentionally do NOT use Celery (LLM
completion latency is typically <15s and the web client expects a
synchronous response). When the upstream provider returns
``AuthenticationError`` / ``RateLimitError``, the error is logged via
:func:`plane.utils.exception_logger.log_exception` and the response is
rewritten to a generic 500 (the upstream error message is intentionally
not surfaced to the client to avoid leaking provider state).
"""

# Python import
import os
from typing import List, Dict, Tuple

# Third party import
from openai import OpenAI
import requests

from rest_framework import status
from rest_framework.response import Response

# Module import
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ProjectLiteSerializer, WorkspaceLiteSerializer
from plane.db.models import Project, Workspace
from plane.license.utils.instance_value import get_configuration_value
from plane.utils.exception_logger import log_exception

from ..base import BaseAPIView


class LLMProvider:
    """Base class capturing per-provider LLM metadata (display name, model allowlist, default model)."""

    name: str = ""
    models: List[str] = []
    default_model: str = ""

    @classmethod
    def get_config(cls) -> Dict[str, str | List[str]]:
        """Return the provider metadata as a plain dict (``name``, ``models``, ``default_model``)."""
        return {
            "name": cls.name,
            "models": cls.models,
            "default_model": cls.default_model,
        }


class OpenAIProvider(LLMProvider):
    """OpenAI provider metadata. Default model: ``gpt-4o-mini``.

    The ``models`` allowlist (``gpt-3.5-turbo``, ``gpt-4o-mini``,
    ``gpt-4o``, ``o1-mini``, ``o1-preview``) is validated against the
    ``LLM_MODEL`` configuration value in :func:`get_llm_config`; unknown
    models are rejected before any upstream call is made.
    """

    name = "OpenAI"
    models = ["gpt-3.5-turbo", "gpt-4o-mini", "gpt-4o", "o1-mini", "o1-preview"]
    default_model = "gpt-4o-mini"


class AnthropicProvider(LLMProvider):
    """Anthropic provider metadata. Default model: ``claude-3-sonnet-20240229``.

    The ``models`` allowlist covers the Claude 3 family (sonnet, haiku,
    opus, plus the 3.5-sonnet preview) and the legacy Claude 2.x / instant
    1.x models. Calls are routed through the OpenAI Python SDK using the
    Anthropic-compatible chat-completions protocol.
    """

    name = "Anthropic"
    models = [
        "claude-3-5-sonnet-20240620",
        "claude-3-haiku-20240307",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
        "claude-2.1",
        "claude-2",
        "claude-instant-1.2",
        "claude-instant-1",
    ]
    default_model = "claude-3-sonnet-20240229"


class GeminiProvider(LLMProvider):
    """Google Gemini provider metadata. Default model: ``gemini-pro``.

    Gemini models require a ``gemini/`` prefix when invoked via the OpenAI
    SDK shim -- :func:`get_llm_response` rewrites the model identifier
    accordingly before the upstream call.
    """

    name = "Gemini"
    models = ["gemini-pro", "gemini-1.5-pro-latest", "gemini-pro-vision"]
    default_model = "gemini-pro"


# Registry mapping a lowercased ``LLM_PROVIDER`` value to its provider class.
# Gates which providers can be selected at runtime.
SUPPORTED_PROVIDERS = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "gemini": GeminiProvider,
}


def get_llm_config() -> Tuple[str | None, str | None, str | None]:
    """Resolve the LLM config triple ``(api_key, model, provider_key)`` or ``(None, None, None)`` on misconfiguration.

    Reads ``LLM_API_KEY`` / ``LLM_PROVIDER`` / ``LLM_MODEL`` from
    :class:`plane.license.models.InstanceConfiguration` (Fernet-decrypted)
    when ``settings.SKIP_ENV_VAR`` is set, otherwise from the process
    environment. Validates that the resolved provider is in
    ``SUPPORTED_PROVIDERS`` and that the model is in the provider's
    ``models`` allowlist; any failure is logged via ``log_exception`` and
    the triple is collapsed to ``(None, None, None)`` so callers can
    short-circuit to a 400 response. If no ``LLM_MODEL`` is configured,
    the provider's ``default_model`` is substituted.
    """
    api_key, provider_key, model = get_configuration_value(
        [
            {
                "key": "LLM_API_KEY",
                "default": os.environ.get("LLM_API_KEY", None),
            },
            {
                "key": "LLM_PROVIDER",
                "default": os.environ.get("LLM_PROVIDER", "openai"),
            },
            {
                "key": "LLM_MODEL",
                "default": os.environ.get("LLM_MODEL", None),
            },
        ]
    )

    provider = SUPPORTED_PROVIDERS.get(provider_key.lower())
    if not provider:
        log_exception(ValueError(f"Unsupported provider: {provider_key}"))
        return None, None, None

    if not api_key:
        log_exception(ValueError(f"Missing API key for provider: {provider.name}"))
        return None, None, None

    # If no model specified, use provider's default
    if not model:
        model = provider.default_model

    # Validate model is supported by provider
    if model not in provider.models:
        log_exception(
            ValueError(
                f"Model {model} not supported by {provider.name}. Supported models: {', '.join(provider.models)}"
            )
        )
        return None, None, None

    return api_key, model, provider_key


def get_llm_response(task, prompt, api_key: str, model: str, provider: str) -> Tuple[str | None, str | None]:
    r"""Invoke the LLM and return ``(generated_text, None)`` on success or ``(None, error_message)`` on failure.

    Concatenates ``task + "\n" + prompt`` into a single user message and
    submits it to the OpenAI chat-completions API
    (:class:`openai.OpenAI`). Gemini provider calls are remapped to the
    ``gemini/<model>`` identifier expected by the SDK shim. Upstream
    ``AuthenticationError`` and ``RateLimitError`` exceptions are caught
    and translated to user-facing messages without leaking the original
    exception text; all other exceptions are logged via
    ``log_exception`` and surface as a generic provider-error message.
    """
    final_text = task + "\n" + prompt
    try:
        # For Gemini, prepend provider name to model
        if provider.lower() == "gemini":
            model = f"gemini/{model}"

        client = OpenAI(api_key=api_key)
        chat_completion = client.chat.completions.create(
            model=model, messages=[{"role": "user", "content": final_text}]
        )
        text = chat_completion.choices[0].message.content
        return text, None
    except Exception as e:
        log_exception(e)
        error_type = e.__class__.__name__
        if error_type == "AuthenticationError":
            return None, f"Invalid API key for {provider}"
        elif error_type == "RateLimitError":
            return None, f"Rate limit exceeded for {provider}"
        else:
            return None, f"Error occurred while generating response from {provider}"


class GPTIntegrationEndpoint(BaseAPIView):
    r"""Project-scoped LLM proxy for generating issue-description / comment text.

    HTTP methods + URL patterns:
        POST   /api/workspaces/<slug>/projects/<project_id>/ai-assistant/

    Request body (POST):
        task   (str, REQUIRED): The instruction passed to the LLM (e.g.,
            ``"Generate a concise summary of the following bug report"``).
            Returns 400 if missing.
        prompt (str, optional): Free-form context concatenated after
            ``task`` with a newline separator. Defaults to ``False``
            (treated as empty) when omitted.

    Response shape (200 OK):
        {
            "response":         str,   # raw LLM completion
            "response_html":    str,   # ``response`` with "\n" replaced by "<br/>"
            "project_detail":   ProjectLiteSerializer payload,
            "workspace_detail": WorkspaceLiteSerializer payload,
        }

    Response shape (400 Bad Request):
        {"error": "LLM provider API key and model are required"}  # misconfiguration
        {"error": "Task is required"}                              # missing task

    Response shape (500 Internal Server Error):
        {"error": "An internal error has occurred."}  # upstream LLM failure (auth, rate-limit, other)

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseAPIView`).
        @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
            (project-scoped role check applied on ``post`` -- guests are
            rejected with 403).

    Credentials:
        API key + model + provider are resolved at request time via
        :func:`get_llm_config`, which reads from
        :class:`plane.license.models.InstanceConfiguration` (Fernet
        encrypted) with env-var fallback.

    Notes:
        Synchronous proxy -- long-running upstream calls block the
        request thread. Upstream errors are logged via ``log_exception``
        and rewritten to a generic 500 to avoid leaking provider state.

    Cross-references:
        - Permissions: ``plane.app.views.base.BaseAPIView`` and
          ``plane.app.permissions.allow_permission``.
        - Serializers: ``plane.app.serializers.ProjectLiteSerializer``,
          ``plane.app.serializers.WorkspaceLiteSerializer``.
        - Models: ``plane.db.models.Project``, ``plane.db.models.Workspace``.
        - Configuration: ``plane.license.utils.instance_value.get_configuration_value``.
        - URL registration: ``apps/api/plane/app/urls/external.py``.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        """Generate LLM text for the given project and return it alongside the project/workspace detail payloads."""
        api_key, model, provider = get_llm_config()

        if not api_key or not model or not provider:
            return Response(
                {"error": "LLM provider API key and model are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        task = request.data.get("task", False)
        if not task:
            return Response({"error": "Task is required"}, status=status.HTTP_400_BAD_REQUEST)

        text, error = get_llm_response(task, request.data.get("prompt", False), api_key, model, provider)
        if not text and error:
            return Response(
                {"error": "An internal error has occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        workspace = Workspace.objects.get(slug=slug)
        project = Project.objects.get(pk=project_id)

        return Response(
            {
                "response": text,
                "response_html": text.replace("\n", "<br/>"),
                "project_detail": ProjectLiteSerializer(project).data,
                "workspace_detail": WorkspaceLiteSerializer(workspace).data,
            },
            status=status.HTTP_200_OK,
        )


class WorkspaceGPTIntegrationEndpoint(BaseAPIView):
    r"""Workspace-scoped LLM proxy for generating workspace-level text (no project context).

    HTTP methods + URL patterns:
        POST   /api/workspaces/<slug>/ai-assistant/

    Request body (POST):
        task   (str, REQUIRED): Same semantics as
            :class:`GPTIntegrationEndpoint`. Returns 400 if missing.
        prompt (str, optional): Free-form context. Defaults to ``False``.

    Response shape (200 OK):
        {
            "response":      str,  # raw LLM completion
            "response_html": str,  # "\n" replaced by "<br/>"
        }

    Response shape (400 Bad Request):
        {"error": "LLM provider API key and model are required"}
        {"error": "Task is required"}

    Response shape (500 Internal Server Error):
        {"error": "An internal error has occurred."}

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseAPIView`).
        @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
            (workspace-scoped role check applied on ``post``).

    Same credential resolution and synchronous-proxy semantics as
    :class:`GPTIntegrationEndpoint`; the difference is workspace scoping
    (no ``project_id`` URL kwarg) and a lighter response payload (no
    project/workspace detail).

    Cross-references:
        - Permissions: ``plane.app.views.base.BaseAPIView`` and
          ``plane.app.permissions.allow_permission``.
        - Models: ``plane.db.models.Workspace``.
        - Configuration: ``plane.license.utils.instance_value.get_configuration_value``.
        - URL registration: ``apps/api/plane/app/urls/external.py``.
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        """Generate LLM text for the workspace and return only the raw/HTML response payload (no project context)."""
        api_key, model, provider = get_llm_config()

        if not api_key or not model or not provider:
            return Response(
                {"error": "LLM provider API key and model are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        task = request.data.get("task", False)
        if not task:
            return Response({"error": "Task is required"}, status=status.HTTP_400_BAD_REQUEST)

        text, error = get_llm_response(task, request.data.get("prompt", False), api_key, model, provider)
        if not text and error:
            return Response(
                {"error": "An internal error has occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "response": text,
                "response_html": text.replace("\n", "<br/>"),
            },
            status=status.HTTP_200_OK,
        )


class UnsplashEndpoint(BaseAPIView):
    """Server-side proxy for the Unsplash image search/browse API.

    HTTP methods + URL patterns:
        GET    /api/unsplash/

    Request body:
        None (GET only). Inputs are passed as query parameters listed below.

    Query parameters:
        query    (str, optional): Search term. When omitted, the endpoint
            switches to "browse latest photos" mode.
        page     (int, optional, default=1): Pagination page number.
        per_page (int, optional, default=20): Page size.

    Response shape (200 OK -- with key configured + query present):
        Pass-through of the Unsplash search-photos response:
        {
            "total":       int,
            "total_pages": int,
            "results":     [<unsplash photo object>, ...],
        }

    Response shape (200 OK -- with key configured + no query):
        Pass-through of the Unsplash browse-photos response:
            [<unsplash photo object>, ...]

    Response shape (200 OK -- with key NOT configured):
        []  # empty list, signalling "Unsplash integration disabled"

    Response shape (non-200):
        Pass-through of the upstream Unsplash status code and body
        (the endpoint surfaces upstream errors verbatim).

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseAPIView`).
        No additional ``@allow_permission`` decorator -- any authenticated
        Plane user can call this endpoint regardless of workspace
        membership (the Unsplash search itself is public).

    Credentials:
        Unsplash access key is resolved via :func:`get_configuration_value`
        with key ``UNSPLASH_ACCESS_KEY`` -- read from
        :class:`plane.license.models.InstanceConfiguration` (Fernet
        encrypted at rest) with env-var fallback.

    Notes:
        Proxying here prevents leaking the Unsplash access key to the
        browser. The endpoint passes the upstream status code through
        unchanged so client-side rate-limit handling stays accurate.

    Cross-references:
        - Permissions: ``plane.app.views.base.BaseAPIView`` (inherits
          ``permission_classes = [IsAuthenticated]``).
        - Configuration: ``plane.license.utils.instance_value.get_configuration_value``
          and ``plane.license.models.InstanceConfiguration``.
        - URL registration: ``apps/api/plane/app/urls/external.py``.
    """

    def get(self, request):
        """Proxy the Unsplash search or browse-latest endpoint and pass through the upstream response."""
        (UNSPLASH_ACCESS_KEY,) = get_configuration_value(
            [
                {
                    "key": "UNSPLASH_ACCESS_KEY",
                    "default": os.environ.get("UNSPLASH_ACCESS_KEY"),
                }
            ]
        )
        # Check unsplash access key
        if not UNSPLASH_ACCESS_KEY:
            return Response([], status=status.HTTP_200_OK)

        # Query parameters
        query = request.GET.get("query", False)
        page = request.GET.get("page", 1)
        per_page = request.GET.get("per_page", 20)

        url = (
            f"https://api.unsplash.com/search/photos/?client_id={UNSPLASH_ACCESS_KEY}&query={query}&page=${page}&per_page={per_page}"
            if query
            else f"https://api.unsplash.com/photos/?client_id={UNSPLASH_ACCESS_KEY}&page={page}&per_page={per_page}"
        )

        headers = {"Content-Type": "application/json"}

        resp = requests.get(url=url, headers=headers)
        return Response(resp.json(), status=resp.status_code)
