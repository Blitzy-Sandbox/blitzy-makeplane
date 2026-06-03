# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Re-export facade for the ``apps/api/plane/license/api/views`` package.

Aggregates the public view classes consumed by ``plane.license.urls`` so
that route registrations can import endpoints directly from
``plane.license.api.views``. Adding or renaming an endpoint requires
updating this module to keep the URL router and the implementing
sub-module in sync.
"""

from .instance import InstanceEndpoint, SignUpScreenVisitedEndpoint


from .configuration import (
    EmailCredentialCheckEndpoint,
    InstanceConfigurationEndpoint,
    DisableEmailFeatureEndpoint,
)


from .admin import (
    InstanceAdminEndpoint,
    InstanceAdminSignInEndpoint,
    InstanceAdminSignUpEndpoint,
    InstanceAdminUserMeEndpoint,
    InstanceAdminSignOutEndpoint,
    InstanceAdminUserSessionEndpoint,
)


from .workspace import (
    InstanceWorkSpaceAvailabilityCheckEndpoint,
    InstanceWorkSpaceEndpoint,
)
