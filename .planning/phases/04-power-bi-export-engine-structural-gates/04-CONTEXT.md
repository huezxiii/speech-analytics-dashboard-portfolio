# Phase 4: Power BI Export Engine & Structural Gates - Context

**Gathered:** 2026-09-17
**Status:** Ready for planning
**Mode:** Autonomous / Smart Discuss

<domain>
## Phase Boundary

Implement the complete, sanitized, client-side Power BI project generator (`powerbi.js`) that emits valid `.pbip` zip archives containing TMDL semantic models and PBIR report definitions across 4 synchronized pages (Executive Hub, Ops/QA Command, Compliance & Coaching, and Call Detail Drill-Through Target Page).
Implement the automated structural gate test scripts (`check-*.js`, `test-powerbi.js`, `regen-powerbi.js`) and wire them into `package.json`.
</domain>

<decisions>
## Implementation Decisions

### Project & Theme Naming
- Project Name: `SpeechAnalytics` (`var PBI_PROJECT_NAME = 'SpeechAnalytics'`).
- Artifact Prefix: `powerbi/SpeechAnalytics.SemanticModel` and `powerbi/SpeechAnalytics.Report`.
- Custom Theme: `AcmeTheme.json` (`var PBI_THEME = { fileName: 'AcmeTheme.json', theme: { name: 'Acme', ... } }`).
- Clean White-Label Brand: Acme Analytics / OmniAnalytics CoE palette tokens matching `brand.css` and `logo.svg`.
- Registered Brand Images: `brand-icon.png` and `brand-text.png` valid base64-encoded PNGs with strict `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A` headers.

### Semantic Model (TMDL)
- Complete semantic tables:
  - `Calls.tmdl`: 21 model columns (15 source + 6 derived calculated columns) and duration-weighted DAX measures (`[Weighted Silence %]`, `[Weighted Agent QA Score]`, `[Weighted Customer Sentiment]`, `[Period-over-Period Delta %]`, etc.).
  - `DateTable.tmdl`: Explicit date dimension with continuous full-calendar-year span, marked date table, and standard calendar attributes.
  - `SilenceBuckets.tmdl` & `EmpathyBuckets.tmdl`: Discretized dimension tables joined with explicit 1:many relationships.
- DAX Measure Integrity:
  - Ratio-of-sums duration-weighting on Silence % (`DIVIDE(SUM(Calls[Silence_Seconds]), SUM(Calls[Duration_Seconds]))`).
  - Zero-row guards on dynamic narrative title measures.
  - Strict date-table filtering with partial-period clamping.

### Report Definitions (PBIR)
- 4 Pages:
  - Page 1: `ExecutiveSummaryHub` (KPI Cards, Volume/Sentiment trend, Category distribution stacked bar, Sentiment scatter).
  - Page 2: `OpsQACommand` (Silence vs QA Score scatter, Queue leaderboard, Conversational balance doughnut, Silence histogram).
  - Page 3: `ComplianceCoaching` (Adherence gauge, 5-axis radar chart, Agitation timeline, Empathy correlation).
  - Page 4: `CallDetailDrill` (Hidden drill-through target page binding all 12 drill fields in order, with single-sourced PII exposure disclosure).
- Theme-owned properties allowlisted, relative date slicer without hardcoded dates, explicit axis disclosure.

### Verification Gates & Parity
- Implement `regen-powerbi.js` to materialize `powerbi/` folder on disk.
- Implement gate scripts:
  - `check-powerbi-freshness.js` (`check:pbi`)
  - `check-date-dimension.js` (`check:date`)
  - `check-weighted-measures.js` (`check:weighted`)
  - `check-drillthrough.js` (`check:drill`)
  - `check-column-consumers.js` (`check:columns`)
  - `check-compliance-page.js` (`check:compliance`)
  - `check-card-reference-labels.js` (`check:cards`)
  - `check-narrative-titles.js` (`check:narrative`)
  - `check-pop-measures.js` (`check:pop`)
  - `check-target-lines.js` (`check:target`)
  - `test-index-export.js` (`check:export`)
  - `test-powerbi.js` (`test`)
- Ensure all checks execute and pass with 0 exit code.
</decisions>

<code_context>
## Existing Code Insights

- Reference: `D:\Projects\callminer-speech-analytics-dashboard\powerbi.js`, `regen-powerbi.js`, `test-powerbi.js`, `check-*.js`.
- All Dexcom branding and Wesley author references must be purged and replaced with Acme Analytics / white-label standards.
- In `index.html`, wire `exportPowerBIProject` to call `generatePowerBIExport(rows, exportMode)`.
</code_context>

<specifics>
## Specific Requirements

- PBI-01: Programmatic client-side `.pbip` TMDL & PBIR generation.
- PBI-02: Duration-weighted DAX measures and sanitized theme.
- PBI-03: 4-page PBIR report structure including drill-through target page.
- TEST-03: Automated structural verification checks and npm test runner.
</specifics>
