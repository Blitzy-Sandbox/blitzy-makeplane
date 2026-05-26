/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * EE-facing barrel for editor TypeScript type contracts.
 *
 * This module is the enterprise-edition entrypoint that downstream
 * consumers target when importing the editor type surface — issue
 * embedding callback contracts, extended editor props/commands/ref
 * APIs, file-handler aliases, storage-key aliases, and placeholder
 * slots for additional assets and dropbar extensions. Every named
 * export currently flows verbatim from `src/ce/types` (CE = community
 * edition) via wildcard re-export, with no local interface, type
 * alias, enum, or const declared in this barrel.
 *
 * The facade pattern is a deliberate package-design choice: CE
 * remains the authoritative owner of every editor type contract,
 * while the EE namespace exposes a stable import path that enterprise
 * builds and forward-compatible enterprise overrides can attach to
 * without disturbing consumer imports. Any addition, removal, or
 * rename in `ce/types` is automatically reflected through this
 * barrel, which keeps the enterprise and community type surfaces
 * aligned by construction and supports consistent import paths for
 * consumers and tooling.
 *
 * Future enterprise-only types would be introduced in this file (or
 * in sibling modules added under this folder) to override or augment
 * CE-exported names; until then the EE and CE type surfaces are
 * identical.
 */
export * from "src/ce/types";
