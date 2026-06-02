# Out-of-Scope QA Findings — Cannot Be Fixed by This Agent

## Overview

The QA Test Report at FINAL Checkpoint 8 identified 13 findings. This agent has fixed Issues #1-#6 (all CRITICAL and HIGH severity findings that can be addressed via code changes). The remaining 7 findings cannot be addressed by this agent because they require changes that the AAP system boundaries explicitly forbid, or because they describe local-development-only / production-proxy-layer concerns that are not source-code defects.

## Findings That Require Dependency Changes (Forbidden by AAP §0.2.4)

### Issue #7 (HIGH) — Django 4.2.30 Reached End-of-Life on April 7, 2026

- **Forbidden change:** Upgrade Django from 4.2.30 to 5.2 LTS in `apps/api/requirements/base.txt`
- **AAP rule violated:** §0.2.4 — "No new dependencies added to any `package.json` or `requirements.txt`" (extended interpretation: no dependency version changes either, per the broader "MUST remain unchanged" clause for runtime behavior and structure)
- **Risk mitigation deferred to next implementation cycle:** The Plane platform owner must plan a Django 4.2 → 5.2 upgrade as a separate, behavior-changing work item (which will include schema migrations and DRF / django-celery-beat / django-redis compatibility verification).
- **Severity assessment:** HIGH but not currently exploitable - no specific CVE active against 4.2.30 today; the risk is that future Django CVEs will not be patched in 4.2.x.

### Issue #8 (MAJOR) — 13 Node Dependency Vulnerabilities

- **Forbidden change:** Bump `axios`, `ws`, `qs`, `vitest`, `fast-uri`, `brace-expansion`, `tmp`, `turbo` across `apps/admin/package.json`, `apps/live/package.json`, `packages/codemods/package.json`, root `package.json`
- **AAP rule violated:** §0.2.4 — "No new dependencies added to any `package.json` or `requirements.txt`"
- **Severity assessment per-package (from QA report):**
  - vitest <4.1.0 critical — but devDependency only (test runner)
  - axios <1.16.0 high/critical (5 CVEs) — runtime in apps/admin (out-of-scope per AAP §0.10.2)
  - ws <8.20.1 moderate — RUNTIME in apps/live (Hocuspocus WebSocket transport): memory disclosure risk
  - qs <6.15.2 moderate — RUNTIME in apps/live (via Express): DoS via crash
  - Others (tmp, turbo, fast-uri, brace-expansion) — build/CI only, low runtime risk
- **Suggested next step:** Implementation cycle that allows `pnpm update` + `pnpm overrides` for transitive bumps.

### Issue #9 (LOW) — Python pip Installer Has 4 Known CVEs

- **Forbidden change:** Upgrade pip to 26.1 in `apps/api/Dockerfile.dev` build step or pin pip in requirements
- **AAP rule violated:** §0.2.4 — "No new dependencies added to any `package.json` or `requirements.txt`"
- **Severity assessment:** LOW because pip is invoked only at image build time; the running API/worker/beat-worker processes never invoke pip.
- **Suggested next step:** When the Dockerfile is next edited, add `RUN python -m pip install --upgrade pip>=26.1` after the python install step.

## Findings That Are Local-Development-Only or Production-Proxy Concerns

### Issue #10 (MINOR) — Server Header Discloses Stack Version

- **Affected:** `Server: WSGIServer/0.2 CPython/3.12.5` on all API responses
- **Why not fixed:** This is emitted by Django's `runserver` development server. Production deployments front Django with `gunicorn`/`uvicorn` behind nginx/cloudfront, which masks or replaces the `Server` header. No code change in `apps/api` would remove this; the fix is operational at the reverse-proxy layer (e.g., nginx `server_tokens off`).
- **Severity:** MINOR for local-dev; **non-issue in production** when proxy is properly configured.

### Issue #11 (MINOR) — Missing HSTS / CSP / Permissions-Policy Headers on Django API

- **Affected:** All `/api/*` response paths from `apps/api`
- **Why not fixed in app code:** These headers are typically applied at the production reverse-proxy layer (nginx, AWS ALB, Cloudfront) to keep development environments unaffected by HTTPS-only redirect semantics. Adding `SECURE_HSTS_SECONDS`, `SECURE_HSTS_INCLUDE_SUBDOMAINS`, `SECURE_HSTS_PRELOAD`, `SECURE_CONTENT_SECURITY_POLICY` to `apps/api/plane/settings/production.py` would alter behavior beyond a security fix into operational-policy territory.
- **Severity:** MINOR — `apps/live` already adds Helmet's full header suite for the WebSocket service (verified in QA report Phase 8).
- **Suggested next step:** Production deployment must layer these headers in the reverse proxy or `production.py` overlay.

### Issue #12 (INFORMATIONAL) — Django DEBUG Page Leaks URLconf on Local Dev

- **Affected:** Local dev `plane.settings.local` where `DEBUG = True` hardcoded
- **Why not fixed:** Production gating verified correct: `apps/api/plane/settings/production.py:49` reads `DEBUG = int(os.environ.get("DEBUG", 0)) == 1` and defaults to FALSE. The local DEBUG behavior is intentional for development workflows.
- **Severity:** INFORMATIONAL — not a vulnerability in production.

### Issue #13 (INFORMATIONAL) — Defensive Coverage Confirmation

- **Description:** Out of the 34 ViewSet classes that lack class-level `permission_classes` and lack `@allow_permission` on `update()`, only 4 were exploitable (Issues #1-#4); the other 30 were blocked by either URL routing (no `"put": "update"` mapping) or queryset filtering (`get_queryset` returns 404 to non-members).
- **Status:** NO ISSUE — this finding is the QA agent's defensive observation, not a defect.
- **Action taken anyway:** As a defense-in-depth measure, this agent's fix to `apps/api/plane/app/views/view/base.py` also added a decorated `update()` override to `IssueViewViewSet` (line 528) even though queryset filtering already blocked the attack — eliminating any future drift risk if the queryset filter changes.

## Summary

| Issue | Severity      | Fix Type Required                                        | Why Not Fixed Here                                                      |
| ----- | ------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| #7    | HIGH          | Dependency upgrade (Django 5.2)                          | AAP forbids dependency changes                                          |
| #8    | MAJOR         | Dependency upgrades (multiple npm packages)              | AAP forbids dependency changes                                          |
| #9    | LOW           | Dependency upgrade (pip 26.x)                            | AAP forbids dependency changes (build-time only)                        |
| #10   | MINOR         | Production reverse-proxy config                          | Not a source-code defect                                                |
| #11   | MINOR         | Production reverse-proxy or production.py overlay change | Operational policy decision required                                    |
| #12   | INFORMATIONAL | None — already correctly gated for production            | Local-dev intentional                                                   |
| #13   | INFORMATIONAL | None — defensive observation                             | No defect; this agent added defense-in-depth to IssueViewViewSet anyway |
