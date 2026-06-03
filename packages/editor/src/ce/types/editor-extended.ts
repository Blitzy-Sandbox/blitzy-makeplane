/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extension-oriented editor type placeholders for CE.
 *
 * Each type is intentionally `unknown` or `never` in CE to define a stable
 * name registry for editor surfaces that EE may augment. Importing these
 * names in CE consumers preserves a type contract that EE can refine without
 * requiring CE-side changes.
 *
 * Note: `unknown` (any value, unconstrained shape) and `never` (empty set,
 * forbidden) carry different semantics — `never` enables exhaustive switch
 * statements over discriminated unions without `default` branches.
 */

/**
 * Editor-extension option bag placeholder.
 *
 * `unknown` in CE; EE may override to constrain the option shape passed to
 * extension instances.
 */
export type IEditorExtensionOptions = unknown;

/**
 * Extended editor props placeholder.
 *
 * Consumed by `DocumentEditorSideEffectsProps.extendedEditorProps`
 * (`ce/components/document-editor-side-effects.ts`) and similar CE props that
 * accept open-ended editor configuration; also flows through
 * `core/hooks/use-collaborative-editor.ts`, `core/hooks/use-editor.ts`, and
 * `core/hooks/use-title-editor.ts`. `unknown` in CE; EE may override to
 * constrain the shape of these extended props.
 */
export type IEditorPropsExtended = unknown;

/**
 * Extended collaborative-document editor props placeholder.
 *
 * Mirror of `IEditorPropsExtended` for the collaborative document editor
 * variant; intentionally `unknown` in CE for the same EE-override pattern.
 */
export type ICollaborativeDocumentEditorPropsExtended = unknown;

/**
 * Names of extension-provided editor commands.
 *
 * Typed as `never` (not `unknown`) — this means the CE build has zero
 * additional commands beyond those declared by `CORE_EXTENSIONS`. EE may
 * augment by widening this type to a union of command name literals. The
 * `never` discriminator lets type-narrowed switch statements over the union
 * compile to no-ops in CE without explicit `default` branches.
 */
export type TExtendedEditorCommands = never;

/**
 * Additional command-extra-props placeholder.
 *
 * Reserved as an EE override seam for extra props passed alongside extended
 * commands; `unknown` in CE accepts any caller-supplied shape without
 * constraining it at compile time.
 */
export type TExtendedCommandExtraProps = unknown;

/**
 * Extended editor ref API placeholder.
 *
 * Reserved for EE-only ref-exposed methods beyond the core `EditorRefApi`
 * surface; `unknown` in CE because no EE methods are present.
 */
export type TExtendedEditorRefApi = unknown;
