# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Core instance-configuration variable metadata.

Declares the canonical metadata for every core instance-configuration
variable an administrator can manage from the admin UI: authentication
toggles, workspace controls, OAuth provider credentials (Google, GitHub,
GitLab, Gitea), SMTP delivery settings, LLM/AI provider credentials, and
the Unsplash access key.

Each entry is a ``dict`` with four keys:

* ``key`` — the environment-variable name and configuration identifier
  (also the ``InstanceConfiguration.key`` column value).
* ``value`` — the bootstrap value resolved from ``os.environ`` at import
  time (not lazily). The ``configure_instance`` management command
  (:mod:`plane.license.management.commands.configure_instance`) writes
  this value into :class:`plane.license.models.InstanceConfiguration`
  only when the row does NOT already exist; subsequent edits via the
  admin UI take precedence, so the env var is a SEED and not a runtime
  override.
* ``category`` — admin-UI grouping label (one of ``AUTHENTICATION``,
  ``WORKSPACE_MANAGEMENT``, ``GOOGLE``, ``GITHUB``, ``GITLAB``,
  ``GITEA``, ``SMTP``, ``AI``, ``UNSPLASH``).
* ``is_encrypted`` — when ``True``, the value is Fernet-encrypted (key
  derived from Django's ``SECRET_KEY`` via PBKDF2-HMAC-SHA256, see
  :mod:`plane.license.utils.encryption`) before being persisted in
  :class:`plane.license.models.InstanceConfiguration`. Cleartext for
  feature toggles, hosts, and public OAuth client IDs; encrypted for
  client secrets, SMTP passwords, LLM API keys, and the Unsplash access
  key.

``core_config_variables`` concatenates every category-specific list into
a single ordered master list re-exported by the package ``__init__`` as
part of ``instance_config_variables``.

Note: ``GPT_ENGINE`` is retained for backwards compatibility; new code
should read ``LLM_MODEL`` instead.

Migrator startup contract (per AAP §0.2.2): the ``instance_configurations``
table that ultimately stores these entries is created by the migrator
container before API services start, so seed routines (the
``configure_instance`` management command, signal handlers) that iterate
this list at boot can assume the schema exists.
"""

# Python imports
import os

authentication_config_variables = [
    {
        "key": "ENABLE_SIGNUP",
        "value": os.environ.get("ENABLE_SIGNUP", "1"),
        "category": "AUTHENTICATION",
        "is_encrypted": False,
    },
    {
        "key": "ENABLE_EMAIL_PASSWORD",
        "value": os.environ.get("ENABLE_EMAIL_PASSWORD", "1"),
        "category": "AUTHENTICATION",
        "is_encrypted": False,
    },
    {
        "key": "ENABLE_MAGIC_LINK_LOGIN",
        "value": os.environ.get("ENABLE_MAGIC_LINK_LOGIN", "0"),
        "category": "AUTHENTICATION",
        "is_encrypted": False,
    },
]

workspace_management_config_variables = [
    {
        "key": "DISABLE_WORKSPACE_CREATION",
        "value": os.environ.get("DISABLE_WORKSPACE_CREATION", "0"),
        "category": "WORKSPACE_MANAGEMENT",
        "is_encrypted": False,
    },
]

google_config_variables = [
    {
        "key": "GOOGLE_CLIENT_ID",
        "value": os.environ.get("GOOGLE_CLIENT_ID"),
        "category": "GOOGLE",
        "is_encrypted": False,
    },
    {
        "key": "GOOGLE_CLIENT_SECRET",
        "value": os.environ.get("GOOGLE_CLIENT_SECRET"),
        "category": "GOOGLE",
        "is_encrypted": True,
    },
    {
        "key": "ENABLE_GOOGLE_SYNC",
        "value": os.environ.get("ENABLE_GOOGLE_SYNC", "0"),
        "category": "GOOGLE",
        "is_encrypted": False,
    },
]

github_config_variables = [
    {
        "key": "GITHUB_CLIENT_ID",
        "value": os.environ.get("GITHUB_CLIENT_ID"),
        "category": "GITHUB",
        "is_encrypted": False,
    },
    {
        "key": "GITHUB_CLIENT_SECRET",
        "value": os.environ.get("GITHUB_CLIENT_SECRET"),
        "category": "GITHUB",
        "is_encrypted": True,
    },
    {
        "key": "GITHUB_ORGANIZATION_ID",
        "value": os.environ.get("GITHUB_ORGANIZATION_ID"),
        "category": "GITHUB",
        "is_encrypted": False,
    },
    {
        "key": "ENABLE_GITHUB_SYNC",
        "value": os.environ.get("ENABLE_GITHUB_SYNC", "0"),
        "category": "GITHUB",
        "is_encrypted": False,
    },
]


gitlab_config_variables = [
    {
        "key": "GITLAB_HOST",
        "value": os.environ.get("GITLAB_HOST"),
        "category": "GITLAB",
        "is_encrypted": False,
    },
    {
        "key": "GITLAB_CLIENT_ID",
        "value": os.environ.get("GITLAB_CLIENT_ID"),
        "category": "GITLAB",
        "is_encrypted": False,
    },
    {
        "key": "GITLAB_CLIENT_SECRET",
        "value": os.environ.get("GITLAB_CLIENT_SECRET"),
        "category": "GITLAB",
        "is_encrypted": True,
    },
    {
        "key": "ENABLE_GITLAB_SYNC",
        "value": os.environ.get("ENABLE_GITLAB_SYNC", "0"),
        "category": "GITLAB",
        "is_encrypted": False,
    },
]

gitea_config_variables = [
    {
        "key": "IS_GITEA_ENABLED",
        "value": os.environ.get("IS_GITEA_ENABLED", "0"),
        "category": "GITEA",
        "is_encrypted": False,
    },
    {
        "key": "GITEA_HOST",
        "value": os.environ.get("GITEA_HOST"),
        "category": "GITEA",
        "is_encrypted": False,
    },
    {
        "key": "GITEA_CLIENT_ID",
        "value": os.environ.get("GITEA_CLIENT_ID"),
        "category": "GITEA",
        "is_encrypted": False,
    },
    {
        "key": "GITEA_CLIENT_SECRET",
        "value": os.environ.get("GITEA_CLIENT_SECRET"),
        "category": "GITEA",
        "is_encrypted": True,
    },
    {
        "key": "ENABLE_GITEA_SYNC",
        "value": os.environ.get("ENABLE_GITEA_SYNC", "0"),
        "category": "GITEA",
        "is_encrypted": False,
    },
]

smtp_config_variables = [
    {
        "key": "ENABLE_SMTP",
        "value": os.environ.get("ENABLE_SMTP", "0"),
        "category": "SMTP",
        "is_encrypted": False,
    },
    {
        "key": "EMAIL_HOST",
        "value": os.environ.get("EMAIL_HOST", ""),
        "category": "SMTP",
        "is_encrypted": False,
    },
    {
        "key": "EMAIL_HOST_USER",
        "value": os.environ.get("EMAIL_HOST_USER", ""),
        "category": "SMTP",
        "is_encrypted": False,
    },
    {
        "key": "EMAIL_HOST_PASSWORD",
        "value": os.environ.get("EMAIL_HOST_PASSWORD", ""),
        "category": "SMTP",
        "is_encrypted": True,
    },
    {
        "key": "EMAIL_PORT",
        "value": os.environ.get("EMAIL_PORT", "587"),
        "category": "SMTP",
        "is_encrypted": False,
    },
    {
        "key": "EMAIL_FROM",
        "value": os.environ.get("EMAIL_FROM", ""),
        "category": "SMTP",
        "is_encrypted": False,
    },
    {
        "key": "EMAIL_USE_TLS",
        "value": os.environ.get("EMAIL_USE_TLS", "1"),
        "category": "SMTP",
        "is_encrypted": False,
    },
    {
        "key": "EMAIL_USE_SSL",
        "value": os.environ.get("EMAIL_USE_SSL", "0"),
        "category": "SMTP",
        "is_encrypted": False,
    },
]

llm_config_variables = [
    {
        "key": "LLM_API_KEY",
        "value": os.environ.get("LLM_API_KEY"),
        "category": "AI",
        "is_encrypted": True,
    },
    {
        "key": "LLM_PROVIDER",
        "value": os.environ.get("LLM_PROVIDER", "openai"),
        "category": "AI",
        "is_encrypted": False,
    },
    {
        "key": "LLM_MODEL",
        "value": os.environ.get("LLM_MODEL", "gpt-4o-mini"),
        "category": "AI",
        "is_encrypted": False,
    },
    # Deprecated, use LLM_MODEL
    {
        "key": "GPT_ENGINE",
        "value": os.environ.get("GPT_ENGINE", "gpt-3.5-turbo"),
        "category": "AI",
        "is_encrypted": False,
    },
]

unsplash_config_variables = [
    {
        "key": "UNSPLASH_ACCESS_KEY",
        "value": os.environ.get("UNSPLASH_ACCESS_KEY", ""),
        "category": "UNSPLASH",
        "is_encrypted": True,
    },
]

core_config_variables = [
    *authentication_config_variables,
    *workspace_management_config_variables,
    *google_config_variables,
    *github_config_variables,
    *gitlab_config_variables,
    *gitea_config_variables,
    *smtp_config_variables,
    *llm_config_variables,
    *unsplash_config_variables,
]
