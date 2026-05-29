# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""CSV formula-injection defense.

User-supplied strings starting with ``=``, ``+``, ``-``, ``@``, tab, or CR
are interpreted as formulas by Excel / LibreOffice / Google Sheets when a
CSV is opened — which enables data exfiltration and external-request
attacks. This module prepends a single quote (``'``) to any such value,
disabling formula evaluation without affecting rendered display.

Consumers: :mod:`plane.utils.exporters`, :mod:`plane.bgtasks.export_task`,
and :mod:`plane.bgtasks.analytic_plot_export`.
"""

# CSV utility functions for safe export
# Characters that trigger formula evaluation in spreadsheet applications
_CSV_FORMULA_TRIGGERS = frozenset(("=", "+", "-", "@", "\t", "\r", "\n"))


def sanitize_csv_value(value):
    """Prepend a single quote to ``value`` if it begins with a CSV-injection-dangerous prefix.

    Dangerous prefixes (``=``, ``+``, ``-``, ``@``, tab, CR) cause major
    spreadsheet apps to evaluate the cell as a formula on open. The leading
    quote disables formula evaluation while remaining invisible in the
    rendered cell.

    Non-string values pass through unchanged.
    """
    if isinstance(value, str) and value and value[0] in _CSV_FORMULA_TRIGGERS:
        return "'" + value
    return value


def sanitize_csv_row(row):
    """Apply :func:`sanitize_csv_value` to every cell in a CSV row."""
    return [sanitize_csv_value(v) for v in row]
