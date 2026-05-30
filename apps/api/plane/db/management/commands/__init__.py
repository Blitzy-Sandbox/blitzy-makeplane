# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Operator-facing Django management commands for the ``plane`` Django project.

Each sibling module in this package exposes a ``Command`` class that becomes
invokable via ``python manage.py <module_name>`` after Django discovers the
command through its standard ``django.core.management`` discovery mechanism. The
commands cover account activation, password reset, instance and project
membership provisioning, cache flushing, S3/MinIO bucket management, SMTP smoke
testing, container-orchestration startup gating (``wait_for_db``,
``wait_for_migrations``), and a small set of data backfill or repair workflows.
"""
