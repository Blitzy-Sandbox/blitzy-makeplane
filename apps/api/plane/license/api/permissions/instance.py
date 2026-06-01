# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF permission class for instance-admin authorization on the license API.

Defines `InstanceAdminPermission`, the default `permission_classes` value on
`plane.license.api.views.base.BaseAPIView` and therefore the authorization
gate for virtually every endpoint in the license API. The class assumes the
`migrator` container has applied the license-app migrations before the first
request reaches this gate — the `Instance` and `InstanceAdmin` tables must
exist for the membership query to succeed.
"""

# Third party imports
from rest_framework.permissions import BasePermission

# Module imports
from plane.license.models import Instance, InstanceAdmin


class InstanceAdminPermission(BasePermission):
    """Permit access only to instance admins of the singleton `Instance`.

    Allows only authenticated users who hold an `InstanceAdmin` membership
    row for the deployment's singleton `Instance` whose `role` value is at
    least 15. Anonymous users are rejected without any DB lookup.

    Predicate: ``InstanceAdmin.objects.filter(role__gte=15,
    instance=Instance.objects.first(), user=request.user).exists()``.

    Singleton assumption: `Instance.objects.first()` returns the
    deployment's lone `Instance` row (there is no multi-tenancy at the
    `Instance` level). If no `Instance` row exists yet (pre-bootstrap),
    the membership filter naturally returns `False` and the gate denies
    access until the first administrator is created.

    Consumer: declared as the default `permission_classes` value on
    `BaseAPIView` in `plane.license.api.views.base`, so virtually every
    license API endpoint delegates to this check. Sufficient for both
    read AND write — does not distinguish HTTP methods; endpoints needing
    finer per-row authorization must layer additional checks on top. The
    check runs per-request, is stateless, and is not cached.
    """

    def has_permission(self, request, view):
        """Return True iff the requesting user is an instance administrator.

        Short-circuits to `False` for anonymous users without touching the
        database. For authenticated users, loads the singleton `Instance`
        via `Instance.objects.first()` and tests for an `InstanceAdmin`
        row with `role__gte=15` for the pair `(instance, request.user)`.
        When no `Instance` row exists yet (pre-bootstrap), the membership
        filter evaluates to `False` and access is denied.
        """
        if request.user.is_anonymous:
            return False

        instance = Instance.objects.first()
        # INTENT UNCLEAR: role >= 15 — verify against InstanceAdmin role enum
        # in models/instance.py (ROLE_CHOICES is currently ((20, "Admin"),)).
        return InstanceAdmin.objects.filter(role__gte=15, instance=instance, user=request.user).exists()
