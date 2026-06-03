/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the `@plane/ui` modal subsystem.
 *
 * Re-exports:
 *   - `ModalCore` — HeadlessUI-based modal shell (focus trap, Escape-to-close, click-outside-to-close).
 *   - `AlertModalCore` and `TModalVariant` — preset alert/confirmation modal for destructive and confirmation flows.
 *   - `EModalPosition` and `EModalWidth` — shared size/position token enums consumed by both modal variants.
 *
 * Consumers should import from this entry point (or `@plane/ui`) rather than the
 * internal files so the modal directory layout remains an implementation detail.
 */

export * from "./alert-modal";
export * from "./constants";
export * from "./modal-core";
