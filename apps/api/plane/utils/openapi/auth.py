# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""drf-spectacular authentication scheme extensions for Plane's custom auth classes.

drf-spectacular discovers ``OpenApiAuthenticationExtension`` subclasses
automatically — simply importing this module (via ``__init__.py``) is
sufficient to register the extensions with the schema generator. Each
extension declares which ``rest_framework.authentication.BaseAuthentication``
subclass it describes via the ``target_class`` attribute and emits the
matching OpenAPI 3.0 ``securitySchemes`` entry from
:meth:`OpenApiAuthenticationExtension.get_security_definition`.

Currently described schemes:

  - **API Key** (:class:`APIKeyAuthenticationExtension`) — describes the
    ``X-API-Key`` header consumed by
    ``plane.api.middleware.api_authentication.APIKeyAuthentication``
    on every ``/api/v1/`` endpoint. Emitted as OpenAPI 3.0
    ``{"type": "apiKey", "in": "header", "name": "X-API-Key"}``.

Session and cookie authentication (used by ``/api/`` app endpoints) are
NOT described here; they rely on drf-spectacular's built-in
``rest_framework.authentication.SessionAuthentication`` discovery and on
the ``SECURITY`` entries in ``apps/api/plane/settings/openapi.py``.

This module is loaded transitively via ``apps/api/plane/utils/openapi/__init__.py``,
which is itself only consumed when ``settings.ENABLE_DRF_SPECTACULAR`` is
truthy (see ``apps/api/plane/urls.py`` line 42).
"""

from drf_spectacular.extensions import OpenApiAuthenticationExtension


class APIKeyAuthenticationExtension(OpenApiAuthenticationExtension):
    """OpenAPI scheme extension for Plane's ``X-API-Key`` header authentication.

    Declares to drf-spectacular that ``/api/v1/`` endpoints protected by
    ``plane.api.middleware.api_authentication.APIKeyAuthentication`` accept
    an API key in the ``X-API-Key`` request header. drf-spectacular discovers
    this class automatically on module import; no explicit registration is
    required.

    Attributes:
        target_class: Dotted path to the DRF authentication class this
            extension describes — ``plane.api.middleware.api_authentication.APIKeyAuthentication``.
        name: Identifier used in the generated OpenAPI ``securitySchemes``
            object (``"ApiKeyAuthentication"``). View-level
            ``@extend_schema(auth=[{"ApiKeyAuthentication": []}])`` references
            use this exact string.
        priority: drf-spectacular resolution priority when multiple extensions
            target the same class (``1``). Higher values win.
    """

    target_class = "plane.api.middleware.api_authentication.APIKeyAuthentication"
    name = "ApiKeyAuthentication"
    priority = 1

    def get_security_definition(self, auto_schema):
        """Return the OpenAPI 3.0 ``securityScheme`` object for API key auth.

        Called once per schema generation by drf-spectacular. The returned
        dict is inserted under ``components.securitySchemes.ApiKeyAuthentication``
        in the rendered OpenAPI document.

        Args:
            auto_schema: drf-spectacular ``AutoSchema`` instance for the
                current operation. Unused here — the API key scheme is
                operation-independent — but required by the
                ``OpenApiAuthenticationExtension`` interface.

        Returns:
            dict: OpenAPI 3.0 ``securityScheme`` object with keys ``type``
            (``"apiKey"``), ``in`` (``"header"``), ``name`` (``"X-API-Key"``),
            and ``description``.
        """
        return {
            "type": "apiKey",
            "in": "header",
            "name": "X-API-Key",
            "description": "API key authentication. Provide your API key in the X-API-Key header.",  # noqa: E501
        }
