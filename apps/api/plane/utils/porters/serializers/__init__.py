# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Porter-layer DRF serializer package for export workflows.

This package is the public serializer surface re-exported through
:mod:`plane.utils.porters` for callers that build export payloads. It
ships :class:`IssueExportSerializer` as the stable public import path:

    from plane.utils.porters.serializers import IssueExportSerializer

The serializer is consumed synchronously by
:class:`plane.utils.porters.exporter.DataExporter` and by the Celery
export task :mod:`plane.bgtasks.export_task` (broker: RabbitMQ — see
AAP §0.2.2 architectural context); this package itself performs no
queueing or caching.
"""

from .issue import IssueExportSerializer

__all__ = [
    # Export Serializers
    "IssueExportSerializer",
]
