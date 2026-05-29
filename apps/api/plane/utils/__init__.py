# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""``plane.utils`` -- cross-cutting utility package.

A flat namespace of helpers used throughout the Plane API. This is a LEAF
package: ``plane.app.views``, ``plane.bgtasks``, ``plane.authentication``,
``plane.api``, ``plane.middleware``, and ``plane.settings`` all depend on
it, so it must NEVER import from any of those packages (no upward imports).

Submodule index by concern:

  Pagination & filtering:
    - :mod:`paginator`           -- grouped/sub-grouped cursor paginators.
    - :mod:`global_paginator`    -- flat keyset paginator for workspace-wide
      lists.
    - :mod:`grouper`             -- issue queryset annotation + grouping.
    - :mod:`issue_filters`       -- issue list query-parameter resolvers.
    - :mod:`order_queryset`      -- canonical priority/state orderings.
    - :mod:`issue_search`        -- case-insensitive issue search.

  Analytics & charts:
    - :mod:`analytics_plot`      -- generic + burndown chart payloads.
    - :mod:`build_chart`         -- v2 analytics axis resolvers.
    - :mod:`date_utils`          -- analytics period -> date range.
    - :mod:`analytics_events`    -- event-name constants.

  Issue domain:
    - :mod:`cycle_transfer_issues` -- atomic cycle-to-cycle issue transfer.
    - :mod:`issue_relation_mapper` -- bidirectional relation token mapping.

  HTML, Markdown & email:
    - :mod:`content_validator`   -- nh3 HTML sanitizer + binary validator.
    - :mod:`html_processor`      -- plain-text HTML stripping.
    - :mod:`markdown`            -- shared mistune parser instance.
    - :mod:`email`               -- HTML-to-plain-text email helper
      (commercial license; see file header).

  URL / IP / path safety:
    - :mod:`url`                 -- URL regex + parsing.
    - :mod:`ip_address`          -- SSRF protection + client IP extraction.
    - :mod:`path_validator`      -- filename + open-redirect protection.
    - :mod:`host`                -- request -> base URL + client IP.

  Caching:
    - :mod:`cache`               -- DRF response caching decorators
      (Redis-backed; per AAP Sec. 0.2.2 Redis is caching/session only).

  Time:
    - :mod:`timezone_converter`  -- UTC <-> project-timezone conversion.

  Identifiers:
    - :mod:`uuid`                -- UUIDv4 validation + integer hashing.

  Logging & exceptions:
    - :mod:`logging`             -- size+time rotating log handler.
    - :mod:`exception_logger`    -- centralized exception logging.

  Miscellaneous:
    - :mod:`color`               -- random hex color generator.
    - :mod:`csv_utils`           -- CSV formula-injection sanitizer.
    - :mod:`imports`             -- submodule auto-import for app boot.
    - :mod:`constants`           -- reserved workspace slugs.
    - :mod:`error_codes`         -- canonical numeric API error codes.
    - :mod:`telemetry`           -- OpenTelemetry tracer bootstrap.

  Subpackages:
    - :mod:`instance_config_variables` -- instance config metadata.
    - :mod:`permissions`         -- permission helper utilities.
    - :mod:`porters`             -- generic export/import porters.
    - :mod:`filters`             -- DRF filterset adapters and migrations.
    - :mod:`openapi`             -- drf-spectacular schema extensions
      (gated by ``settings.ENABLE_DRF_SPECTACULAR``).
    - :mod:`exporters`           -- data export pipeline helpers.
    - :mod:`core`                -- mixins and DB routing primitives.
"""
