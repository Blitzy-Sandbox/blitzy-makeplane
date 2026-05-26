/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * EE-facing barrel for editor extensions.
 *
 * This module is the enterprise-edition entrypoint that downstream
 * consumers target when importing the editor extensions API surface.
 * It currently re-exports every named symbol from `src/ce/extensions`
 * (CE = community edition) verbatim via wildcard re-export, with no
 * local logic, no curated wrapper layer, and no EE-specific overrides
 * at this point in the package history.
 *
 * The facade pattern is a deliberate package-design choice: CE remains
 * the authoritative owner of extension assemblers, slash-command
 * helpers, and the core extension composition surface, while the EE
 * namespace exposes a stable import path that enterprise builds and
 * forward-compatible enterprise overrides can attach to without
 * disturbing consumer imports. Any addition, removal, or rename in
 * `ce/extensions` is reflected here automatically.
 *
 * Future enterprise-only extensions would be introduced in this file
 * (or in sibling modules added under this folder) to override or
 * augment CE-exported names; until then the EE and CE extension
 * surfaces are identical by construction.
 */

export * from "src/ce/extensions";
