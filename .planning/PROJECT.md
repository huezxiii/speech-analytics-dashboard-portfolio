# Speech Analytics & Customer Intelligence Dashboard (Sanitized Portfolio Edition)

## What This Is

A white-labeled, public portfolio repository demonstrating an end-to-end speech analytics solution. It pairs a zero-auth, local-first client-side web dashboard with a companion Python desktop preprocessing GUI and an in-browser Power BI (.pbip / TMDL) project generator. All proprietary company trademarks, internal employee names, vendor SDK references, and private incident logs from the original codebase have been scrubbed and replaced with generic corporate placeholders.

## Core Value

Provide a 1:1 functional, architecturally pristine clone of an enterprise speech analytics system that is 100% sanitized of proprietary branding and PII for public engineering showcase.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] **SAN-01**: Complete corporate data sanitization across all code, comments, mock transcripts, and documentation (Dexcom -> Acme Analytics / OmniAnalytics CoE).
- [ ] **SAN-02**: CSS design tokens for white-label theming (`--brand-primary`, `--brand-accent`) replacing hardcoded proprietary colors.
- [ ] **MOCK-01**: Anonymized synthetic call transcript and metrics generator (`generate_mock_data.py`).
- [ ] **PREP-01**: Pure Python core preprocessor (`preprocess_core.py`) with 15-column schema validation and headless transformation contract.
- [ ] **PREP-02**: Desktop `pywebview` application (`gui/app.py`) featuring side-by-side raw vs. transformed preview and diff highlighting.
- [ ] **PREP-03**: Single-file PyInstaller packaging spec (`build/preprocessor.spec`) for `SpeechAnalyticsPreprocessor.exe` with Evergreen WebView2 pre-flight detection.
- [ ] **DASH-01**: 4-tab client-side web dashboard (`index.html`, `charts.js`, `stats.js`) with zero-auth PapaParse ingestion and IndexedDB persistence.
- [ ] **DASH-02**: Tab 1 (Executive Summary Hub) with KPI banner cards, dual-axis volume/sentiment chart, category distribution, and incident banner.
- [ ] **DASH-03**: Tab 2 (Ops & QA Command) with silence vs QA scatter plot, queue efficiency leaderboard, nested doughnut conversational balance, and silence duration histogram.
- [ ] **DASH-04**: Tab 3 (Compliance & Coaching) with policy adherence gauge, 5-axis behavioral radar chart, acoustic stress timeline, and empathy correlation bar chart.
- [ ] **DASH-05**: Tab 4 (NLP Query Sandbox) supporting `W/15` proximity and Boolean search, precision/recall evaluator, hit velocity curve, and transcript snippet highlighter.
- [ ] **PBI-01**: Programmatic client-side Power BI project generator (`powerbi.js`) using JSZip to output `.pbip` TMDL semantic models and PBIR reports.
- [ ] **PBI-02**: Duration-weighted DAX measures and call detail drill-through target page in exported Power BI model.
- [ ] **TEST-01**: Automated test suite for preprocessor core, byte-parity golden testing, and Power BI structural gates (`check:pbi`, `check:date`, `check:weighted`, `check:drill`, `check:columns`).
- [ ] **DOC-01**: Professional portfolio README with architecture diagrams, technical decisions, and reproduction instructions.

### Out of Scope

- **Cloud / Server Backends**: No node/python servers; dashboard remains 100% local-first and client-side.
- **Vendor APIs**: No live CallMiner API integrations or proprietary SDK dependencies.
- **New Feature Scope**: Strictly 1:1 functional clone with no added analytics domains or multi-preset engines.
- **Authentication**: No login or user management system.

## Context

- **Reference Project**: `D:\Projects\callminer-speech-analytics-dashboard` serves as read-only architectural baseline.
- **Target Repository**: `D:\Projects\speech-analytics-dashboard-portfolio` hosts the sanitized, public-ready repository.
- **Audience**: Engineering leaders, data platform hiring managers, and enterprise architects evaluating data visualization and full-stack capabilities.

## Constraints

- **Sanitization Matrix**: Strictly enforce replacement of proprietary names (Dexcom, Nadine Bilog, Wesley Taguinod, CallMiner) with generic placeholders.
- **1:1 Parity**: Match the exact visual layout, interaction paradigms, and analytical outputs of the reference system.
- **Offline First**: All dashboard operations and Power BI exports execute in-browser with zero external network requests.
- **Test Integrity**: Must pass all Python (`pytest`) and Power BI structural verification checks before release.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Brand: "Acme Analytics" / "OmniAnalytics CoE" | Recognizable enterprise placeholder that clearly signifies a portfolio demo | — Pending |
| Clean separation: `preprocess_core.py` vs GUI | Enables headless unit and parity testing independent of UI windowing | — Pending |
| In-browser JSZip for PBIP generation | Zero-install report generator accessible directly from the web dashboard | — Pending |
| Preserve exact 4-tab structure | Maintains proven analytical workflows and depth of reference application | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-17 after initialization*
