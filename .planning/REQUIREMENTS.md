# Requirements: Speech Analytics & Customer Intelligence Dashboard (Sanitized Portfolio Edition)

**Defined:** 2026-09-17
**Core Value:** Provide a 1:1 functional, architecturally pristine clone of an enterprise speech analytics system that is 100% sanitized of proprietary branding and PII for public engineering showcase.

## v1 Requirements

Requirements for initial portfolio release (Milestone v1.0).

### Sanitization & Theming

- [ ] **SAN-01**: Scrub all proprietary company names (Dexcom), logos, employee names (Nadine Bilog, Wesley Taguinod), and internal project references across all codebase files, comments, and assets.
- [ ] **SAN-02**: Establish white-labeled CSS variables (`--brand-primary`, `--brand-accent`, etc.) and brand placeholders (`Acme Analytics`, `OmniAnalytics CoE`, `[YOUR_LOGO_HERE]`).
- [ ] **SAN-03**: Sanitize incident narrative copy (replace specific product firmware/app release names with generic incidents like "Mobile App Update v2.1.0 Connection Incident").

### Synthetic Data Engine

- [ ] **MOCK-01**: Provide `generate_mock_data.py` capable of producing deterministic, realistic call center datasets with anonymized transcript text and full 15-column schema.
- [ ] **MOCK-02**: Ensure synthetic call categories, queues, sentiment distributions, and silence buckets reflect realistic call center telemetry.

### Desktop Preprocessor & Packaging

- [ ] **PREP-01**: Implement pure Python `preprocess_core.py` with 15-column normalization rules and zero GUI/CLI dependencies (`validate`, `preview`, `process_file`, `combine`).
- [ ] **PREP-02**: Implement CLI interface `preprocess_cli.py` for batch headless processing.
- [ ] **PREP-03**: Build `pywebview` desktop app (`gui/app.py`) providing side-by-side raw vs. transformed 20-row preview and diff highlighting.
- [ ] **PREP-04**: Author PyInstaller packaging spec `build/preprocessor.spec` creating standalone `SpeechAnalyticsPreprocessor.exe` with WebView2 runtime detection.

### Web Dashboard & Analytics

- [ ] **DASH-01**: Client-side single-page dashboard (`index.html`) with zero-auth, offline PapaParse CSV ingestion and IndexedDB dataset caching.
- [ ] **DASH-02**: Tab 1 (Executive Summary Hub): KPI cards, dual-axis volume/sentiment trend, category breakdown, FCR vs. Sentiment scatter plot, and dynamic incident alert banner.
- [ ] **DASH-03**: Tab 2 (Ops & QA Command): Silence % vs. QA Score scatter plot, queue efficiency leaderboard, nested doughnut conversational balance, and 5-bucket silence duration histogram.
- [ ] **DASH-04**: Tab 3 (Compliance & Coaching): Verification adherence gauge, 5-axis behavioral radar chart, acoustic stress/agitation curve, and linguistic empathy correlation bar chart.
- [ ] **DASH-05**: Tab 4 (NLP Query Sandbox): Interactive Boolean & `W/15` proximity search query parser, real-time Precision/Recall evaluator, hit velocity curve, and transcript keyword highlighting.
- [ ] **DASH-06**: ARIA-accessible data tables for all interactive charts ensuring full screen reader compatibility.

### Power BI Export Engine

- [ ] **PBI-01**: In-browser `.pbip` zip compiler (`powerbi.js`) using JSZip to produce valid TMDL semantic models (`Calls.tmdl`, `DateTable.tmdl`, `SilenceBuckets.tmdl`, `EmpathyBuckets.tmdl`).
- [ ] **PBI-02**: Programmatic generation of 4 synchronized PBIR report pages matching the web tabs, plus dedicated Call Detail Drill-Through page.
- [ ] **PBI-03**: Duration-weighted DAX calculations for Silence %, Agent Talk %, and Sentiment metrics.

### Automated Testing & Quality Gates

- [ ] **TEST-01**: Preprocessor unit tests verifying schema validation and transformation accuracy (`pytest`).
- [ ] **TEST-02**: Byte-parity golden test suite guaranteeing identical transformed outputs against reference baseline fixtures.
- [ ] **TEST-03**: Power BI structural verification gate suite (`check:pbi`, `check:date`, `check:weighted`, `check:drill`, `check:columns`).

### Documentation & Showcase

- [ ] **DOC-01**: Comprehensive `README.md` detailing architecture, sanitization methodology, data pipeline, and local reproduction steps.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Live CallMiner API Integration | Requires proprietary credentials; project is strictly offline-first portfolio |
| Cloud Database / Backend Server | Architecture is intentionally client-side and desktop-local |
| Multi-tenant Authentication | Not relevant for public static portfolio demo |
| Extra Analytics Domains / Presets | Violates strict 1:1 functional copy constraint |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SAN-01 | Phase 1 | Pending |
| SAN-02 | Phase 1 | Pending |
| SAN-03 | Phase 1 | Pending |
| MOCK-01 | Phase 1 | Pending |
| MOCK-02 | Phase 1 | Pending |
| PREP-01 | Phase 2 | Pending |
| PREP-02 | Phase 2 | Pending |
| PREP-03 | Phase 2 | Pending |
| PREP-04 | Phase 2 | Pending |
| DASH-01 | Phase 3 | Pending |
| DASH-02 | Phase 3 | Pending |
| DASH-03 | Phase 3 | Pending |
| DASH-04 | Phase 3 | Pending |
| DASH-05 | Phase 3 | Pending |
| DASH-06 | Phase 3 | Pending |
| PBI-01 | Phase 4 | Pending |
| PBI-02 | Phase 4 | Pending |
| PBI-03 | Phase 4 | Pending |
| TEST-01 | Phase 2 | Pending |
| TEST-02 | Phase 2 | Pending |
| TEST-03 | Phase 4 | Pending |
| DOC-01 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-17*
*Last updated: 2026-09-17 after initial definition*
