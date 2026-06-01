# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routing for the Plane instance/license subsystem.

Mounted under ``api/instances/`` by the root URLconf (see ``apps/api/plane/urls.py``).
Routes administrative, configuration, authentication, and workspace-availability
endpoints for self-hosted Plane deployments.

Route groups:
    - ``""`` -> ``InstanceEndpoint`` (instance state read + bootstrap initialization)
    - ``admins/`` (collection + ``<uuid:pk>/`` detail) -> ``InstanceAdminEndpoint``
    - ``admins/me/`` -> ``InstanceAdminUserMeEndpoint`` (current admin profile)
    - ``admins/session/`` -> ``InstanceAdminUserSessionEndpoint`` (session status probe)
    - ``admins/sign-in/`` -> ``InstanceAdminSignInEndpoint`` (admin login)
    - ``admins/sign-up/`` -> ``InstanceAdminSignUpEndpoint`` (initial admin registration)
    - ``admins/sign-out/`` -> ``InstanceAdminSignOutEndpoint`` (session termination)
    - ``admins/sign-up-screen-visited/`` -> ``SignUpScreenVisitedEndpoint``
        (records that the signup screen was reached at least once)
    - ``configurations/`` -> ``InstanceConfigurationEndpoint``
        (instance-scoped key/value configuration read + bulk update; Fernet-encrypted
        values are decrypted on read)
    - ``configurations/disable-email-feature/`` -> ``DisableEmailFeatureEndpoint``
        (clears email credentials in a single atomic call)
    - ``email-credentials-check/`` -> ``EmailCredentialCheckEndpoint`` (SMTP smoke test)
    - ``workspace-slug-check/`` -> ``InstanceWorkSpaceAvailabilityCheckEndpoint``
    - ``workspaces/`` -> ``InstanceWorkSpaceEndpoint`` (workspace listing / creation)

Note:
    Several ``path()`` entries intentionally share the route name ``instance-admins``
    as a pre-existing repository convention; route names are preserved verbatim per
    the no-renaming system boundary.
"""

from django.urls import path

from plane.license.api.views import (
    EmailCredentialCheckEndpoint,
    InstanceAdminEndpoint,
    InstanceAdminSignInEndpoint,
    InstanceAdminSignUpEndpoint,
    InstanceConfigurationEndpoint,
    DisableEmailFeatureEndpoint,
    InstanceEndpoint,
    SignUpScreenVisitedEndpoint,
    InstanceAdminUserMeEndpoint,
    InstanceAdminSignOutEndpoint,
    InstanceAdminUserSessionEndpoint,
    InstanceWorkSpaceAvailabilityCheckEndpoint,
    InstanceWorkSpaceEndpoint,
)

urlpatterns = [
    path("", InstanceEndpoint.as_view(), name="instance"),
    path("admins/", InstanceAdminEndpoint.as_view(), name="instance-admins"),
    path("admins/me/", InstanceAdminUserMeEndpoint.as_view(), name="instance-admins"),
    path(
        "admins/session/",
        InstanceAdminUserSessionEndpoint.as_view(),
        name="instance-admin-session",
    ),
    path(
        "admins/sign-out/",
        InstanceAdminSignOutEndpoint.as_view(),
        name="instance-admins",
    ),
    path("admins/<uuid:pk>/", InstanceAdminEndpoint.as_view(), name="instance-admins"),
    path(
        "configurations/",
        InstanceConfigurationEndpoint.as_view(),
        name="instance-configuration",
    ),
    path(
        "configurations/disable-email-feature/",
        DisableEmailFeatureEndpoint.as_view(),
        name="disable-email-configuration",
    ),
    path(
        "admins/sign-in/",
        InstanceAdminSignInEndpoint.as_view(),
        name="instance-admin-sign-in",
    ),
    path(
        "admins/sign-up/",
        InstanceAdminSignUpEndpoint.as_view(),
        name="instance-admin-sign-in",
    ),
    path(
        "admins/sign-up-screen-visited/",
        SignUpScreenVisitedEndpoint.as_view(),
        name="instance-sign-up",
    ),
    path(
        "email-credentials-check/",
        EmailCredentialCheckEndpoint.as_view(),
        name="email-credential-check",
    ),
    path(
        "workspace-slug-check/",
        InstanceWorkSpaceAvailabilityCheckEndpoint.as_view(),
        name="instance-workspace-availability",
    ),
    path("workspaces/", InstanceWorkSpaceEndpoint.as_view(), name="instance-workspace"),
]
