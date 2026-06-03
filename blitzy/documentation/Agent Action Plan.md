# Technical Specification

# 0. Agent Action Plan

## 0.1 Executive Summary of Intent

### 0.1.1 Core Documentation Objective

Based on the provided requirements, the Blitzy platform understands that the documentation objective is to produce comprehensive **inline and module-level documentation** across the Plane monorepo so that any engineer can understand the purpose, inputs, outputs, and behavioral contracts of every documented component **without reading the implementation**. The deliverable is a set of in-place source-file edits that add docstrings (Python) and JSDoc blocks (TypeScript) to existing files. No new documentation site, no new dependencies, and no behavioral changes are introduced.

- **Request category:** Fix documentation gaps + Improve documentation coverage
- **Documentation type:** Inline code documentation — Python PEP 257 docstrings and TypeScript/JavaScript JSDoc `/** … */` blocks embedded directly in source files
- **Output format:** Modifications to existing `.py`, `.ts`, and `.tsx` source files; no Markdown, MDX, RST, mkdocs/docusaurus/sphinx, or typedoc artifacts are created

### 0.1.2 Surface Areas in Scope

The documentation work spans four critical directives executed in the priority order specified by the user — apps/api → apps/web (stores + components) → packages/ → apps/live:

| Directive | Surface | Artifacts | Repository Locations |
|-----------|---------|-----------|----------------------|
| 1 | `apps/api` Django backend | ViewSets, serializers, models, Celery tasks, permission classes | `apps/api/plane/app/views/**`, `apps/api/plane/app/serializers/`, `apps/api/plane/db/models/`, `apps/api/plane/bgtasks/`, `apps/api/plane/app/permissions/` |
| 2 | `apps/web` MobX stores and complex components | Store files + components in `issues/` and `cycles/` | `apps/web/core/store/**/*.store.ts`, `apps/web/core/components/issues/**`, `apps/web/core/components/cycles/**` |
| 3 | Shared packages | `@plane/ui`, `@plane/editor`, `@plane/types`, `@plane/constants` public API exports | `packages/ui/src/`, `packages/editor/src/`, `packages/types/src/`, `packages/constants/src/` |
| 4 | `apps/live` real-time collaboration layer | HocusPocus server, event handlers, document sync, controllers, services, extensions | `apps/live/src/` |

### 0.1.3 Behavioral Contracts to Capture

Per the directives, the following behavioral facets must be captured in documentation across the four surfaces — these define the contract that downstream engineers will rely on:

- **For each Django ViewSet:** HTTP methods + URL patterns handled, request body schema (field names, types, required/optional), response shape, permission classes applied, `get_queryset` filter logic where overridden
- **For each DRF serializer:** `validate_*` method semantics, `to_representation` overrides, write-only/read-only/computed fields
- **For each Django model:** business purpose (one sentence), valid values for `CharField` choices, expected JSON schema for `JSONField`, custom `Manager` and `QuerySet` methods
- **For each Celery task:** trigger (signal/schedule/explicit call site), side effects (DB writes, emails, webhooks, cache invalidation), idempotency
- **For each MobX store:** observable state slice with types, actions (name + params + mutation/async side effects), computed values with recomputation conditions, consumer components/stores
- **For each component in `issues/` / `cycles/`:** rendered purpose, required + optional props, MobX stores read, side effects (mutations, navigations, API calls)
- **For each `@plane/ui` component:** purpose, props (name + type + required/optional + default), accessibility considerations (ARIA roles, keyboard behavior) when present
- **For `@plane/editor`:** full public API surface — exposed/overridden/hidden TipTap extension behaviors, expected document schema
- **For each `@plane/types` export:** entity/concept modeled, non-obvious semantics (enums, union discriminants, optional fields with behavioral implications)
- **For each `@plane/constants` export:** consumer location, what the value controls (group-level comments acceptable for related sets)
- **For `apps/live` HocusPocus:** registered extensions, authentication hook, document namespacing (workspace/project/issue), every `onConnect`/`onDisconnect`/`onChange`/custom hook with triggers + state read/write + persistence side effects, Y.js document lifecycle (init → merge → persist) including debounce/throttle logic

### 0.1.4 Inferred Documentation Needs

Based on repository analysis, the Blitzy platform infers the following beyond the literal directive text:

- **Module-level Python docstrings:** PEP 257 conformance requires docstrings at the *top of each module file* (immediately after the encoding/copyright header), not just on classes/methods. Validation gate 1 (`pydocstyle --convention=pep257`) will otherwise flag `D100: Missing docstring in public module` across `apps/api/plane/`.
- **Permission classes:** Directive 1 success criterion "Zero undocumented permission classes" is enforced against the 5 files under `apps/api/plane/app/permissions/` (`base.py`, `page.py`, `project.py`, `workspace.py`) plus any inline permission definitions elsewhere in `plane/`.
- **MobX `computedFn` documentation:** The `cycle.store.ts` and similar stores import `computedFn` from `mobx-utils` for parameterized derived state — these are computed values per Directive 2's "For computed values, document what they derive and under what conditions they recompute" requirement.
- **HocusPocus extension composition:** `apps/live/src/extensions/` contains five extensions (database, force-close-handler, logger, redis, title-sync) whose registration order affects behavior. The server-level JSDoc should enumerate extensions and their composition order.
- **TipTap extension treatment:** Per Directive 3, `@plane/editor` documentation must describe which TipTap extension behaviors are exposed, overridden, or intentionally hidden. The 27+ `@tiptap/extension-*` dependencies listed in `packages/editor/package.json` form the substrate to document at the wrapper level.
- **Re-export documentation:** `packages/{ui, types, constants}` all use star re-exports (`export * from "./..."`) in their `src/index.ts`. The "public API surface" therefore includes every symbol exported transitively, not just the symbols named in `index.ts`.

## 0.2 Special Instructions and Constraints

### 0.2.1 Directive-Level Instructions (Preserved Verbatim from User Input)

The user provided four critical directives. They are reproduced below with no paraphrasing, preserving the exact wording, emphasis, and success criteria.

**USER-PROVIDED DIRECTIVE 1 — Document `apps/api` (Django backend):**

> Execute documentation of all Django REST Framework ViewSets, serializers, models, and Celery tasks in `apps/api`.
>
> **ViewSets:** Each ViewSet docstring MUST include: HTTP methods and URL patterns handled, request body schema (field names, types, required/optional), response shape, and permission classes applied. If a ViewSet overrides `get_queryset`, document the filter logic applied.
>
> **Serializers:** Document non-obvious `validate_*` methods and `to_representation` overrides. Note any fields that are write-only, read-only, or computed at serialization time.
>
> **Models:** Document every model with its business purpose (one sentence). For non-obvious field choices — `CharField` with choices, `JSONField` with an expected schema — document the valid values or expected structure. Document all custom `Manager` and `QuerySet` methods.
>
> **Celery tasks:** Each task docstring MUST include: what triggers the task (signal, schedule, or explicit call site), what side effects it produces (DB writes, emails, webhooks, cache invalidation), and whether it is idempotent.
>
> **Success criteria:** Every public ViewSet, serializer, model, and Celery task has a docstring. Zero undocumented permission classes.
>
> **Validation gate 1:** Confirm zero `pydocstyle` errors on `apps/api` at `--convention=pep257` after documentation is applied.

**USER-PROVIDED DIRECTIVE 2 — Document `apps/web` (MobX stores and complex components):**

> Execute documentation of MobX stores in `apps/web/core/stores/` and complex components in `apps/web/core/components/issues/` and `apps/web/core/components/cycles/`.
>
> **MobX stores:** Each store file MUST have a module-level JSDoc block documenting: the slice of state it owns (observable properties with types), all actions (name, parameters, what state mutation or async side effect each triggers), and the components or other stores that consume it. For computed values, document what they derive and under what conditions they recompute.
>
> **Components (`issues/`, `cycles/`):** Each component file MUST have a module-level JSDoc block documenting: its rendered purpose (one sentence), required and optional props with types, which MobX stores it reads from, and any side effects it triggers (mutations, navigations, API calls). Inline comments are required only on non-obvious conditional rendering logic, derived state calculations, or imperative DOM interactions.
>
> **Success criteria:** Every store file and every component file in the two named directories has a module-level JSDoc block. All observable properties and actions are documented.
>
> **Validation gate 2:** Confirm `tsc --noEmit` passes with no new type errors introduced by JSDoc additions.

**USER-PROVIDED DIRECTIVE 3 — Document `packages/` (shared package APIs):**

> Execute documentation of all exported functions, types, components, and constants in `@plane/ui`, `@plane/editor`, `@plane/types`, and `@plane/constants`.
>
> `@plane/ui`: Every exported component MUST have a JSDoc block with: purpose, all props (name, type, required/optional, default if applicable), and any accessibility considerations (aria roles, keyboard behavior) if the component implements them.
>
> `@plane/editor`: Document the full public API surface — exported components, hooks, and configuration options. Because this wraps TipTap, document which TipTap extension behaviors are exposed, overridden, or intentionally hidden. Document the expected document schema if a specific structure is required.
>
> `@plane/types`: Every exported interface and type alias MUST have a JSDoc block stating what entity or concept it models and noting any fields with non-obvious semantics (enums, union discriminants, optional fields with behavioral implications).
>
> `@plane/constants`: Every exported constant or enum MUST have a JSDoc comment stating where it is consumed and what it controls. Group-level comments are acceptable for closely related constant sets.
>
> **Success criteria:** Every export in each package's public API surface (`index.ts` or declared `exports` in `package.json`) is documented. Zero undocumented exported types.
>
> **Validation gate 3:** Confirm `tsc --noEmit` passes across all four packages after documentation is applied.

**USER-PROVIDED DIRECTIVE 4 — Document `apps/live` (real-time collaboration layer):**

> Execute documentation of the HocusPocus WebSocket server, event handlers, and document sync logic in `apps/live`.
>
> **HocusPocus server setup:** Document the server configuration — which extensions are registered, what authentication hook is applied, and how document namespacing maps to Plane entities (workspace, project, issue).
>
> **Event handlers:** Each `onConnect`, `onDisconnect`, `onChange`, and any custom extension hook MUST have a JSDoc block documenting: what triggers it, what state it reads, what it writes or emits, and any persistence side effects (DB writes, API calls to `apps/api`).
>
> **Document sync logic:** Document how Y.js document state is initialized, merged, and persisted. Note the conflict resolution strategy if documented in the implementation. Document any debounce or throttle logic on persistence writes.
>
> **Success criteria:** Every exported function, class, and event handler in `apps/live` is documented. The document lifecycle (connect → edit → persist → disconnect) is traceable through inline documentation without reading the implementation.
>
> **Validation gate 4:** Confirm no new TypeScript errors introduced. Confirm the server starts without error after documentation changes.

### 0.2.2 USER-PROVIDED ARCHITECTURAL CONTEXT (must inform every documentation decision, verbatim)

> - **Monorepo structure:** TypeScript frontend (`apps/web`, `apps/live`) + Python backend (`apps/api`) + shared packages (`packages/`)
> - **Frontend state:** MobX exclusively — stores injected via React context, not Redux. Document stores as the source of truth for component behavior.
> - `@plane/editor`: Internal TipTap wrapper — treat as first-party code. Document its API surface as owned code, not a third-party abstraction.
> - **Startup order:** `migrator` container runs Django migrations before API services start. Note this in any module that depends on schema state at boot.
> - **Async infrastructure:** Celery workers consume tasks from RabbitMQ. Redis = caching and session only. Document this distinction wherever task queuing or caching is involved.
> - **Frontend env vars:** `NEXT_PUBLIC_*` vars are baked in at build time. Flag this in any frontend config file where runtime vs. build-time resolution matters.

### 0.2.3 USER-PROVIDED DOCUMENTATION STANDARDS (verbatim)

> - **TypeScript/JavaScript:** JSDoc (`/** … */`) on all exported functions, classes, interfaces, and non-trivial constants
> - **Python/Django:** PEP 257 docstrings on all classes, methods, and module-level definitions
> - **Comment philosophy:** Comments explain WHY, not WHAT. No narration of self-evident code.
> - **Comment length:** Max 1–2 sentences per inline comment block. No verbose prose.
> - **No markdown boilerplate** beyond section headers and parameter tables in module READMEs
> - **Ambiguity handling:** Where intent cannot be inferred from implementation + naming, flag with `# INTENT UNCLEAR: <observed behavior>` (Python) or `// INTENT UNCLEAR: <observed behavior>` (TS) — do not guess

### 0.2.4 USER-PROVIDED SYSTEM BOUNDARIES (verbatim)

> **MUST remain unchanged:**
> - All logic, imports, component structure, and runtime behavior across all apps and packages
> - No `.env` files created or modified
> - No new dependencies added to any `package.json` or `requirements.txt`
> - No refactoring, renaming, or restructuring of any kind
>
> **OUT OF SCOPE:**
> - `apps/space`, `apps/app`, or any apps not named above
> - Auto-generated files (migrations, compiled outputs, lock files)
> - Third-party vendored code
> - Test files (`.spec.ts`, `test_*.py`)
>
> **Ambiguity protocol:** Flag, do not invent. Use the designated flag format and continue.

### 0.2.5 USER-PROVIDED IMPLEMENTATION SEQUENCE (verbatim)

> Execute in priority order. Complete and validate each directive before proceeding to the next.
>
> 1. `apps/api` (Directive 1) — highest consumer impact
> 2. `apps/web` stores and components (Directive 2)
> 3. `packages/` shared APIs (Directive 3)
> 4. `apps/live` real-time layer (Directive 4)

### 0.2.6 Conflicts Identified Between Prompt and Repository Reality

Repository analysis surfaced three discrepancies between the user prompt and observable codebase facts. The user prompt is authoritative for INTENT; the repository is authoritative for PATHS. Resolutions below preserve user intent while binding to real files.

| # | User prompt asserts | Repository fact | Resolution |
|---|---------------------|-----------------|------------|
| C1 | `apps/web/core/stores/` (plural) for MobX stores | Actual path is `apps/web/core/store/` (singular); contains 75 `*.store.ts` files [apps/web/core/store/cycle.store.ts:L1] | Apply Directive 2 to `apps/web/core/store/` (singular). User's intent — "MobX stores" — is bound to the correct path. |
| C2 | `apps/app` listed as out of scope | No `apps/app` directory exists; siblings are `apps/admin`, `apps/api`, `apps/live`, `apps/proxy`, `apps/space`, `apps/web` | Treat `apps/admin` and `apps/proxy` as ALSO out of scope per the user's "or any apps not named above" clause. Only the four directive-targeted apps are in scope. |
| C3 | "Frontend env vars: `NEXT_PUBLIC_*` vars are baked in at build time" | Current `apps/web`, `apps/admin`, `apps/space` are React Router v7 + Vite (per `apps/web/react-router.config.ts` and `apps/web/vite.config.ts`); browser-bundled vars use the `VITE_*` prefix, not `NEXT_PUBLIC_*` | Documentation flags the build-time-baked nature of `VITE_*` env vars where applicable. The user's stated semantic (compile-time vs. runtime resolution) is preserved; the literal prefix is adjusted to repository reality. A `// INTENT UNCLEAR` flag is unnecessary because the build-time vs. runtime distinction is well-evidenced. |
| C4 | Validation gate 1 specifies `pydocstyle --convention=pep257` | `apps/api/pyproject.toml` configures `[tool.ruff.lint.pydocstyle] convention = "google"` for the ruff linter; `pydocstyle` itself is NOT installed in any `requirements/*.txt` | Run standalone `pydocstyle` (e.g., via `pipx run pydocstyle==6.3.0 --convention=pep257 apps/api/plane/`) as a transient validation step. Do NOT modify `pyproject.toml` (system boundary: no refactoring/restructuring). Do NOT add `pydocstyle` to `requirements/*.txt` (system boundary: no new dependencies). |

### 0.2.7 Examples and Templates (USER PROVIDED — preserved exactly)

The user did not provide explicit documentation examples or templates. The user-specified flag format is preserved exactly:

```text
USER-PROVIDED FLAG FORMAT (verbatim):
# INTENT UNCLEAR: <observed behavior>      (Python)

// INTENT UNCLEAR: <observed behavior>     (TypeScript)
```

## 0.3 Technical Interpretation and Inferred Documentation Needs

### 0.3.1 Translation of Requirements into Documentation Actions

These documentation requirements translate to the following technical documentation strategy:

| User Requirement | Technical Documentation Action |
|------------------|--------------------------------|
| "Document all DRF ViewSets in apps/api" | Add PEP 257 module docstring at the top of each file in `apps/api/plane/app/views/`, then a class-level docstring on each `ViewSet`/`BaseViewSet`/`APIView` subclass listing HTTP methods, URL pattern (from `apps/api/plane/app/urls/*.py`), request body schema (derived from associated serializer), response shape, and `permission_classes` attribute value. Where `get_queryset` is overridden, add a method-level docstring describing the filter logic. |
| "Document all serializers" | Add module docstrings; add class docstrings on each `Serializer`/`ModelSerializer`/`BaseSerializer` subclass. Add method docstrings on each `validate_*`, `validate(self, data)`, `to_representation`, and `to_internal_value` method. Inline annotate write-only/read-only/computed fields via Field-level docstrings only where the semantic is non-obvious. |
| "Document all models" | Add module docstrings; add class docstrings stating the business purpose in one sentence. For each `CharField(choices=…)` add a field-level inline comment enumerating valid values. For each `JSONField` add a field-level inline comment with an expected schema shape. Add docstrings on all custom `Manager`/`QuerySet` methods. |
| "Document all Celery tasks" | For each `@shared_task`-decorated function in `apps/api/plane/bgtasks/*.py`, add a docstring listing the trigger (caller call site, Beat schedule entry, or signal handler), every side effect (DB write tables, email destinations, webhook fan-out, cache keys invalidated), and idempotency assessment. Cross-reference the `CELERY_BEAT_SCHEDULE` in `apps/api/plane/celery.py` for scheduled tasks. |
| "Document all MobX stores" | Prepend a module-level JSDoc block to each `*.store.ts` file naming: (a) the state slice with observable property names and types, (b) actions with name/params/effects, (c) computed values with derivation + recomputation conditions, (d) consumer components and other stores that read from it. |
| "Document complex components in issues/, cycles/" | Prepend module-level JSDoc to each `.tsx` file in `apps/web/core/components/{issues, cycles}/` documenting rendered purpose, props (required/optional with types), MobX stores consumed via `useMobxStore` / `useContext`, and side effects (mutations, navigations, API calls). Add inline JSDoc only on non-obvious conditional rendering, derived state, or imperative DOM operations. |
| "Document @plane/ui components" | Add JSDoc above each exported React component declaration in `packages/ui/src/**/*.tsx` describing purpose, every prop, and ARIA/keyboard behavior where implemented. |
| "Document @plane/editor public API" | Add JSDoc to each symbol named in `packages/editor/src/index.ts` (the four editor components, constants, helpers, types, `TrailingNode`). Document which TipTap extensions from `packages/editor/package.json` are wired into the editor configurations. Document the Y.js + ProseMirror document schema expected by `CollaborativeDocumentEditorWithRef`. |
| "Document @plane/types exports" | Add JSDoc above each `export interface`/`export type` declaration across `packages/types/src/**/*.ts` stating the modeled entity, its consumers, and the semantics of non-obvious fields. |
| "Document @plane/constants exports" | Add JSDoc above each `export const`/`export enum` declaration across `packages/constants/src/**/*.ts`. For tightly coupled groups (e.g., color palette constants), a single group-level JSDoc above the group is acceptable. |
| "Document apps/live HocusPocus server" | Add module docstrings + class JSDoc on `HocusPocusServerManager` in `apps/live/src/hocuspocus.ts`, `Server` in `apps/live/src/server.ts`, and every controller, service, extension, schema, and lib module. Add JSDoc to `onAuthenticate`, `onStateless`, every Hocuspocus event hook used, and the Express controller decorators consumed from `@plane/decorators`. |

### 0.3.2 Inferred Documentation Needs Beyond Literal Directives

Based on code analysis and the user's "Documentation Standards" (which mandate PEP 257 conformance and JSDoc on all exported symbols), the following are implicit but required:

- **Module-level docstrings for ALL Python files in `apps/api/plane/`** — PEP 257 rule `D100: Missing docstring in public module` will otherwise fail validation gate 1. This expands the file set beyond the literal directive (ViewSets/serializers/models/tasks) to include `apps/api/plane/authentication/`, `apps/api/plane/middleware/`, `apps/api/plane/utils/`, `apps/api/plane/settings/`, `apps/api/plane/license/`, `apps/api/plane/space/`, `apps/api/plane/analytics/`, `apps/api/plane/throttles/`, and `apps/api/plane/api/` (external API surface).
- **Public function docstrings for all Python functions** — PEP 257 rule `D103: Missing docstring in public function` covers helper utilities; required for validation gate 1.
- **Public class docstrings for all Python classes** — PEP 257 rule `D101: Missing docstring in public class` extends beyond ViewSets/serializers/models to include permission classes (`apps/api/plane/app/permissions/`), throttle classes, middleware classes, manager classes, and mixin classes.
- **Method docstrings for nontrivial public methods** — PEP 257 rule `D102` covers public methods; for ViewSets this means documenting the `list`/`create`/`retrieve`/`update`/`destroy` overrides and the `get_queryset`/`get_serializer_class`/`perform_create` overrides.
- **JSDoc on exported helpers from `packages/editor/src/helpers/`** — `packages/editor/src/index.ts` re-exports `* from "@/helpers/common"` and `* from "@/helpers/yjs-utils"`; all symbols transitively re-exported are part of the public API surface per Directive 3.
- **Constants groupings:** `packages/constants/src/index.ts` star-re-exports 48 sub-modules. Each module's exported constants must be documented; group-level JSDoc is allowed per the directive for tightly coupled sets (e.g., color tokens, icon enums).
- **Type exports from `packages/types/src/`:** 95 non-index `.ts` files contain `export interface`/`export type` declarations; each must carry JSDoc.
- **HocusPocus extension lifecycle:** The five extensions in `apps/live/src/extensions/` (`database.ts`, `force-close-handler.ts`, `logger.ts`, `redis.ts`, `title-sync.ts`) each register multiple hooks. Documentation must capture each hook's trigger + state read + state write + persistence side effects per Directive 4.
- **Y.js document sync details:** `apps/live/src/extensions/database.ts` implements the 10-second debounce + HTML→binary backfill (per tech spec §5.2.5). The JSDoc must capture this debounce constant and the conflict resolution strategy (Yjs CRDT auto-merge with no explicit resolution callback).
- **Frontend build-time vs. runtime env var distinction:** Per the user's architectural context, any frontend config file that resolves env vars must be flagged. In this codebase, that means flagging `apps/web/vite.config.ts` and `apps/web/app/` provider files where `import.meta.env.VITE_*` is read. The user's term `NEXT_PUBLIC_*` is bound to the repository's `VITE_*` per conflict C3 in §0.2.6.
- **Celery vs. Redis distinction:** Per the user's architectural context, every module that touches Celery (`@shared_task`, `.delay()`, `.apply_async()`) must clarify "Celery via RabbitMQ" in its docstring; every module that touches Redis must clarify "Redis: caching and session only" — preventing future engineers from conflating queue and cache semantics.
- **`migrator` startup dependency:** Per the architectural context, modules that read schema state at module-import time (settings overlays, app `ready()` hooks, signal connections) must reference the migrator-blocking startup contract.

### 0.3.3 Validation Strategy

Each directive maps to one validation gate; the gates are non-negotiable acceptance criteria.

| Gate | Command | Pass Condition | Notes |
|------|---------|----------------|-------|
| 1 | `pydocstyle --convention=pep257 apps/api/plane/` | Zero errors | Run via `pipx run pydocstyle==6.3.0 …` or ephemeral venv — do NOT install pydocstyle into `apps/api/requirements/*.txt` (system boundary). Exclude `apps/api/plane/db/migrations/` from the run. |
| 2 | `pnpm --filter=web check:types` (= `tsc --noEmit`) from repo root | Same number of errors as pre-change baseline | JSDoc additions must not introduce type-incompatible `@param`/`@returns`/`@type` annotations. |
| 3 | `pnpm --filter=@plane/ui --filter=@plane/editor --filter=@plane/types --filter=@plane/constants check:types` | Same number of errors as pre-change baseline | Each package's own `tsc --noEmit` is wired into its `check:types` script. |
| 4 | `pnpm --filter=live check:types` + `pnpm --filter=live start` healthcheck | No new TS errors AND server reaches READY state | The startup smoke test confirms `LIVE_SERVER_SECRET_KEY` env handling and Redis PING are unaffected by JSDoc additions. |

## 0.4 Documentation Discovery and Analysis

### 0.4.1 Existing Documentation Infrastructure Assessment

Repository analysis reveals a sparsely instrumented documentation infrastructure with minimal in-code documentation and no published documentation site.

| Surface | Tool / Artifact | Status | Path |
|---------|-----------------|--------|------|
| Repository root README | Markdown overview | Present | `README.md` |
| Linting guide | Standalone markdown reference | Present | `docs/linting.md` |
| Agent development guide | Internal contributor doc | Present | `AGENTS.md` |
| Contribution guide | Standalone markdown | Present | `CONTRIBUTING.md` |
| Code of conduct, security policy | Standalone markdown | Present | `CODE_OF_CONDUCT.md`, `SECURITY.md` |
| API documentation | DRF Spectacular schema generator | Conditional (`ENABLE_DRF_SPECTACULAR` env flag) — package `drf-spectacular 0.28.0` listed in `apps/api/requirements/base.txt` | `apps/api/plane/utils/openapi/README.md` |
| Test suite documentation | Standalone markdown | Present | `apps/api/plane/tests/README.md`, `apps/api/plane/tests/TESTING_GUIDE.md` |
| Exporters documentation | Standalone markdown | Present | `apps/api/plane/utils/exporters/README.md` |
| Package READMEs | Standalone markdown per package | Present for 3 of 16 packages | `packages/ui/README.md`, `packages/logger/README.md`, `packages/decorators/README.md`; `packages/editor/Readme.md` |
| Component visual documentation | Storybook `9.1.19` + `@chromatic-com/storybook ^1.4.0` for visual regression | Present for `@plane/ui` and `@plane/propel` | `packages/ui/.storybook/`, `packages/propel/.storybook/` |
| Deployment guides | Per-deployment markdown | Present | `deployments/aio/community/README.md`, `deployments/cli/community/README.md`, `deployments/kubernetes/community/README.md` |
| Documentation generator (static site) | NONE | Not present — no `mkdocs.yml`, `docusaurus.config.js`, `sphinx conf.py`, or `typedoc.json` found |  |
| JSDoc generator | NONE configured (TypeScript itself parses JSDoc for `tsc --noEmit` purposes) |  |  |
| Python docstring style enforcer | `ruff` configured with `[tool.ruff.lint.pydocstyle] convention = "google"` | Conflicts with user directive (see §0.2.6 C4) | `apps/api/pyproject.toml` line 70 |
| Standalone `pydocstyle` package | NOT installed in any `apps/api/requirements/*.txt` | Required by validation gate 1; must be invoked transiently |  |

### 0.4.2 Existing Inline Documentation Coverage Baseline

Coverage snapshot taken before any documentation work:

- **`apps/api/plane/app/views/`** — 1 of 59 view files contains any docstring (1.7% baseline); most files have only `# Copyright ...` SPDX headers
- **`apps/web/core/store/`** — 18 of 18 top-level `*.store.ts` files have an SPDX copyright `/** */` header but ZERO have a module-level JSDoc block describing the store's state slice, actions, or consumers (0% baseline for the required documentation)
- **`apps/web/core/components/issues/`** and **`/cycles/`** — copyright headers present; module-level JSDoc for purpose/props/stores consumed: 0% baseline
- **`packages/{ui, editor, types, constants}/src/`** — SPDX copyright `/** */` headers ubiquitous; JSDoc on individual export sites: present sporadically (e.g., `HocusPocusServerManager.getInstance` in `apps/live/src/hocuspocus.ts` carries a one-line JSDoc), but no systematic coverage
- **`apps/live/src/`** — copyright headers present; module-level documentation: absent across all 43 source files

### 0.4.3 Repository Code Analysis for Documentation

Search patterns used and findings:

| Surface | Search Pattern | Result |
|---------|---------------|--------|
| Django ViewSets | `class .* (ModelViewSet | BaseViewSet | APIView | GenericAPIView | ListAPIView | ...) ` under `apps/api/plane/app/views/` | 57 ViewSet definitions across 59 files |
| Django serializers | `class .*Serializer` under `apps/api/plane/app/serializers/` | 21 files containing serializer class definitions |
| Django models | `class .*Model` under `apps/api/plane/db/models/` | 32 model files (excluding `__init__.py`, mixins, and `integration/`) |
| Celery tasks | `@shared_task` decorators under `apps/api/plane/bgtasks/` | 32 task files (32 `*_task.py` modules) |
| Permission classes | `class .*Permission` under `apps/api/plane/app/permissions/` | 5 permission files (`base.py`, `page.py`, `project.py`, `workspace.py`, plus `__init__.py`) |
| MobX stores | `apps/web/core/store/**/*.store.ts` glob | 75 store files (singular `store/`, not plural `stores/`) |
| Issues components | `apps/web/core/components/issues/**/*.tsx` glob | 318 component files |
| Cycles components | `apps/web/core/components/cycles/**/*.tsx` glob | 42 component files |
| @plane/ui exports | star re-exports in `packages/ui/src/index.ts` | 33 sub-modules star-re-exported; 78 `.tsx` files total under `packages/ui/src/` |
| @plane/editor exports | named + star re-exports in `packages/editor/src/index.ts` | 4 editor components + helpers + types + constants + TrailingNode; 225 source files total |
| @plane/types exports | files under `packages/types/src/` | 116 `.ts` files (95 non-index) |
| @plane/constants exports | files under `packages/constants/src/` | 56 `.ts` files (48 non-index) |
| apps/live source | files under `apps/live/src/` | 43 TypeScript source files (controllers, extensions, services, lib, schema, types, utils) |

### 0.4.4 Module Inventory by Directive

The table below maps each documentation directive to the concrete source-file inventory the Blitzy platform will document. Counts exclude `__init__.py`, migrations, `dist/`, lock files, and test files per the user's "OUT OF SCOPE" rules.

| Directive | Inventory | File Count | Representative Paths |
|-----------|-----------|------------|----------------------|
| 1 — `apps/api` ViewSets | `apps/api/plane/app/views/**/*.py` | 59 files (57 ViewSet classes) | `views/issue/comment.py`, `views/cycle/base.py`, `views/page/version.py`, `views/asset/v2.py`, `views/workspace/member.py` |
| 1 — `apps/api` Serializers | `apps/api/plane/app/serializers/*.py` | 21 files | `serializers/issue.py`, `serializers/cycle.py`, `serializers/page.py`, `serializers/asset.py`, `serializers/notification.py` |
| 1 — `apps/api` Models | `apps/api/plane/db/models/*.py` | 32 files | `db/models/issue.py`, `db/models/cycle.py`, `db/models/page.py`, `db/models/notification.py`, `db/models/workspace.py` |
| 1 — `apps/api` Celery tasks | `apps/api/plane/bgtasks/*_task.py` | 32 files | `bgtasks/notification_task.py`, `bgtasks/webhook_task.py`, `bgtasks/cleanup_task.py`, `bgtasks/export_task.py`, `bgtasks/issue_activities_task.py` |
| 1 — `apps/api` Permissions | `apps/api/plane/app/permissions/*.py` | 5 files | `permissions/base.py`, `permissions/project.py`, `permissions/workspace.py`, `permissions/page.py` |
| 1 — `apps/api` Implicit (PEP 257 module-level) | `apps/api/plane/**/*.py` excluding migrations + tests | 396 files | `apps/api/plane/middleware/`, `apps/api/plane/authentication/`, `apps/api/plane/utils/`, `apps/api/plane/settings/`, `apps/api/plane/license/`, `apps/api/plane/space/`, `apps/api/plane/analytics/`, `apps/api/plane/throttles/`, `apps/api/plane/api/` |
| 2 — `apps/web` Stores | `apps/web/core/store/**/*.store.ts` | 75 files | `store/cycle.store.ts`, `store/module.store.ts`, `store/issue/*.store.ts`, `store/pages/*.store.ts`, `store/workspace/*.store.ts`, `store/user/*.store.ts` |
| 2 — `apps/web` Issue components | `apps/web/core/components/issues/**/*.tsx` | 318 files | `components/issues/issue-detail/**`, `components/issues/issue-layouts/**`, `components/issues/issue-modal/**`, `components/issues/peek-overview/**`, `components/issues/bulk-operations/**` |
| 2 — `apps/web` Cycle components | `apps/web/core/components/cycles/**/*.tsx` | 42 files | `components/cycles/list/**`, `components/cycles/active-cycle/**`, `components/cycles/analytics-sidebar/**`, `components/cycles/dropdowns/**` |
| 3 — `@plane/ui` | `packages/ui/src/**/*.{ts,tsx}` excluding stories/tests | ~78 component files | `packages/ui/src/button/`, `/modals/`, `/tooltip/`, `/dropdown/`, `/form-fields/`, `/avatar/`, `/badge/` |
| 3 — `@plane/editor` | `packages/editor/src/index.ts` named + star re-exports | 225 source files (focus on exported surface) | `editors/`, `core/extensions/`, `helpers/common`, `helpers/yjs-utils`, `constants/common`, `constants/extension`, `plane-editor/constants/extensions` |
| 3 — `@plane/types` | `packages/types/src/**/*.ts` | 116 files (95 non-index) | `types/src/issues/`, `/project/`, `/cycle/`, `/page/`, `/workspace/`, `/notification/`, `/editor/`, `/layout/` |
| 3 — `@plane/constants` | `packages/constants/src/**/*.ts` | 56 files (48 non-index) | `constants/src/issue.ts`, `/cycle.ts`, `/auth.ts`, `/page.ts`, `/notification.ts`, `/event-tracker.ts` |
| 4 — `apps/live` | `apps/live/src/**/*.ts` | 43 files | `src/start.ts`, `/server.ts`, `/hocuspocus.ts`, `/extensions/{database, force-close-handler, logger, redis, title-sync}.ts`, `/controllers/{health, collaboration, document, pdf-export}.controller.ts`, `/services/page/*`, `/lib/auth.ts`, `/lib/stateless.ts` |

### 0.4.5 Web Search Research Conducted

The Blitzy platform's prior knowledge already covers:

- **PEP 257** docstring conventions and `pydocstyle` rule codes (`D100`–`D419`)
- **JSDoc** standard tags (`@param`, `@returns`, `@throws`, `@example`, `@deprecated`, `@see`, `@template`)
- **MobX** documentation patterns for `observable`, `action`, `computed`, `runInAction`, `makeObservable`, `computedFn`
- **Django REST Framework** ViewSet method conventions (`list`, `create`, `retrieve`, `update`, `partial_update`, `destroy`)
- **Hocuspocus** server hook lifecycle (`onConnect`, `onAuthenticate`, `onChange`, `onStateless`, `onDisconnect`, `onLoadDocument`, `onStoreDocument`)
- **Y.js** CRDT auto-merge semantics; absence of conflict resolution callbacks (last-writer-wins is structural via CRDT)

No external web search is required because the documentation standards and tooling versions are either user-specified verbatim or pinned in the repository's manifests.

## 0.5 Documentation Scope Analysis

### 0.5.1 Code-to-Documentation Mapping (Directive 1 — `apps/api`)

Given the requirements and repository analysis, the following Django backend modules require documentation. Counts are from §0.4.3; example paths are representative.

**ViewSets** (57 classes across 59 files under `apps/api/plane/app/views/`):

| Module Group | Files | Documentation Required |
|--------------|-------|------------------------|
| Issue lifecycle | `views/issue/{base, comment, link, attachment, label, reaction, subscriber, archive, sub_issue, version, relation, activity}.py` | HTTP methods + URL pattern + permission + request/response schema + `get_queryset` filter logic |
| Workspace | `views/workspace/{base, member, invite, label, state, cycle, module, draft, sticky, user, estimate, favorite, quick_link, home, recent_visit, user_preference}.py` | Same per-class |
| Project | `views/project/{base, member, invite}.py` | Same per-class |
| Cycle | `views/cycle/{base, issue, archive}.py` | Same per-class |
| Page | `views/page/{base, version}.py` | Same per-class — including the live-server callback contract documented at tech spec §5.2.1.4 |
| Asset | `views/asset/{base, v2}.py` | Same per-class — including the presigned POST contract documented at tech spec §5.2.9 |
| Notification | `views/notification/base.py` | Same per-class |
| Webhook | `views/webhook/base.py` | Same per-class — including HMAC payload contract per tech spec §5.2.10 |
| Search | `views/search/{base, issue}.py` | Same per-class |
| Analytic | `views/analytic/{base, project_analytics, advance}.py` | Same per-class |
| Auxiliary | `views/api.py`, `views/base.py`, `views/error_404.py`, `views/exporter/base.py`, `views/external/base.py`, `views/timezone/base.py`, `views/state/base.py`, `views/view/base.py`, `views/intake/base.py`, `views/estimate/base.py`, `views/user/base.py` | Same per-class |

**Serializers** (21 files under `apps/api/plane/app/serializers/`): `analytic.py`, `api.py`, `asset.py`, `base.py`, `cycle.py`, `draft.py`, `estimate.py`, `exporter.py`, `favorite.py`, `importer.py`, `intake.py`, `issue.py`, `module.py`, `notification.py`, `page.py`, `project.py`, `state.py`, `user.py`, `view.py`, `webhook.py`, `workspace.py`. Documentation required: module docstring + class docstring per `Serializer` subclass + method docstrings on every `validate_*`, `validate`, `to_representation`, `to_internal_value` override.

**Models** (32 files under `apps/api/plane/db/models/`): `analytic.py`, `api.py`, `asset.py`, `base.py`, `cycle.py`, `deploy_board.py`, `description.py`, `device.py`, `draft.py`, `estimate.py`, `exporter.py`, `favorite.py`, `importer.py`, `intake.py`, `issue.py`, `issue_type.py`, `label.py`, `module.py`, `notification.py`, `page.py`, `project.py`, `recent_visit.py`, `session.py`, `social_connection.py`, `state.py`, `sticky.py`, `user.py`, `view.py`, `webhook.py`, `workspace.py`, plus `integration/`. Documentation required: business purpose (one sentence) per model class; field-level inline comments for `CharField(choices=…)` and `JSONField`; docstrings on all custom `Manager`/`QuerySet` subclasses and their methods.

**Celery tasks** (32 files under `apps/api/plane/bgtasks/`):

| File | Trigger Source (to document) |
|------|------------------------------|
| `analytic_plot_export.py` | Explicit `.delay()` from analytics view |
| `cleanup_task.py` | Beat schedule `00:00 UTC` per tech spec §3.2.2 |
| `copy_s3_object.py` | Explicit call from import/duplication paths |
| `deletion_task.py` | Beat schedule + signal handlers |
| `dummy_data_task.py` | Explicit `.delay()` from seed CLI |
| `email_notification_task.py` | Chained from `notification_task` |
| `event_tracking_task.py` | Explicit `.delay()` from view base classes |
| `export_task.py` | Explicit `.delay()` from `exporter` viewset |
| `exporter_expired_task.py` | Beat schedule |
| `file_asset_task.py` | Signal + Beat (`02:00 UTC` cleanup) per tech spec §3.2.2 |
| `forgot_password_task.py` | Explicit `.delay()` from auth view |
| `issue_activities_task.py` | Signal handlers on Issue model save |
| `issue_automation_task.py` | Beat schedule + state-change signals |
| `issue_description_version_sync.py`, `issue_description_version_task.py` | Live-server callback chain |
| `issue_version_sync.py` | Signal + explicit call |
| `logger_task.py` | Explicit `.delay()` for async log shipping |
| `magic_link_code_task.py` | Explicit `.delay()` from auth view |
| `notification_task.py` | Signal handlers on multiple models |
| `page_transaction_task.py`, `page_version_task.py` | Live-server callback chain |
| `project_add_user_email_task.py`, `project_invitation_task.py` | Explicit `.delay()` from invite view |
| `recent_visited_task.py` | Explicit `.delay()` from view base |
| `storage_metadata_task.py` | Beat schedule + post-upload finalize |
| `user_activation_email_task.py`, `user_deactivation_email_task.py`, `user_email_update_task.py` | Explicit `.delay()` from user views |
| Plus `apps.py` (AppConfig) and helpers | Module-level docstrings only |

**Permission classes** (5 files under `apps/api/plane/app/permissions/`): `base.py`, `page.py`, `project.py`, `workspace.py`, plus `__init__.py`. Per Directive 1: "Zero undocumented permission classes." Every `class …Permission(BasePermission)` definition must have a class docstring describing the access rule it enforces.

### 0.5.2 Code-to-Documentation Mapping (Directive 2 — `apps/web`)

**MobX stores** (75 files under `apps/web/core/store/`):

| Sub-Folder / Top-Level | Representative Files | Documentation Required |
|------------------------|----------------------|------------------------|
| Top-level domain | `analytics.store.ts`, `cycle.store.ts`, `cycle_filter.store.ts`, `dashboard.store.ts`, `favorite.store.ts`, `global-view.store.ts`, `instance.store.ts`, `label.store.ts`, `module.store.ts`, `module_filter.store.ts`, `multiple_select.store.ts`, `project-view.store.ts`, `router.store.ts`, `state.store.ts`, `theme.store.ts` | Module-level JSDoc with state slice + actions + computed + consumers |
| Base abstractions | `base-command-palette.store.ts`, `base-power-k.store.ts` | Same |
| `editor/` | `asset.store.ts` | Same |
| `estimates/` | `project-estimate.store.ts` | Same |
| `inbox/` | (inbox sub-stores) | Same |
| `issue/` | `issue.store.ts`, `issue_calendar_view.store.ts`, `issue_gantt_view.store.ts`, `issue_kanban_view.store.ts`, plus `archived/`, `cycle/`, `module/`, `project/`, `profile/`, `project-views/`, `workspace/`, `workspace-draft/`, `issue-details/`, `helpers/` | Same |
| `member/` | `project/base-project-member.store.ts`, `project/project-member-filters.store.ts`, `workspace/workspace-member.store.ts`, `workspace/workspace-member-filters.store.ts` | Same |
| `notifications/` | (notification sub-stores) | Same |
| `pages/` | `project-page.store.ts`, plus page sub-stores | Same |
| `project/` | `project-publish.store.ts`, `project_filter.store.ts`, `project.store.ts` | Same |
| `sticky/` | `sticky.store.ts` | Same |
| `timeline/` | (timeline sub-stores) | Same |
| `user/` | `account.store.ts`, `base-permissions.store.ts`, `profile.store.ts`, `settings.store.ts` | Same |
| `workspace/` | `link.store.ts`, `api-token.store.ts`, `webhook.store.ts` | Same |
| Composition root | `root.store.ts` | Module-level JSDoc enumerating all sub-stores + their wiring through React context |

**Issue components** (318 files under `apps/web/core/components/issues/`): Sub-folders include `attachment/`, `bulk-operations/`, `issue-detail/`, `issue-detail-widgets/`, `issue-layouts/` (with `kanban/`, `list/`, `spreadsheet/`, `calendar/`, `gantt/`, `roots/`, `properties/`, `filters/`, `quick-action-dropdowns/`, `quick-add/`, `empty-states/`), `issue-modal/` (with `components/`, `context/`), `peek-overview/`, `preview-card/`, `relations/`, `select/`, `workspace-draft/`. Each `.tsx` file requires module-level JSDoc per Directive 2.

**Cycle components** (42 files under `apps/web/core/components/cycles/`): Sub-folders include `active-cycle/`, `analytics-sidebar/`, `applied-filters/`, `archived-cycles/`, `dropdowns/` (with `filters/`), `list/`. Each `.tsx` file requires module-level JSDoc per Directive 2.

### 0.5.3 Code-to-Documentation Mapping (Directive 3 — `packages/`)

**`@plane/ui`** (`packages/ui/src/index.ts` star-re-exports 33 sub-modules → ~78 `.tsx` files in scope):

| Module Surface | Representative Exports |
|----------------|------------------------|
| Buttons & input | `button/`, `form-fields/`, `auth-form/` |
| Containers | `card/`, `content-wrapper/`, `modals/`, `row/`, `header/` |
| Navigation | `tabs/`, `breadcrumbs/`, `dropdown/`, `dropdowns/` |
| Data display | `avatar/`, `badge/`, `tag/`, `progress/`, `loader/`, `tables/`, `typography/` |
| Overlays | `tooltip/`, `popovers/`, `link/`, `control-link/` |
| Interactive | `color-picker/`, `drag-handle/`, `drop-indicator/`, `sortable/`, `scroll-area/`, `collapsible/`, `favorite-star/` |
| Auth surface | `oauth/` |
| Utility | `constants/`, `utils/`, `spinners/` |

Documentation required per Directive 3: JSDoc on each exported component with purpose + every prop (name/type/required/default) + ARIA/keyboard behavior.

**`@plane/editor`** (`packages/editor/src/index.ts`):

| Export | Source Location | Documentation Required |
|--------|-----------------|------------------------|
| `CollaborativeDocumentEditorWithRef` | `src/components/editors/` | Component JSDoc + collaboration extensions wired + Y.js doc schema |
| `DocumentEditorWithRef` | `src/components/editors/` | Component JSDoc + extensions wired |
| `LiteTextEditorWithRef` | `src/components/editors/` | Component JSDoc + extensions wired |
| `RichTextEditorWithRef` | `src/components/editors/` | Component JSDoc + extensions wired |
| `* from "@/constants/common"` | `src/constants/common.*` | Group-level constants JSDoc |
| `* from "@/helpers/common"` | `src/helpers/common.*` | JSDoc on every exported helper |
| `* from "@/helpers/yjs-utils"` | `src/helpers/yjs-utils.*` | JSDoc on Y.js update encode/decode/merge helpers |
| `CORE_EXTENSIONS`, `ADDITIONAL_EXTENSIONS` | `src/constants/extension.ts`, `src/plane-editor/constants/extensions.ts` | JSDoc listing each TipTap extension included + behavior |
| `* from "@/types"` | `src/types/*` | JSDoc on every exported type/interface |
| `TrailingNode` | `src/core/extensions/trailing-node.ts` | JSDoc on the custom ProseMirror node |

Documentation must also describe (per Directive 3): which TipTap extensions from `packages/editor/package.json` are exposed, overridden, or intentionally hidden by the wrapper; and the expected Y.js document schema where applicable.

**`@plane/types`** (`packages/types/src/`):

| Module Surface | File Count | Examples |
|----------------|------------|----------|
| `issues/` | (subset of 116) | `issue.ts`, `issue_subscription.ts`, `issue_reaction.ts`, `issue_link.ts`, `issue_attachment.ts`, `issue_relation.ts`, `issue-identifier.ts`, `issue_sub_issues.ts`, `activity/issue_activity.ts`, `activity/issue_comment.ts`, `activity/issue_comment_reaction.ts` |
| `project/` | (subset) | `projects.ts`, `project_link.ts`, `project_filters.ts` |
| `cycle/`, `page/`, `workspace/`, `notification/`, `editor/`, `layout/` (gantt, etc.) | (subset) | Domain-specific entity types |
| Total | 116 `.ts` files (95 non-index) | Every `export interface`, `export type`, `export enum` requires JSDoc |

**`@plane/constants`** (`packages/constants/src/`): 56 files (48 non-index), 48 star-re-exported sub-modules from `index.ts`: `ai`, `analytics`, `auth`, `chart`, `cycle`, `dashboard`, `emoji`, `endpoints`, `estimates`, `event-tracker`, `file`, `filter`, `graph`, `icon`, `instance`, `intake`, `issue`, `members`, `label`, `metadata`, `module`, `notification`, `page`, `payment`, plus ~24 more. Every exported constant or enum gets JSDoc; group-level JSDoc is acceptable for tightly coupled groups.

### 0.5.4 Code-to-Documentation Mapping (Directive 4 — `apps/live`)

The 43 source files under `apps/live/src/` are partitioned as follows:

| Module Group | Files | Documentation Focus |
|--------------|-------|---------------------|
| Entrypoint | `start.ts` | Bootstrap sequence, SIGTERM/SIGINT signal handlers |
| HTTP + WS orchestration | `server.ts` | `Server` class lifecycle, Express + expressWs registration, middleware chain (helmet, cors, compression, logger), controller mounting via `registerController` from `@plane/decorators`, mount under `env.LIVE_BASE_PATH` |
| Hocuspocus orchestration | `hocuspocus.ts` | `HocusPocusServerManager` singleton, extension composition order, `onAuthenticate` and `onStateless` wiring |
| Environment contract | `env.ts` | Zod-validated runtime contract for env vars consumed by `apps/live` (build-time vs. runtime distinction NOT applicable here — this is a Node service, not a Vite-bundled frontend) |
| Redis manager | `redis.ts` | Singleton ioredis with PING startup verification — clarify "Redis: caching only — task queueing uses RabbitMQ via apps/api" per architectural context |
| Extensions | `extensions/{database, force-close-handler, logger, redis, title-sync}.ts`, `extensions/index.ts`, `extensions/title-update/{debounce, title-update-manager, title-utils}.ts` | Per-extension JSDoc: registered hooks (`onConfigure`, `onLoadDocument`, `onStoreDocument`, `onConnect`, `onAuthenticate`, `beforeBroadcastStateless`, etc.), debounce constants (10-second persistence debounce in `database.ts`), HTML→binary backfill in `database.ts`, force-close coordination via Redis pub/sub |
| Controllers | `controllers/{health, collaboration, document, pdf-export}.controller.ts`, `controllers/index.ts` | Express decorator-based REST endpoints — for each controller class document the route path, HTTP method, request schema, response shape, auth requirement |
| Services | `services/api.service.ts`, `services/page/{core, extended, project-page}.service.ts`, `services/page/handler.ts`, `services/pdf-export/{index, pdf-export.service, effect-utils, types}.ts`, `services/user.service.ts` | Service class JSDoc: target API endpoints called, error handling, Axios interceptors (if any) |
| Library helpers | `lib/auth.ts`, `lib/auth-middleware.ts`, `lib/errors.ts`, `lib/stateless.ts`, `lib/pdf/{index, colors, mark-renderers, styles, types}.ts` | JSDoc on `LIVE_SERVER_SECRET_KEY` validation, WebSocket auth flow, stateless relay protocol, PDF rendering primitives |
| Schemas | `schema/pdf-export.ts` | JSDoc on Zod schemas with field semantics |
| Types | `types/{admin-commands, index}.ts` | JSDoc on every exported type/interface |
| Utilities | `utils/{broadcast-error, broadcast-message}.ts` | JSDoc on stateless broadcast helpers (used by extensions for emitting admin commands across the cluster) |

### 0.5.5 Documentation Gap Analysis

Given the requirements and repository analysis, documentation gaps include:

- **Undocumented public Python module-level docstrings:** 100% of `apps/api/plane/` source files lack PEP 257 module docstrings — this is the single largest gap and the primary blocker for validation gate 1
- **Undocumented Django ViewSets:** 56 of 57 (>98%) lack class docstrings; 0 of 57 carry the directive-required HTTP/URL/permission/queryset block
- **Undocumented serializers:** 21 files lack class docstrings; all `validate_*` and `to_representation` methods undocumented
- **Undocumented models:** 32 model files lack one-sentence business purpose; `CharField(choices=…)` enumerations not inline-commented; `JSONField` expected schemas absent
- **Undocumented Celery task semantics:** All 32 `*_task.py` files lack the directive-required trigger/side-effect/idempotency block
- **Undocumented permission classes:** 5 permission files lack class docstrings (Directive 1 success criterion: zero undocumented permission classes)
- **Missing MobX store contracts:** 75 store files have copyright headers only; no state/actions/computed/consumer documentation
- **Missing component contracts:** ~360 component files in `issues/` + `cycles/` lack module-level JSDoc
- **Missing exported symbol JSDoc across `packages/`:** Every exported component (`@plane/ui`), editor surface (`@plane/editor`), type (`@plane/types`), and constant (`@plane/constants`) requires JSDoc per Directive 3
- **Missing real-time layer documentation:** All 43 `apps/live/src/` files lack the directive-required event-handler and document-sync JSDoc
- **Pre-existing typo to leave untouched:** `packages/editor/Readme.md` is mis-cased (other packages use `README.md`). Per system boundary "No refactoring, renaming, or restructuring of any kind," this filename is NOT corrected.

## 0.6 Documentation Implementation Design

### 0.6.1 Documentation Structure Planning (In-Place Inline Documentation)

The output of this work is in-place edits to existing source files. No new directories, documentation site, or markdown files are produced. The documentation hierarchy follows the existing repository layout exactly:

```text
apps/
├── api/
│   └── plane/
│       ├── app/views/**/*.py        (UPDATE — module docstring + class docstring per ViewSet + method docstrings on overrides)
│       ├── app/serializers/*.py     (UPDATE — module + class + validate_*/to_representation docstrings)
│       ├── app/permissions/*.py     (UPDATE — module + class docstring per BasePermission subclass)
│       ├── db/models/*.py           (UPDATE — module + class docstring + field-level comments for choices/JSONField)
│       ├── bgtasks/*_task.py        (UPDATE — module + function docstring per @shared_task with trigger/side-effect/idempotency)
│       └── <all other plane/**.py>  (UPDATE — module docstring only, to satisfy PEP 257 D100)
├── web/
│   └── core/
│       ├── store/**/*.store.ts      (UPDATE — module-level JSDoc with state/actions/computed/consumers)
│       └── components/
│           ├── issues/**/*.tsx      (UPDATE — module-level JSDoc with purpose/props/stores/side-effects)
│           └── cycles/**/*.tsx      (UPDATE — same)
└── live/
    └── src/**/*.ts                  (UPDATE — module JSDoc + class JSDoc + per-method/handler JSDoc)

packages/
├── ui/src/**/*.{ts,tsx}             (UPDATE — JSDoc on every exported component)
├── editor/src/**/*.{ts,tsx}         (UPDATE — JSDoc on public API surface)
├── types/src/**/*.ts                (UPDATE — JSDoc on every exported interface/type/enum)
└── constants/src/**/*.ts            (UPDATE — JSDoc on every exported constant; group-level allowed)
```

### 0.6.2 Content Generation Strategy

**Information Extraction Approach:**

- Extract ViewSet HTTP methods + URL patterns from `apps/api/plane/app/urls/*.py` router registrations and `@action(methods=…)` decorators
- Extract ViewSet permission classes from the class-level `permission_classes` attribute (e.g., `[ProjectEntityPermission]` in `apps/api/plane/app/views/issue/link.py` line 27)
- Extract `get_queryset` filter logic from method bodies — the docstring summarizes joins and `.filter()` chains, not implementation
- Extract serializer field semantics from `Meta.fields`/`Meta.read_only_fields`/`Meta.extra_kwargs` declarations
- Extract model field semantics from field declarations; for `CharField(choices=CHOICES_TUPLE)`, mirror the choices tuple values into the inline comment
- Extract Celery task triggers from `CELERY_BEAT_SCHEDULE` in `apps/api/plane/celery.py` for scheduled tasks; from grep of `.delay()` / `.apply_async()` call sites elsewhere in `apps/api/plane/` for explicitly-invoked tasks; from `@receiver` signal handlers for signal-triggered tasks
- Extract MobX observable shapes from `makeObservable(this, { … })` blocks and from typed class field declarations
- Extract React component props from the TypeScript `Props` interface or inline `(props: { … })` parameter type
- Extract MobX store consumption from `useMobxStore`, `useContext(...)`, or constructor injection patterns
- Extract HocusPocus extension hooks from `Extension`/`ExtensionConstructor` definitions in `apps/live/src/extensions/`
- Extract Y.js document sync details from `extensions/database.ts` — the 10-second debounce constant and HTML→binary backfill behavior per tech spec §5.2.5.4
- Extract TipTap extension wiring from the editor configuration registries in `packages/editor/src/core/extensions/` and `packages/editor/src/plane-editor/constants/extensions.ts`

**Template Application:**

Each Python module receives the following template (substituted with module-specific content):

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors

#### SPDX-License-Identifier: AGPL-3.0-only

#### See the LICENSE file for details.

"""<one-line module summary>.

<optional multi-line elaboration of module purpose, consumers,
and architectural role. PEP 257 conformant.>
"""

##### ... existing imports unchanged ...

class ExampleViewSet(BaseViewSet):
    """<one-line class summary>.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/example/
        POST   /api/workspaces/<slug>/projects/<project_id>/example/

    Request body (POST):
        field_a (str, required): <semantic>
        field_b (int, optional, default=0): <semantic>

    Response shape:
        {"id": UUID, "field_a": str, ...}

    Permissions:
        permission_classes = [ProjectEntityPermission]
    """

    permission_classes = [ProjectEntityPermission]
```

Each TypeScript/JavaScript module receives the following template:

```typescript
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * <one-line module summary>.
 *
 * State slice:
 *   - cycleMap: Record<string, ICycle> — all cycles keyed by id
 *   - filteredCycleIds: string[] — derived list per active filter
 *
 * Actions:
 *   - fetchCycles(workspaceSlug, projectId): Promise<ICycle[]>
 *       Side effects: GET /api/workspaces/<slug>/projects/<id>/cycles/, mutates cycleMap
 *   - createCycle(payload): Promise<ICycle>
 *       Side effects: POST + mutates cycleMap + emits to rootStore.eventTracker
 *
 * Computed:
 *   - currentProjectCompletedCycleIds — recomputes when cycleMap or routerStore.projectId changes
 *
 * Consumers:
 *   - apps/web/core/components/cycles/list/**
 *   - apps/web/core/components/cycles/active-cycle/**
 */
```

**Documentation Standards (binding to user-specified rules from §0.2.3):**

- All inline blocks ≤ 1–2 sentences; verbose prose is rejected
- Comments explain WHY, not WHAT — implementation narration is rejected
- Markdown boilerplate is avoided; only section headers and parameter tables are allowed inside module READMEs (none are being added here)
- Source citations follow the format `Source: <path>:<line>` inline only where reference is essential for context

### 0.6.3 Diagram and Visual Strategy

No mermaid diagrams are added to source files (mermaid blocks cannot be rendered inside Python `"""..."""` or JSDoc blocks rendered by `tsc`). The architectural diagrams already present in the technical specification (tech spec §5.2.5.4 real-time sequence, §5.2.8 bootstrap state diagram, §5.2.9 presigned upload sequence, §5.2.10 webhook delivery sequence) provide the authoritative visual context; inline documentation references them where helpful via plain-text "See tech spec §X.Y.Z" pointers.

### 0.6.4 Worked Example — ViewSet Documentation

The following is a worked example to illustrate the expected output shape — NOT a template to be copy-pasted. Each actual ViewSet must be documented with its own specific HTTP/URL/permission/queryset content extracted from the codebase.

For `apps/api/plane/app/views/issue/link.py` (which carries `permission_classes = [ProjectEntityPermission]` on line 27), the class docstring inserted above the class definition will state:

- Resource managed (issue links)
- HTTP methods + URL patterns from the urls router (e.g. `GET/POST/PATCH/DELETE /api/workspaces/<slug>/projects/<id>/issues/<issue_id>/issue-links/`)
- Request body schema (extracted from `IssueLinkSerializer`)
- Response shape (extracted from the same serializer)
- Permission rule enforced by `ProjectEntityPermission` (described in `apps/api/plane/app/permissions/project.py`)
- `get_queryset` filter logic if the class overrides it

### 0.6.5 Worked Example — MobX Store Documentation

For `apps/web/core/store/cycle.store.ts` (which uses `makeObservable`, `observable`, `action`, `computed`, `computedFn` per its imports on lines 9–10), the module-level JSDoc block inserted directly after the copyright header will state:

- The state slice: every `@observable` property and its declared type from the `ICycleStore` interface
- All actions: each `@action`/`@action.bound` method with its parameters, mutation targets, async API calls, and downstream effects
- Computed values: each `@computed` getter and each `computedFn` factory with the inputs it depends on and the recomputation conditions
- Consumers: components in `apps/web/core/components/cycles/` and other stores in `apps/web/core/store/cycle/` that read this store

### 0.6.6 Worked Example — Celery Task Documentation

For `apps/api/plane/bgtasks/notification_task.py`, the function-level docstring above each `@shared_task` will state:

- Trigger: bound to `post_save` signal on `IssueAssignee` / `IssueSubscriber` / `IssueMention` / `Issue` (specific signal connections documented per task)
- Side effects: writes to `EmailNotificationLog`, `IssueSubscriber`, `Notification` tables; enqueues `email_notification_task` for actual SMTP delivery; reads workspace and project member data
- Idempotency: NON-idempotent — duplicate triggers create duplicate `Notification` rows; relies on signal de-duplication upstream
- Cross-references: tech spec §4.6 NOTIFICATION PIPELINE WORKFLOW

## 0.7 Documentation File Transformation Mapping

### 0.7.1 Transformation Modes Used

Per the user's system boundaries — "No refactoring, renaming, or restructuring of any kind" and "no new dependencies" — every transformation in this documentation work is mode **UPDATE** applied to existing source files. The CREATE, DELETE, and REFERENCE modes are not used. Auto-generated files, lock files, migrations, and test files are excluded per the user's "OUT OF SCOPE" rules.

### 0.7.2 File-by-File Documentation Plan (Target Listed First)

The user's directives are global within their respective directories; per-directory wildcards are used to express the scope concisely. The mapping below is exhaustive: every documented file falls under one of the listed glob patterns.

| Target Documentation File (glob) | Transformation | Source (same path) | Content / Changes |
|----------------------------------|----------------|--------------------|-------------------|
| `apps/api/plane/app/views/**/*.py` | UPDATE | self | Module docstring (PEP 257 D100) + class docstring per ViewSet (HTTP methods, URL pattern, request body schema, response shape, permission_classes, `get_queryset` filter logic) + method docstrings on overrides |
| `apps/api/plane/app/serializers/*.py` | UPDATE | self | Module docstring + class docstring per Serializer subclass + method docstrings on every `validate_*`, `validate`, `to_representation`, `to_internal_value` override; field-level inline comments where write-only/read-only/computed semantics are non-obvious |
| `apps/api/plane/app/permissions/*.py` | UPDATE | self | Module docstring + class docstring per `BasePermission` subclass naming the access rule enforced (Directive 1 success criterion: zero undocumented permission classes) |
| `apps/api/plane/db/models/*.py` | UPDATE | self | Module docstring + class docstring (one-sentence business purpose) per model + inline field comments for `CharField(choices=…)` and `JSONField` + method docstrings on all custom `Manager`/`QuerySet` methods |
| `apps/api/plane/db/models/integration/*.py` | UPDATE | self | Same as above for integration models |
| `apps/api/plane/db/mixins.py` | UPDATE | self | Module + class docstrings on every mixin class |
| `apps/api/plane/bgtasks/*_task.py` | UPDATE | self | Module docstring + function docstring per `@shared_task` (trigger source, side effects, idempotency assessment) + cross-reference to `CELERY_BEAT_SCHEDULE` entries in `apps/api/plane/celery.py` where applicable |
| `apps/api/plane/bgtasks/apps.py` | UPDATE | self | Module + `AppConfig` class docstrings |
| `apps/api/plane/celery.py` | UPDATE | self | Module docstring + docstrings on `CELERY_BEAT_SCHEDULE` consumers + Celery app instance docstring |
| `apps/api/plane/api/**/*.py` | UPDATE | self | Module + class docstrings on external `/api/v1/` ViewSets (same shape as Directive 1 ViewSet documentation) |
| `apps/api/plane/middleware/**/*.py` | UPDATE | self | Module + class docstrings on middleware classes (`ReadReplicaRoutingMiddleware`, `RequestLoggerMiddleware`, `APITokenLogMiddleware`, `request_body_size`) |
| `apps/api/plane/authentication/**/*.py` | UPDATE | self | Module + class docstrings on auth providers, session adapters, throttle classes |
| `apps/api/plane/throttles/**/*.py` | UPDATE | self | Module + class docstrings on `AssetThrottle` and related |
| `apps/api/plane/utils/**/*.py` | UPDATE | self | Module docstrings (PEP 257 D100) on all utility modules + function/class docstrings on every public symbol |
| `apps/api/plane/settings/**/*.py` | UPDATE | self | Module docstrings describing each overlay (`common.py`, `local.py`, `test.py`, `production.py`, `redis.py`, `mongo.py`, `storage.py`, `openapi.py`) |
| `apps/api/plane/license/**/*.py` | UPDATE | self | Module + class docstrings (`Instance`, `InstanceConfiguration` with Fernet encryption semantics) |
| `apps/api/plane/space/**/*.py` | UPDATE | self | Module + class docstrings on the public-spaces ViewSets and serializers |
| `apps/api/plane/analytics/**/*.py` | UPDATE | self | Module + class docstrings on analytics rollups |
| `apps/api/plane/web/**/*.py` | UPDATE | self | Module docstrings on web-facing helpers |
| `apps/api/plane/db/management/**/*.py` | UPDATE | self | Module + `Command` class docstrings on every management command |
| `apps/api/plane/__init__.py`, `apps/api/plane/wsgi.py`, `apps/api/plane/asgi.py`, `apps/api/plane/urls.py` | UPDATE | self | Module-level docstrings (PEP 257 D100) explaining each module's role in the boot sequence |
| `apps/web/core/store/*.store.ts` | UPDATE | self | Module-level JSDoc block (state slice, actions, computed, consumers) below the SPDX header |
| `apps/web/core/store/**/*.store.ts` | UPDATE | self | Same — applies to nested store sub-folders (`issue/`, `pages/`, `user/`, `project/`, `workspace/`, `notifications/`, `member/`, `inbox/`, `editor/`, `sticky/`, `timeline/`, `estimates/`, `cycle/`, `module/`) |
| `apps/web/core/store/root.store.ts` | UPDATE | self | Module + class JSDoc enumerating all sub-stores and the React context injection pattern |
| `apps/web/core/store/**/index.ts` | UPDATE | self | Module-level JSDoc on aggregator files |
| `apps/web/core/components/issues/**/*.tsx` | UPDATE | self | Module-level JSDoc (rendered purpose, props with types and required/optional, MobX stores read, side effects: mutations / navigations / API calls) + inline JSDoc on non-obvious conditional rendering / derived state / imperative DOM operations |
| `apps/web/core/components/cycles/**/*.tsx` | UPDATE | self | Same as above |
| `apps/web/core/components/issues/**/*.ts` and `cycles/**/*.ts` (non-tsx helpers) | UPDATE | self | Module-level JSDoc + JSDoc on every exported function/constant |
| `packages/ui/src/**/*.tsx` (exported components) | UPDATE | self | JSDoc on every exported component declaration with purpose, every prop (name, type, required/optional, default), ARIA / keyboard behavior where the component implements them |
| `packages/ui/src/**/*.ts` (exported utilities) | UPDATE | self | JSDoc on every exported helper function and constant |
| `packages/ui/src/index.ts` | UPDATE | self | Module-level JSDoc enumerating the 33 sub-module surfaces re-exported (Buttons, Modals, Forms, Avatars, Tooltips, etc.) |
| `packages/editor/src/index.ts` | UPDATE | self | Module JSDoc + per-export JSDoc on the four editor components, helpers re-exports, type re-exports, `CORE_EXTENSIONS`, `ADDITIONAL_EXTENSIONS`, `TrailingNode` |
| `packages/editor/src/components/editors/**/*.{ts,tsx}` | UPDATE | self | Component JSDoc on `CollaborativeDocumentEditorWithRef`, `DocumentEditorWithRef`, `LiteTextEditorWithRef`, `RichTextEditorWithRef` — props, refs, collaboration extensions wired, Y.js document schema expected |
| `packages/editor/src/core/extensions/**/*.ts` | UPDATE | self | JSDoc on every custom TipTap extension, declaring what TipTap behavior is exposed / overridden / intentionally hidden |
| `packages/editor/src/helpers/{common,yjs-utils}.ts` | UPDATE | self | JSDoc on every exported helper; especially Y.js encode/decode/merge utilities |
| `packages/editor/src/constants/{common,extension}.ts` | UPDATE | self | JSDoc on `CORE_EXTENSIONS` listing every TipTap extension included + behavior |
| `packages/editor/src/types/**/*.ts` | UPDATE | self | JSDoc on every exported type/interface |
| `packages/editor/src/plane-editor/constants/extensions.ts` | UPDATE | self | JSDoc on `ADDITIONAL_EXTENSIONS` |
| `packages/types/src/**/*.ts` | UPDATE | self | JSDoc above every `export interface`/`export type`/`export enum` with entity modeled + consumer + non-obvious field semantics |
| `packages/types/src/index.ts` | UPDATE | self | Module-level JSDoc enumerating the domain-organized type folders |
| `packages/constants/src/**/*.ts` | UPDATE | self | JSDoc on every exported constant or enum stating consumer location + what is controlled; group-level JSDoc acceptable for tightly coupled sets |
| `packages/constants/src/index.ts` | UPDATE | self | Module-level JSDoc enumerating the 48 sub-module categories re-exported |
| `apps/live/src/start.ts` | UPDATE | self | Module + bootstrap sequence JSDoc + SIGTERM/SIGINT handler JSDoc |
| `apps/live/src/server.ts` | UPDATE | self | Module + `Server` class JSDoc, Express middleware chain, expressWs wiring, controller registration, mount base path |
| `apps/live/src/hocuspocus.ts` | UPDATE | self | Module + `HocusPocusServerManager` class JSDoc, extension composition order, `onAuthenticate`, `onStateless` |
| `apps/live/src/env.ts` | UPDATE | self | JSDoc on the Zod env schema and each parsed variable |
| `apps/live/src/redis.ts` | UPDATE | self | JSDoc on `redisManager`, PING startup verification, "Redis: caching only — task queueing uses RabbitMQ via apps/api" architectural note |
| `apps/live/src/extensions/*.ts` | UPDATE | self | Per-extension JSDoc with registered Hocuspocus hooks (`onAuthenticate`, `onConnect`, `onLoadDocument`, `onStoreDocument`, `onChange`, `onDisconnect`, `beforeBroadcastStateless`), debounce constants, persistence side effects |
| `apps/live/src/extensions/title-update/*.ts` | UPDATE | self | JSDoc on debounce helper, title manager singleton, title utilities |
| `apps/live/src/controllers/*.controller.ts` | UPDATE | self | Per-controller JSDoc: route path, HTTP method, request body schema, response shape, auth requirement; documented decorators consumed from `@plane/decorators` |
| `apps/live/src/services/**/*.ts` | UPDATE | self | Service class JSDoc + per-method JSDoc with target API endpoints, error handling, axios usage |
| `apps/live/src/lib/auth.ts`, `auth-middleware.ts` | UPDATE | self | JSDoc on `onAuthenticate` hook, `LIVE_SERVER_SECRET_KEY` validation, session cookie handoff |
| `apps/live/src/lib/stateless.ts` | UPDATE | self | JSDoc on stateless relay protocol and `onStateless` handler |
| `apps/live/src/lib/errors.ts` | UPDATE | self | JSDoc on every exported error class |
| `apps/live/src/lib/pdf/**/*.ts` | UPDATE | self | JSDoc on PDF colors, mark renderers, styles, types |
| `apps/live/src/schema/pdf-export.ts` | UPDATE | self | JSDoc on Zod schemas with field semantics |
| `apps/live/src/types/{admin-commands,index}.ts` | UPDATE | self | JSDoc on every exported type/interface |
| `apps/live/src/utils/{broadcast-error,broadcast-message}.ts` | UPDATE | self | JSDoc on broadcast helpers (used by extensions for stateless cluster-wide admin commands) |

### 0.7.3 Documentation Updates Detail

Because every transformation is UPDATE on an existing file and no new files are created, this section enumerates representative file-level update details. The exhaustive glob coverage is captured in §0.7.2.

**Detail block — `apps/api/plane/app/views/issue/link.py` (representative ViewSet update):**

```text
File: apps/api/plane/app/views/issue/link.py
Type: Django REST Framework ViewSet
Sections inserted:
  - Module docstring (PEP 257 D100)
  - Class docstring for IssueLinkViewSet:
      * HTTP methods: GET (list, retrieve), POST (create), PATCH (partial_update), DELETE (destroy)
      * URL pattern: /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-links/
      * Request body schema: extracted from IssueLinkSerializer (url, title, metadata)
      * Response shape: extracted from IssueLinkSerializer.to_representation
      * Permission: ProjectEntityPermission (declared on line 27)
      * get_queryset: filter by workspace.slug, project_id, issue_id
  - Method docstring on get_queryset
Cross-references: apps/api/plane/app/permissions/project.py (ProjectEntityPermission)
                  apps/api/plane/app/serializers/issue.py (IssueLinkSerializer)
                  apps/api/plane/db/models/issue.py (IssueLink model)
```

**Detail block — `apps/web/core/store/cycle.store.ts` (representative MobX store update):**

```text
File: apps/web/core/store/cycle.store.ts
Type: MobX domain store
Sections inserted directly after the SPDX header (before existing imports):
  - Module-level JSDoc block:
      * State slice: cycleMap, plotType, distribution maps with full type signatures from @plane/types (ICycle, TCyclePlotType, ...)
      * Actions: fetchCycles, createCycle, updateCycle, deleteCycle, fetchActiveCycle, fetchArchivedCycles
          - For each: parameters, mutation targets, async API calls (CycleService, CycleArchiveService, IssueService, ProjectService)
      * Computed: currentProjectCompletedCycleIds, etc. — listed with derivation inputs + recomputation conditions
      * Computed (computedFn): cycleStateProgress / similar parameterized derivations
      * Consumers:
          - apps/web/core/components/cycles/list/**
          - apps/web/core/components/cycles/active-cycle/**
          - apps/web/core/components/cycles/analytics-sidebar/**
          - apps/web/core/store/issue/cycle/** (cross-store reads)
```

**Detail block — `apps/live/src/extensions/database.ts` (representative apps/live extension update):**

```text
File: apps/live/src/extensions/database.ts
Type: Hocuspocus extension wrapping @hocuspocus/extension-database
Sections inserted:
  - Module docstring
  - Class JSDoc on the extension wrapper:
      * Registered hooks: onConfigure, onLoadDocument, onStoreDocument, onChange
      * Trigger conditions per hook
      * State read: Y.Doc, page.description_binary / .description_html / .description_stripped from apps/api
      * State write: PATCH /pages/<id>/description/ with binary + json + html + stripped payload
      * Persistence debounce: 10000ms (constant DEBOUNCE_MS in source)
      * HTML→binary backfill behavior when description_binary is empty (cross-reference tech spec §5.2.5.4)
      * Conflict resolution: Yjs CRDT auto-merge — no explicit resolver
```

### 0.7.4 Documentation Configuration Updates

No documentation configuration changes are required. Verified:

- `mkdocs.yml` — not present in the repository; no update
- `docusaurus.config.js` — not present in the repository; no update
- `.readthedocs.yml` — not present in the repository; no update
- `sphinx/conf.py` — not present in the repository; no update
- `typedoc.json` — not present in the repository; no update
- `package.json` (root and all workspaces) — NOT modified (system boundary: no new dependencies)
- `apps/api/pyproject.toml` — NOT modified (system boundary: no refactoring); the `[tool.ruff.lint.pydocstyle] convention = "google"` line at line 70 remains as-is. The validation gate 1 invocation uses standalone `pydocstyle --convention=pep257`, which is independent of ruff's configuration.
- `apps/api/requirements/*.txt` — NOT modified (system boundary: no new dependencies)
- `turbo.json` — NOT modified
- `pnpm-workspace.yaml` — NOT modified

### 0.7.5 Cross-Documentation Dependencies

In-source citations are added where they meaningfully assist a downstream reader without violating the "comments explain WHY, not WHAT" rule:

- **`apps/api/plane/bgtasks/notification_task.py`** — JSDoc references tech spec §4.6 NOTIFICATION PIPELINE WORKFLOW
- **`apps/api/plane/bgtasks/webhook_task.py`** — JSDoc references tech spec §4.5 WEBHOOK DELIVERY WORKFLOW
- **`apps/api/plane/bgtasks/cleanup_task.py`** — JSDoc references tech spec §4.12 DATA CLEANUP AND RETENTION WORKFLOWS
- **`apps/api/plane/bgtasks/export_task.py`** — JSDoc references tech spec §4.10 EXPORT PIPELINE WORKFLOW
- **`apps/api/plane/bgtasks/file_asset_task.py`** — JSDoc references tech spec §4.4 FILE UPLOAD WORKFLOW
- **`apps/live/src/extensions/database.ts`** — JSDoc references tech spec §5.2.5.4 real-time collaboration sequence
- **`apps/web/core/store/root.store.ts`** — JSDoc enumerates the sub-store composition (cross-references all other store files)

No table of contents, glossary, or index files are updated (none exist as documentation artifacts in the repository).

## 0.8 Dependency Inventory

### 0.8.1 Documentation Dependencies — Changes

**No dependency changes.** The user's system boundary explicitly forbids modifications to `package.json` files and `requirements.txt` files: "No new dependencies added to any `package.json` or `requirements.txt`." Every existing dependency is retained at its pinned version, and no new packages are added.

| Action | Status |
|--------|--------|
| Additions to `apps/api/requirements/base.txt` | NONE |
| Additions to `apps/api/requirements/local.txt` | NONE |
| Additions to `apps/api/requirements/production.txt` | NONE |
| Additions to `apps/api/requirements/test.txt` | NONE |
| Additions to any `package.json` (root or workspace) | NONE |
| Additions to `pnpm-workspace.yaml` catalog | NONE |
| Modifications to `pnpm-lock.yaml` | NONE |
| Modifications to `apps/api/pyproject.toml` | NONE |
| Modifications to `apps/api/pytest.ini` | NONE |

### 0.8.2 Validation Tooling (Transient, Not Installed Into Manifests)

The four validation gates require two tools. Both are invoked transiently (not pinned into any manifest) so they do not violate the dependency-immutability rule.

| Registry | Tool | Version | Purpose | Invocation |
|----------|------|---------|---------|------------|
| pip (transient) | `pydocstyle` | `6.3.0` | Validation gate 1 — PEP 257 docstring conformance check on `apps/api/plane/` | `pipx run pydocstyle==6.3.0 --convention=pep257 apps/api/plane/ --match-dir='(?!migrations|tests).*'` |
| Already installed | `typescript` (`tsc`) | `5.8.3` (from `pnpm-workspace.yaml` catalog) | Validation gates 2, 3, 4 — type-checking after JSDoc additions | `pnpm --filter=web check:types`, `pnpm --filter=@plane/ui --filter=@plane/editor --filter=@plane/types --filter=@plane/constants check:types`, `pnpm --filter=live check:types` |
| Already installed | `oxlint` | `1.51.0` (root `package.json`) | Format/lint sanity check after JSDoc additions | `pnpm check:lint` |
| Already installed | `oxfmt` | `0.35.0` (root `package.json`) | Format check after JSDoc additions | `pnpm check:format` |

`pydocstyle 6.3.0` is the current stable release on PyPI and supports `--convention=pep257` natively. The transient invocation via `pipx run` (or an ephemeral venv on CI) means it never enters any committed manifest file.

### 0.8.3 Runtime Dependencies Documented (Reference Only, No Changes)

The following dependencies are referenced in the inline documentation being written. They are listed here for traceability — **none are modified, added, or removed**.

| Registry | Package | Version | Purpose in Documentation |
|----------|---------|---------|--------------------------|
| pip | `Django` | `4.2.30` | ViewSet/serializer/model documentation refers to Django LTS semantics (`tech spec §3.2.1`) |
| pip | `djangorestframework` | `3.15.2` | ViewSet documentation refers to DRF `ModelViewSet`, `BaseViewSet`, permission classes, throttle classes |
| pip | `celery` | `5.4.0` | Celery task documentation refers to `@shared_task`, `.delay()`, `.apply_async()` semantics |
| pip | `django_celery_beat` | `2.6.0` | Documentation cites `CELERY_BEAT_SCHEDULE` schedule entries for periodic tasks |
| pip | `psycopg` | `3.3.0` | Documentation references PostgreSQL-specific features (advisory locks, ArrayField) per tech spec §5.2.1.5 |
| pip | `drf-spectacular` | `0.28.0` | Documentation references the conditional OpenAPI surface (not enabled by default) |
| npm | `mobx` | `6.12.0` | Store documentation refers to `makeObservable`, `observable`, `action`, `computed`, `runInAction` |
| npm | `mobx-react` | `9.1.1` | Component documentation refers to `observer` HOC and `useLocalObservable` |
| npm | `mobx-utils` | `6.0.8` | Store documentation references `computedFn` for parameterized derived state |
| npm | `react` | `18.3.1` | Component documentation refers to functional component + hooks model |
| npm | `react-router` | `7.12.0` | Component documentation refers to React Router v7 navigation hooks |
| npm | `@hocuspocus/server` | `2.15.2` | apps/live documentation refers to Hocuspocus extension hooks |
| npm | `yjs` | `^13.6.20` | apps/live documentation refers to Y.Doc, awareness protocol, CRDT auto-merge |
| npm | `@tiptap/core` | `^2.22.3` | @plane/editor documentation refers to TipTap extension API, exposed/overridden/hidden behaviors |
| npm | `zod` | `^3.25.76` | apps/live documentation refers to Zod env schema |
| npm | `ioredis` | `5.7.0` | apps/live documentation refers to Redis caching/session usage (NOT task queueing) |
| npm | `typescript` | `5.8.3` | Validation gates rely on `tsc --noEmit` |

### 0.8.4 Documentation Reference Updates

No internal documentation links are modified. The existing standalone markdown files (`docs/linting.md`, `apps/api/plane/tests/README.md`, `apps/api/plane/utils/openapi/README.md`, `apps/api/plane/utils/exporters/README.md`, `packages/{ui, logger, decorators}/README.md`, `packages/editor/Readme.md`, deployment READMEs, root `README.md`, `CONTRIBUTING.md`) are NOT modified — they are out of the directive scope and untouched by this work.

## 0.9 Coverage and Quality Targets

### 0.9.1 Documentation Coverage Metrics

The user's directive language ("every", "all", "zero undocumented") sets a 100% coverage target on the in-scope surfaces. Baseline coverage from §0.4.2 is near-zero for the documentation contracts required.

| Directive | Surface | Baseline | Target | Validation |
|-----------|---------|----------|--------|------------|
| 1 | apps/api ViewSets (57 classes / 59 files) | 1.7% (1/59 has any docstring) | 100% have class docstring with HTTP/URL/permission/queryset block | pydocstyle `--convention=pep257` zero errors |
| 1 | apps/api Serializers (21 files) | ~0% | 100% have class docstring; every `validate_*`/`to_representation`/`to_internal_value` has method docstring | pydocstyle zero errors |
| 1 | apps/api Models (32 files) | ~0% | 100% have one-sentence business purpose class docstring; all custom Manager/QuerySet methods documented; `CharField(choices)` and `JSONField` have field-level inline comments | pydocstyle zero errors |
| 1 | apps/api Celery tasks (32 task modules) | ~0% | 100% have trigger + side effects + idempotency docstring | pydocstyle zero errors |
| 1 | apps/api permission classes (5 files) | ~0% | 100% (zero undocumented) per Directive 1 explicit success criterion | pydocstyle zero errors |
| 1 | apps/api module-level docstrings (PEP 257 D100 — implicit need from §0.3.2) | ~0% | 100% of in-scope `.py` files | pydocstyle zero errors |
| 2 | apps/web stores (75 files) | 0% module-level JSDoc | 100% have module-level JSDoc with state/actions/computed/consumers | tsc `--noEmit` no new errors |
| 2 | apps/web components in issues/ + cycles/ (~360 files combined) | 0% module-level JSDoc | 100% have module-level JSDoc with purpose/props/stores/side-effects | tsc `--noEmit` no new errors |
| 3 | @plane/ui exports | sporadic JSDoc | 100% of exported components have purpose + props + ARIA/keyboard | tsc `--noEmit` no new errors |
| 3 | @plane/editor public API (8 named exports + transitive star re-exports) | sporadic | 100% of public API surface documented + TipTap exposed/overridden/hidden documented + Y.js doc schema documented | tsc `--noEmit` no new errors |
| 3 | @plane/types exports (95 non-index files) | sporadic | 100% — zero undocumented exported types per directive success criterion | tsc `--noEmit` no new errors |
| 3 | @plane/constants exports (48 non-index files) | sporadic | 100% — every exported constant or enum has consumer + control description (group-level acceptable) | tsc `--noEmit` no new errors |
| 4 | apps/live exported functions, classes, event handlers (43 source files) | ~0% module-level | 100% — document lifecycle traceable through inline docs alone | tsc `--noEmit` no new errors + server starts |

### 0.9.2 Documentation Quality Criteria

**Completeness requirements (binding to directive success criteria):**

- Every ViewSet class lists HTTP methods, URL pattern, request body schema, response shape, permission_classes, and `get_queryset` filter logic when overridden — non-negotiable
- Every Celery task lists trigger, side effects (DB writes, emails, webhooks, cache invalidation), and idempotency — non-negotiable
- Every MobX store has a module-level JSDoc block — non-negotiable
- Every exported type in `@plane/types` has JSDoc — non-negotiable (success criterion: zero undocumented exported types)
- Every event handler in `apps/live` has trigger + state read + state write + persistence side effects — non-negotiable

**Accuracy validation:**

- HTTP methods and URL patterns are extracted from `apps/api/plane/app/urls/*.py` (not invented)
- Permission class names are extracted from the `permission_classes` attribute (not paraphrased)
- Request/response schemas are derived from the associated serializer's `Meta.fields` and field types (not invented)
- MobX observable property names + types are extracted from `makeObservable` blocks and TypeScript class field declarations (not invented)
- Component props are extracted from the `Props` interface or inline parameter type (not invented)
- Celery task triggers are extracted from `CELERY_BEAT_SCHEDULE` (`apps/api/plane/celery.py`) for scheduled tasks; from grep of `.delay()`/`.apply_async()` for explicit invocations; from `@receiver` for signal-triggered tasks (not invented)
- Hocuspocus extension hooks are extracted from the actual hook signatures in `apps/live/src/extensions/*.ts` (not invented)
- Where any of the above cannot be determined from implementation + naming, the `# INTENT UNCLEAR: <observed behavior>` / `// INTENT UNCLEAR: <observed behavior>` flag is used per the user's ambiguity protocol

**Clarity standards:**

- All docstrings/JSDoc blocks are 1–2 sentences for inline comments, longer only for class-level docstrings that must enumerate fields/methods
- Technical terms used are from the codebase or the technical specification (no neologisms)
- Progressive disclosure: module-level summary → class-level summary → method-level detail
- Consistent terminology: "MobX store" not "Redux store"; "Celery task" not "background job"; "Hocuspocus extension" not "WebSocket plugin"; "Y.Doc" not "shared document"; "RabbitMQ" for queue, "Redis" for cache only — per the user's architectural context

**Maintainability:**

- Source citations only where they add value (cross-references to tech spec workflow sections, cross-file references for ViewSet ↔ serializer ↔ model triplets, cross-store references for derived state)
- No date stamps in comments (would create maintenance burden); ownership is implicit via git history
- No verbose prose; comments do NOT narrate self-evident code

### 0.9.3 Example and Diagram Requirements

- **Minimum examples per documented symbol:** Examples are NOT inserted into docstrings/JSDoc by default. The user's documentation standards forbid "verbose prose" and limit inline blocks to 1–2 sentences. Examples are added only when the user-specified intent requires them — none of the four directives requires examples in docstrings.
- **Diagram types:** No mermaid blocks are added inline; the tech spec is the canonical visual reference (see tech spec §5.2.5.4, §5.2.8, §5.2.9, §5.2.10). Cross-references to those tech-spec sections are added where they aid the reader.
- **Code example testing:** Not applicable — no code examples are added.
- **Visual content freshness:** Not applicable — no visual content is added.

## 0.10 Scope Boundaries

### 0.10.1 Exhaustively In Scope

The following file globs are explicitly in scope. Every path uses absolute repository-root notation. Test files, generated files, and lock files are excluded by separate clauses (see §0.10.2).

**Directive 1 — `apps/api` (Python / Django / DRF / Celery):**

- `apps/api/plane/app/views/**/*.py`
- `apps/api/plane/app/serializers/**/*.py`
- `apps/api/plane/app/permissions/**/*.py`
- `apps/api/plane/app/middleware/**/*.py`
- `apps/api/plane/app/urls/**/*.py` (module docstring only — content is route registration)
- `apps/api/plane/db/models/**/*.py`
- `apps/api/plane/db/mixins.py`
- `apps/api/plane/db/management/**/*.py`
- `apps/api/plane/bgtasks/**/*.py`
- `apps/api/plane/api/**/*.py` (external `/api/v1/` surface — same ViewSet documentation shape)
- `apps/api/plane/authentication/**/*.py`
- `apps/api/plane/middleware/**/*.py`
- `apps/api/plane/throttles/**/*.py`
- `apps/api/plane/utils/**/*.py`
- `apps/api/plane/settings/**/*.py`
- `apps/api/plane/license/**/*.py`
- `apps/api/plane/space/**/*.py`
- `apps/api/plane/analytics/**/*.py`
- `apps/api/plane/web/**/*.py`
- `apps/api/plane/__init__.py`, `apps/api/plane/wsgi.py`, `apps/api/plane/asgi.py`, `apps/api/plane/urls.py`, `apps/api/plane/celery.py`

**Directive 2 — `apps/web` (TypeScript / React / MobX):**

- `apps/web/core/store/**/*.store.ts`
- `apps/web/core/store/**/*.ts` (helpers, root.store.ts, aggregator index files inside store/)
- `apps/web/core/components/issues/**/*.tsx`
- `apps/web/core/components/issues/**/*.ts` (non-tsx helpers and hooks within the same subtree)
- `apps/web/core/components/cycles/**/*.tsx`
- `apps/web/core/components/cycles/**/*.ts`

**Directive 3 — `packages/` shared APIs:**

- `packages/ui/src/**/*.{ts,tsx}` (exported components, utilities)
- `packages/editor/src/**/*.{ts,tsx}` (public API surface and supporting modules transitively re-exported via `index.ts`)
- `packages/types/src/**/*.ts` (every exported interface, type alias, enum)
- `packages/constants/src/**/*.ts` (every exported constant or enum)

**Directive 4 — `apps/live` (TypeScript / Node / Hocuspocus / Y.js):**

- `apps/live/src/**/*.ts` (controllers, extensions, services, lib, schema, types, utils, entry points)

**Rule-mandated files for inclusion (from §0.3.2 inferred needs):** None requiring CREATE. All in-scope files exist; transformations are UPDATE-only.

### 0.10.2 Explicitly Out of Scope

Per the user's "OUT OF SCOPE" section and "MUST remain unchanged" boundaries, the following are not modified:

**Apps NOT named in directives:**

- `apps/admin/**` (no documentation added — apps/admin is not listed in any directive; the user's "apps not named above" clause excludes it)
- `apps/space/**` (explicitly listed in user OUT OF SCOPE)
- `apps/proxy/**` (NGINX configuration — not listed in any directive)
- `apps/app/**` (user listed but the directory does NOT exist in the repository; covered by completeness)

**Auto-generated and infrastructure files:**

- `apps/api/plane/db/migrations/**/*.py` (auto-generated Django migrations — 129 files excluded)
- `apps/api/plane/space/migrations/**/*.py` (auto-generated)
- `apps/web/dist/**` (Vite build output)
- `apps/admin/dist/**`, `apps/space/dist/**`, `apps/live/dist/**`
- `packages/*/dist/**` (tsdown build output)
- `**/node_modules/**`
- `**/.turbo/**`
- `pnpm-lock.yaml` (lock file)
- `apps/api/pytest.ini` (test config)
- `apps/api/pyproject.toml` (no refactoring; pydocstyle convention "google" remains as-is)
- `tsconfig.json` files
- `turbo.json`
- `pnpm-workspace.yaml`
- `vite.config.ts`, `tsdown.config.ts`, `postcss.config.js`, `vitest.config.ts` (config files — not source modules)
- `Dockerfile.*` files
- `setup.sh`, `docker-compose-local.yml`, `docker-compose.yml`
- `.env.example` files (system boundary: no .env files created or modified)
- `.env` files (system boundary: no .env files created or modified)

**Test files:**

- `apps/api/plane/tests/**/*.py` (37 files)
- `apps/api/**/test_*.py`
- `apps/live/tests/**/*.ts`
- `apps/web/**/*.{test,spec}.{ts,tsx}`
- `packages/*/**/*.{test,spec,stories}.{ts,tsx}` (Storybook stories also excluded)

**Third-party vendored code:**

- Any file under `**/node_modules/`
- Any file in the repo that is recognizably copied from an upstream package without modification (none detected in current repository state)

**Documentation files NOT being modified:**

- `README.md` (root) — unchanged
- `CONTRIBUTING.md` — unchanged
- `CODE_OF_CONDUCT.md` — unchanged
- `SECURITY.md` — unchanged
- `AGENTS.md` — unchanged
- `docs/linting.md` — unchanged
- `packages/{ui, logger, decorators}/README.md` — unchanged
- `packages/editor/Readme.md` — unchanged (and NOT renamed to `README.md`; system boundary forbids renaming)
- `apps/api/plane/tests/README.md`, `apps/api/plane/tests/TESTING_GUIDE.md` — unchanged
- `apps/api/plane/utils/openapi/README.md` — unchanged
- `apps/api/plane/utils/exporters/README.md` — unchanged
- `deployments/**/README.md` — unchanged
- `apps/space/README.md` — unchanged (apps/space out of scope)

**Behavioral constraints (verbatim from user's system boundaries):**

- All logic, imports, component structure, and runtime behavior across all apps and packages MUST remain unchanged
- No `.env` files created or modified
- No new dependencies added to any `package.json` or `requirements.txt`
- No refactoring, renaming, or restructuring of any kind

## 0.11 Execution Parameters

### 0.11.1 Documentation-Specific Instructions

| Parameter | Value | Source |
|-----------|-------|--------|
| Default documentation format (Python) | PEP 257 docstrings inside `"""..."""` triple-quoted strings | User Documentation Standards (§0.2.3) |
| Default documentation format (TypeScript/JavaScript) | JSDoc `/** ... */` blocks | User Documentation Standards (§0.2.3) |
| Module-level docstring style (Python) | One-line summary followed by optional multi-line elaboration; placed AFTER copyright header, BEFORE imports | PEP 257 + repository copyright header convention |
| Module-level JSDoc style (TypeScript) | Block JSDoc placed AFTER the copyright `/** SPDX-License-Identifier */` header, BEFORE imports | Repository convention observed in `apps/web/core/store/cycle.store.ts` lines 1-5 |
| Inline comment philosophy | Comments explain WHY, not WHAT. Max 1–2 sentences per inline block. No verbose prose. | User Documentation Standards (§0.2.3) |
| Ambiguity flag (Python) | `# INTENT UNCLEAR: <observed behavior>` | User Documentation Standards (§0.2.3) |
| Ambiguity flag (TypeScript) | `// INTENT UNCLEAR: <observed behavior>` | User Documentation Standards (§0.2.3) |
| Documentation generator | NONE — output is in-place inline documentation only | Repository has no mkdocs/docusaurus/sphinx config |
| Source citation format (when used) | Inline `Source: <path>:<line>` or "See tech spec §X.Y.Z" | Selectively applied; only where it adds value |

### 0.11.2 Build, Validation, and Preview Commands

The following commands are part of the validation gate execution sequence:

**Validation Gate 1 (Directive 1 — apps/api PEP 257 conformance):**

```bash
# Transient invocation - pydocstyle is NOT added to requirements

pipx run pydocstyle==6.3.0 --convention=pep257 \
  --match-dir='(?!migrations|tests).*' \
  apps/api/plane/
# Expected: zero errors

#### Alternative if pipx unavailable - ephemeral venv

python3 -m venv /tmp/pydocstyle-venv
/tmp/pydocstyle-venv/bin/pip install pydocstyle==6.3.0
/tmp/pydocstyle-venv/bin/pydocstyle --convention=pep257 \
  --match-dir='(?!migrations|tests).*' \
  apps/api/plane/
```

**Validation Gate 2 (Directive 2 — apps/web type-check):**

```bash
pnpm --filter=web check:types
# Expected: same error count as pre-change baseline (no new errors introduced by JSDoc)

```

**Validation Gate 3 (Directive 3 — packages type-check):**

```bash
pnpm --filter=@plane/ui check:types
pnpm --filter=@plane/editor check:types
pnpm --filter=@plane/types check:types
pnpm --filter=@plane/constants check:types
# Expected: same error count as pre-change baseline for each

```

**Validation Gate 4 (Directive 4 — apps/live type-check + startup):**

```bash
pnpm --filter=live check:types
# Expected: same error count as pre-change baseline

#### Server start smoke test (requires data plane up — postgres, redis, mq, minio)

docker compose -f docker-compose-local.yml up -d plane-db plane-redis plane-mq plane-minio
pnpm --filter=live start &
SERVER_PID=$!
sleep 10
curl -sf http://localhost:3100/health || (echo "SERVER FAILED TO START" && exit 1)
kill $SERVER_PID
# Expected: server reaches healthy state without TypeScript errors

```

**Cross-cutting format and lint sanity checks:**

```bash
pnpm check:lint    # OxLint across all packages and apps
pnpm check:format  # oxfmt format check
```

### 0.11.3 Style Guide

- **Python style guide:** PEP 257 docstring conventions (verbatim from user's validation gate 1 specification: `--convention=pep257`). Note that `apps/api/pyproject.toml` line 70 declares `[tool.ruff.lint.pydocstyle] convention = "google"` — this is left unchanged (system boundary forbids restructuring) and is irrelevant because validation is performed by standalone `pydocstyle`, not by ruff.
- **TypeScript style guide:** JSDoc as understood by `tsc 5.8.3`. No `@example` blocks containing TypeScript code unless they round-trip through `tsc --noEmit` cleanly.
- **Existing repository conventions to preserve:** Copyright headers (`SPDX-License-Identifier: AGPL-3.0-only`) appearing as `#` for Python and `/** … */` for TypeScript MUST remain unchanged.

### 0.11.4 Documentation Validation Beyond Gates

In addition to the four mandatory validation gates, the following sanity checks are performed:

- **Lint sanity:** `pnpm check:lint` passes with no new warnings beyond the existing `--max-warnings` thresholds declared in each `package.json`
- **Format sanity:** `pnpm check:format` passes (no formatting changes introduced by documentation additions)
- **Import unchanged:** `git diff` shows no `import` line additions/removals/reorderings in any modified file (system boundary: "no new dependencies" implies no new imports either)
- **Behavior unchanged:** No statement-level code edits, only documentation insertions. The runtime behavior must be byte-identical before/after at the bytecode level for Python files (verifiable via `python -m compileall` byte-comparison if needed)

## 0.12 Rules for Documentation

### 0.12.1 Documentation-Specific Rules (Preserved Verbatim From User Input)

The following rules are reproduced exactly as the user provided them. They are binding on every documentation edit produced by this work.

> **TypeScript/JavaScript:** JSDoc (`/** ... */`) on all exported functions, classes, interfaces, and non-trivial constants
>
> **Python/Django:** PEP 257 docstrings on all classes, methods, and module-level definitions
>
> **Comment philosophy:** Comments explain WHY, not WHAT. No narration of self-evident code.
>
> **Comment length:** Max 1–2 sentences per inline comment block. No verbose prose.
>
> **No markdown boilerplate** beyond section headers and parameter tables in module READMEs
>
> **Ambiguity handling:** Where intent cannot be inferred from implementation + naming, flag with `# INTENT UNCLEAR: <observed behavior>` (Python) or `// INTENT UNCLEAR: <observed behavior>` (TS) — do not guess

### 0.12.2 Architectural Context Rules (Verbatim — Must Inform Every Documentation Decision)

> - **Monorepo structure:** TypeScript frontend (`apps/web`, `apps/live`) + Python backend (`apps/api`) + shared packages (`packages/`)
> - **Frontend state:** MobX exclusively — stores injected via React context, not Redux. Document stores as the source of truth for component behavior.
> - `@plane/editor`: Internal TipTap wrapper — treat as first-party code. Document its API surface as owned code, not a third-party abstraction.
> - **Startup order:** `migrator` container runs Django migrations before API services start. Note this in any module that depends on schema state at boot.
> - **Async infrastructure:** Celery workers consume tasks from RabbitMQ. Redis = caching and session only. Document this distinction wherever task queuing or caching is involved.
> - **Frontend env vars:** `NEXT_PUBLIC_*` vars are baked in at build time. Flag this in any frontend config file where runtime vs. build-time resolution matters.

**Resolution note for the env-var rule:** Per §0.2.6 conflict C3, the current `apps/web` is React Router v7 + Vite, and browser-bundled env vars use the `VITE_*` prefix, not `NEXT_PUBLIC_*`. The user's semantic intent (flag build-time vs. runtime resolution) is honored by documenting the build-time-baked nature of `VITE_*` env vars; the literal prefix substitution is required to ground the rule in repository reality.

### 0.12.3 System Boundary Rules (Verbatim — Must NEVER Be Violated)

> **MUST remain unchanged:**
> - All logic, imports, component structure, and runtime behavior across all apps and packages
> - No `.env` files created or modified
> - No new dependencies added to any `package.json` or `requirements.txt`
> - No refactoring, renaming, or restructuring of any kind
>
> **OUT OF SCOPE:**
> - `apps/space`, `apps/app`, or any apps not named above
> - Auto-generated files (migrations, compiled outputs, lock files)
> - Third-party vendored code
> - Test files (`.spec.ts`, `test_*.py`)
>
> **Ambiguity protocol:** Flag, do not invent. Use the designated flag format and continue.

### 0.12.4 Implementation Sequence Rule (Verbatim)

> Execute in priority order. Complete and validate each directive before proceeding to the next.
>
> 1. `apps/api` (Directive 1) — highest consumer impact
> 2. `apps/web` stores and components (Directive 2)
> 3. `packages/` shared APIs (Directive 3)
> 4. `apps/live` real-time layer (Directive 4)

### 0.12.5 Per-Directive Success Criteria (Verbatim — Acceptance Bar)

> **Directive 1 — Success criteria:** Every public ViewSet, serializer, model, and Celery task has a docstring. Zero undocumented permission classes.
>
> **Directive 1 — Validation gate 1:** Confirm zero `pydocstyle` errors on `apps/api` at `--convention=pep257` after documentation is applied.
>
> **Directive 2 — Success criteria:** Every store file and every component file in the two named directories has a module-level JSDoc block. All observable properties and actions are documented.
>
> **Directive 2 — Validation gate 2:** Confirm `tsc --noEmit` passes with no new type errors introduced by JSDoc additions.
>
> **Directive 3 — Success criteria:** Every export in each package's public API surface (`index.ts` or declared `exports` in `package.json`) is documented. Zero undocumented exported types.
>
> **Directive 3 — Validation gate 3:** Confirm `tsc --noEmit` passes across all four packages after documentation is applied.
>
> **Directive 4 — Success criteria:** Every exported function, class, and event handler in `apps/live` is documented. The document lifecycle (connect → edit → persist → disconnect) is traceable through inline documentation without reading the implementation.
>
> **Directive 4 — Validation gate 4:** Confirm no new TypeScript errors introduced. Confirm the server starts without error after documentation changes.

### 0.12.6 Derived Operational Rules (Inferred from User's Constraints)

These rules are not literally in the user's prompt but follow directly from the constraints above. They are enforced as if they were verbatim:

- **No new files of any kind.** Every change is an UPDATE to an existing file (CREATE mode produces a new file, which is restructuring).
- **No reordering of existing imports.** "All logic, imports … MUST remain unchanged" is interpreted strictly: import order, grouping, and whitespace among imports are preserved.
- **No formatting churn.** Documentation additions must not trip `oxfmt` reflows on unrelated lines. JSDoc and docstrings are placed at insertion points that do not require surrounding code reflow.
- **No silent placeholder docstrings.** A docstring of `"""TODO."""` or `/** TODO */` is rejected — either the documentation is substantive or the ambiguity flag is used.
- **pydocstyle exclusions:** The validation gate command is `pydocstyle --convention=pep257 apps/api/plane/ --match-dir='(?!migrations|tests).*'` so that auto-generated migrations and test fixtures (out of scope) are not evaluated. No new pydocstyle configuration file is committed (system boundary: no new files).
- **JSDoc compatibility with `tsc`:** Every JSDoc `@param` / `@returns` / `@type` annotation must round-trip through `tsc --noEmit` with no new errors. Where a type cannot be expressed in JSDoc, the JSDoc block omits the type and refers the reader to the inline TypeScript annotation.
- **MobX action wrapper neutrality:** JSDoc on `@action` methods describes the mutation; it does not change the `action` / `action.bound` decoration. Existing wrapper choices (`runInAction`, `flow`) are preserved.
- **DRF method documentation:** Where a ViewSet inherits default `list` / `create` / `retrieve` / `update` / `destroy` from `ModelViewSet` and does not override them, the class-level docstring's "HTTP methods" block enumerates them as inherited; individual method docstrings are not added because no method exists to attach them to (preserves "no new code structure").

## 0.13 References

### 0.13.1 Citation Discipline

Every claim in this Agent Action Plan about the existing system is grounded to a concrete repository file (with line range, key path, or section locator) or to an explicitly cited tech spec section. Where a claim is derived from inspection rather than a single literal source, it is marked `[inferred — no direct source]`.

### 0.13.2 Repository File Citations

| Claim | Source Location |
|-------|-----------------|
| Node version pinned 22.18.0 | `.mise.toml:L1-L2` |
| pnpm 10.32.1, root `engines.node >=22.18.0`, no documentation generator deps | `package.json:L1-L80` |
| Setup script copies .env templates and runs `pnpm install` | `setup.sh:L1-L95` |
| Workspaces include `apps/*` and `packages/*` (excluding `apps/api` and `apps/proxy`) | `pnpm-workspace.yaml:L1-L6` |
| Django 4.2.30, DRF 3.15.2, Celery 5.4.0, psycopg 3.3.0, redis 5.0.4 | `apps/api/requirements/base.txt:L1-L40` |
| Python 3.12.5-alpine runtime | `apps/api/Dockerfile.dev:L1` |
| Ruff pydocstyle convention set to "google" | `apps/api/pyproject.toml:L69-L71` |
| pydocstyle is NOT in requirements (transient invocation needed) | `apps/api/requirements/base.txt`, `apps/api/requirements/local.txt`, `apps/api/requirements/production.txt`, `apps/api/requirements/test.txt` |
| BaseViewSet hierarchy: TimezoneMixin + ReadReplicaControlMixin + ModelViewSet + BasePaginator | `apps/api/plane/app/views/base.py:L1-L55` |
| Sample ViewSet permission class declaration | `apps/api/plane/app/views/issue/link.py:L27` (`permission_classes = [ProjectEntityPermission]`) |
| Cycle store uses MobX `makeObservable`, `observable`, `action`, `computed`, `runInAction`, plus `computedFn` from `mobx-utils` | `apps/web/core/store/cycle.store.ts:L1-L30` |
| @plane/ui re-exports 33 sub-modules from src/index.ts | `packages/ui/src/index.ts:L1-L42` |
| @plane/editor named + star exports include 4 editor components + helpers + constants + types + TrailingNode | `packages/editor/src/index.ts:L1-L25` |
| @plane/types exports 95 non-index .ts files | `packages/types/src/**/*.ts` enumeration |
| @plane/constants re-exports 48 sub-modules from src/index.ts | `packages/constants/src/index.ts:L1-L48` |
| apps/live Hocuspocus singleton manager | `apps/live/src/hocuspocus.ts:L1-L30` |
| apps/live server orchestration with Express + expressWs + helmet + cors + compression + @plane/decorators | `apps/live/src/server.ts:L1-L30` |
| apps/live extensions list (database, force-close-handler, logger, redis, title-sync) | `apps/live/src/extensions/` directory listing |
| docs/ contains only linting.md (no static site generator config) | `docs/` directory listing |
| AGENTS.md states MobX stores live in `packages/shared-state` and per-app `core/store/` | `AGENTS.md:L1-L25` |

### 0.13.3 Tech Spec Section Citations

| Claim | Tech Spec Section |
|-------|--------------------|
| Plane components: API, Web, Admin, Space, Live, Migrator, Workers, Beat | §1.2.2.2 Major System Components |
| Frontend stack is React Router v7 + Vite (NOT Next.js); browser env vars use `VITE_*` not `NEXT_PUBLIC_*` | §1.2.2.3 Core Technical Approach + §5.2.2.2 Web Frontend |
| MobX 6.12.0 + mobx-react 9.1.1 + mobx-utils 6.0.8 + swr 2.2.4 + axios 1.15.2 | §3.2.5 State Management & Data Fetching |
| Celery 5.4.0 is the spine of every cross-request workflow; routes through RabbitMQ | §3.2.2 Asynchronous Processing Stack |
| Beat schedule: 00:00 UTC `deletion_task.hard_delete`, 02:00 UTC `file_asset_task`, others | §3.2.2 + §4.9 Background Task Scheduling |
| apps/live is Hocuspocus 2.15.2 + Yjs 13.6.20 + Express 4.22.0 + ioredis 5.7.0 | §3.2.6 Real-Time Collaboration Stack |
| @plane/editor is a custom TipTap 2.22.3 wrapper treated as internal infrastructure | §3.2.7 Editor Infrastructure |
| @plane/ui is the legacy component library; @plane/propel is the modern design system (the directive scopes to @plane/ui only) | §3.2.8 Design System & UI Component Libraries |
| ViewSet permission classes attribute usage | §5.2.1.4 Key Interfaces and APIs |
| apps/api Internal Sub-Packages (`plane.app`, `plane.api`, `plane.authentication`, `plane.bgtasks`, `plane.db`, etc.) | §5.2.1.3 Internal Sub-Packages |
| MobX store organization across `core/store/` with sub-packages (`issue/`, `pages/`, `user/`, etc.) | §5.2.2.4 State Management |
| apps/live source layout (start.ts, server.ts, hocuspocus.ts, env.ts, redis.ts, extensions/, services/, controllers/, lib/) | §5.2.5.3 Source Layout |
| Real-time collaboration sequence (10-second debounce, HTML→binary backfill) | §5.2.5.4 Real-Time Collaboration Sequence |
| Webhook delivery flow with HMAC-SHA256 + 5-retry backoff + deactivation | §5.2.10 Webhook Delivery Sequence |
| Migrator container blocks API startup | §5.2.8 Bootstrap State Diagram |
| Cycles, modules, views, pages domain capability mapping | §1.2.2.1 Primary System Capabilities |

### 0.13.4 Search Log (Repository Exploration Appendix)

The following file system enumerations and content reads were performed during context gathering:

**Directory listings:**

- Root: `/tmp/blitzy/blitzy-makeplane/blitzy-working-branch_bed8cb/`
- `apps/`, `packages/` listings
- `apps/api/`, `apps/api/plane/`, `apps/api/plane/app/`, `apps/api/plane/app/views/`, `apps/api/plane/app/serializers/`, `apps/api/plane/app/permissions/`, `apps/api/plane/db/models/`, `apps/api/plane/bgtasks/`, `apps/api/requirements/`
- `apps/web/`, `apps/web/core/`, `apps/web/core/store/`, `apps/web/core/store/issue/`, `apps/web/core/components/`, `apps/web/core/components/issues/`, `apps/web/core/components/cycles/`
- `apps/live/`, `apps/live/src/`, including controllers, extensions, services, lib, schema, types, utils
- `packages/ui/`, `packages/editor/`, `packages/types/`, `packages/constants/` (and their `src/` trees)
- `docs/`

**File reads:**

- `.mise.toml`, `package.json` (root), `pnpm-workspace.yaml`, `setup.sh`, `AGENTS.md`
- `apps/api/requirements/{base, local, test, production}.txt`, `apps/api/pyproject.toml`, `apps/api/Dockerfile.dev`
- `apps/api/plane/app/views/base.py` (first 50 lines), `apps/api/plane/app/views/issue/link.py` (lines around 27 for permission_classes verification), `apps/api/plane/app/serializers/issue.py` (first 20 lines), `apps/api/plane/bgtasks/notification_task.py` (first 20 lines)
- `apps/web/core/store/cycle.store.ts` (first 30 lines)
- `apps/live/src/server.ts` (first 30 lines), `apps/live/src/hocuspocus.ts` (first 30 lines)
- `packages/ui/src/index.ts`, `packages/editor/src/index.ts`, `packages/constants/src/index.ts`
- `packages/ui/package.json`, `packages/editor/package.json`, `packages/types/package.json`, `packages/constants/package.json`
- `apps/live/package.json` (first 40 lines)

**Tech spec sections retrieved:**

- §1.2 SYSTEM OVERVIEW
- §3.2 FRAMEWORKS & LIBRARIES
- §5.2 COMPONENT DETAILS
- §7.2 CORE UI TECHNOLOGIES

**Counts derived from enumeration:**

- 57 ViewSet files / 21 serializer files / 32 model files / 32 Celery task files / 5 permission files in apps/api
- 75 store files in apps/web/core/store/
- 318 component files in apps/web/core/components/issues/
- 42 component files in apps/web/core/components/cycles/
- 78 component files in packages/ui/src/
- 225 source files in packages/editor/src/
- 116 type files in packages/types/src/ (95 non-index)
- 56 constants files in packages/constants/src/ (48 non-index)
- 43 source files in apps/live/src/

**No `.blitzyignore` files found in the repository** (searched via `find . -name ".blitzyignore"`).

### 0.13.5 Attachments and External References

- **User-provided attachments:** None
- **User-provided Figma URLs:** None
- **User-provided documentation links:** None
- **User-specified rules from project rules array:** None — the project rules array `[]` is empty
- **External references consulted:** None (all required context derived from repository inspection and tech spec sections)

### 0.13.6 Conflict Resolution Log

The following conflicts between user input and repository reality were identified during analysis. Each was resolved per §0.2.6.

| # | Conflict | Resolution Reference |
|---|----------|----------------------|
| C1 | `apps/web/core/stores/` vs. `apps/web/core/store/` | §0.2.6 C1 — bind directive to actual path `apps/web/core/store/` |
| C2 | `apps/app` listed out-of-scope but does not exist | §0.2.6 C2 — clause "or any apps not named above" covers all unlisted apps (admin, proxy) |
| C3 | `NEXT_PUBLIC_*` env vars vs. `VITE_*` env vars | §0.2.6 C3 — preserve semantic intent (build-time baked), substitute repository's actual prefix |
| C4 | `pydocstyle --convention=pep257` vs. `[tool.ruff.lint.pydocstyle] convention = "google"` | §0.2.6 C4 — run standalone pydocstyle transiently; do not modify pyproject.toml or requirements |

### 0.13.7 Inferred Claims (Marked Per Citation Discipline)

The following claims in this AAP are inferences from observed code patterns + standard framework semantics; they are flagged for downstream verification:

- "Celery tasks in `apps/api/plane/bgtasks/notification_task.py` are NON-idempotent" `[inferred — to be verified per-task during documentation writing]`
- "MobX store consumers in components/cycles/ and components/issues/ subtrees" `[inferred from store import grep — to be validated against actual import sites during documentation]`
- "Y.js conflict resolution: CRDT auto-merge with no explicit resolver" `[inferred — standard Yjs semantics; to be verified against `apps/live/src/extensions/database.ts` implementation]`
- "DRF default `list`/`create`/`retrieve`/`update`/`destroy` are inherited where not overridden" `[inferred from DRF `ModelViewSet` base class semantics]`

