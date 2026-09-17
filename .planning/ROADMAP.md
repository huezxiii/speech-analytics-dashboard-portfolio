# Roadmap: Speech Analytics & Customer Intelligence Dashboard (Sanitized Portfolio Edition)

## Overview

This roadmap executes a 1:1 functional clone and corporate sanitization of the reference speech analytics dashboard into a clean, public portfolio repository. The journey progresses systematically from foundational asset sanitization and synthetic data generation, through the companion desktop preprocessor, the 4-tab web dashboard, and the programmatic Power BI (.pbip / TMDL) generator, concluding with comprehensive gate verification, byte-parity testing, and documentation.

## Phases

- [x] **Phase 1: Project Scaffolding & Corporate Sanitization Core** - Base repository structure, sanitization tokens, synthetic data generator, and vendor assets.
- [ ] **Phase 2: Companion Desktop Preprocessor & Parity Testing** - Pure Python transformation core, CLI/GUI pywebview shell, PyInstaller spec, and unit/parity test suites.
- [ ] **Phase 3: Client-Side Web Dashboard & Analytics** - Sanitized 4-tab dashboard UI, Chart.js visualizations, IndexedDB caching, ARIA accessibility, and NLP query sandbox.
- [ ] **Phase 4: Power BI Export Engine & Structural Gates** - Programmatic TMDL/PBIR generator with duration-weighted DAX, drill-through page, and automated verification checks.
- [ ] **Phase 5: Verification, Golden Parity Audit & Showcase Docs** - End-to-end testing, zero-leak sanitization audit, and production portfolio documentation.

## Phase Details

### Phase 1: Project Scaffolding & Corporate Sanitization Core
**Goal**: Establish clean project skeleton, brand tokens, third-party vendor dependencies, and anonymized synthetic transcript generator.
**Depends on**: Nothing (first phase)
**Requirements**: SAN-01, SAN-02, SAN-03, MOCK-01, MOCK-02
**Success Criteria** (what must be TRUE):
  1. No proprietary company names (Dexcom), logos, employee names, or internal incident references exist in initial assets.
  2. CSS design system defines generic brand tokens (`--brand-primary`, `--brand-accent`).
  3. `generate_mock_data.py` executes successfully to produce realistic, anonymized call records adhering to the 15-column schema.
  4. Third-party vendor assets (PapaParse, JSZip, Chart.js) are properly vendored and localized.
**Plans**: 2 plans

Plans:
- [x] 01-01: Establish vendor dependencies, theme variables, and package.json/pytest environment.
- [x] 01-02: Implement sanitized synthetic call data generator (`generate_mock_data.py`).

### Phase 2: Companion Desktop Preprocessor & Parity Testing
**Goal**: Deliver desktop preprocessor application with clear Core/Shell separation, unit tests, and PyInstaller build spec.
**Depends on**: Phase 1
**Requirements**: PREP-01, PREP-02, PREP-03, PREP-04, TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. `preprocess_core.py` validates and transforms raw CSV inputs into the 15-column schema with zero GUI dependencies.
  2. `preprocess_cli.py` supports headless batch transformation.
  3. `gui/app.py` runs `pywebview` with raw vs. transformed preview and diff highlighting.
  4. Unit tests (`test_core.py`) and byte-parity golden tests (`test_parity.py`) pass with 100% test coverage on transformation logic.
  5. `build/preprocessor.spec` defines single-file executable build with Evergreen WebView2 detection.
**Plans**: 2 plans

Plans:
- [ ] 02-01: Implement `preprocess_core.py`, `preprocess_cli.py`, and test suite (`test_core.py`, `test_parity.py`).
- [ ] 02-02: Implement `gui/app.py`, local GUI web assets, and `build/preprocessor.spec`.

### Phase 3: Client-Side Web Dashboard & Analytics
**Goal**: Build the zero-auth, offline-first 4-tab speech analytics dashboard with Chart.js and IndexedDB persistence.
**Depends on**: Phase 2
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06
**Success Criteria** (what must be TRUE):
  1. `index.html` loads cleanly offline, parsing raw/preprocessed CSVs client-side via PapaParse.
  2. Executive Summary Hub renders KPI cards, dual-axis volume/sentiment chart, category distribution, and incident banner.
  3. Ops & QA Command displays silence scatter plot, queue leaderboard, conversational balance, and silence histogram.
  4. Compliance & Coaching renders adherence gauge, 5-axis radar chart, stress curve, and empathy correlation.
  5. NLP Query Sandbox parses Boolean/`W/15` proximity queries with real-time Precision/Recall calculations and snippet highlighting.
  6. All charts feature hidden ARIA-accessible data tables.
**Plans**: 3 plans

Plans:
- [ ] 03-01: Implement dashboard markup structure (`index.html`) and KPI computation engine (`stats.js`).
- [ ] 03-02: Implement Chart.js visualizers, color palettes, and ARIA data tables (`charts.js`).
- [ ] 03-03: Implement NLP query parser, proximity search engine, and precision/recall evaluator.

### Phase 4: Power BI Export Engine & Structural Gates
**Goal**: Implement programmatic client-side Power BI project generator (.pbip / TMDL) with automated verification gates.
**Depends on**: Phase 3
**Requirements**: PBI-01, PBI-02, PBI-03, TEST-03
**Success Criteria** (what must be TRUE):
  1. `powerbi.js` generates valid `.pbip` zip archive containing TMDL models and PBIR report pages directly in-browser.
  2. Export includes duration-weighted DAX measures and call detail drill-through target page.
  3. Structural gate checks (`check:pbi`, `check:date`, `check:weighted`, `check:drill`, `check:columns`) execute and pass cleanly.
**Plans**: 2 plans

Plans:
- [ ] 04-01: Implement `powerbi.js` semantic model (TMDL) and report definitions (PBIR).
- [ ] 04-02: Implement Power BI gate verification scripts and wire `package.json` test scripts.

### Phase 5: Verification, Golden Parity Audit & Showcase Docs
**Goal**: Perform final end-to-end sanitization verification, parity checks, and assemble the portfolio showcase README.
**Depends on**: Phase 4
**Requirements**: DOC-01
**Success Criteria** (what must be TRUE):
  1. Automated string scanning confirms zero instances of proprietary names or employee PII.
  2. All test suites (`pytest`, npm gate scripts) pass deterministically.
  3. `README.md` clearly documents architecture, technical decisions, and local setup for prospective evaluators.
**Plans**: 1 plan

Plans:
- [ ] 05-01: Run full sanitization audit, end-to-end verification, and write comprehensive portfolio `README.md`.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Project Scaffolding & Corporate Sanitization Core | 2/2 | Completed | 2026-09-17 |
| 2. Companion Desktop Preprocessor & Parity Testing | 0/2 | Not started | - |
| 3. Client-Side Web Dashboard & Analytics | 0/3 | Not started | - |
| 4. Power BI Export Engine & Structural Gates | 0/2 | Not started | - |
| 5. Verification, Golden Parity Audit & Showcase Docs | 0/1 | Not started | - |
