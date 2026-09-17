# Phase 3: Client-Side Web Dashboard & Analytics - Context

**Gathered:** 2026-09-17
**Status:** Ready for planning
**Mode:** Autonomous / Smart Discuss

<domain>
## Phase Boundary

Build the zero-auth, offline-first 4-tab client-side speech analytics dashboard in `index.html`, `stats.js`, and `charts.js`. Deliver high-fidelity Chart.js visualizers, IndexedDB persistence, full ARIA table accessibility, and an interactive Boolean/Proximity NLP query sandbox.
</domain>

<decisions>
## Implementation Decisions

### Zero-Auth & Offline Asset Loading
- All script tags load from `vendor/` or local files (`vendor/papaparse.min.js`, `vendor/chart.umd.min.js`, `vendor/jszip.min.js`, `brand.css`, `stats.js`, `charts.js`, `powerbi.js`).
- Standalone CSS styling leveraging `brand.css` Slate/Sky design system variables and Tailwind utility layout classes.

### White-Label Identity
- Title: `Acme Analytics - Speech Analytics & Customer Intelligence Dashboard`.
- Header: Vector SVG logo (`logo.svg`) and sub-title `OmniAnalytics Center of Expertise`.
- Incident Banner: "Mobile App Update v2.1.0 Connection Incident".
- IndexedDB Database Name: `AcmeAnalyticsDashboard`.

### 4-Tab Analytical Layout
- **Tab 1 (Executive Summary Hub)**: KPI summary cards, dual-axis Volume & Sentiment trend, Category distribution stacked bar, FCR vs. Sentiment scatter plot, and dynamic incident narrative callouts.
- **Tab 2 (Ops & QA Command)**: Average Silence % vs. QA Score scatter, Queue Efficiency leaderboard table, Talk-to-Silence conversational balance doughnut, and Silence Duration frequency histogram (5 duration buckets).
- **Tab 3 (Compliance & Coaching)**: Policy Adherence gauge (half-doughnut), 5-axis Agent Behavioral radar chart, Interaction Agitation timeline curve, and Linguistic Empathy correlation bar chart.
- **Tab 4 (NLP Query Sandbox)**: Boolean (`AND`, `OR`, `NOT`) and Proximity (`W/15`) query evaluator, live Precision/Recall metrics, query hit velocity timeline, and transcript snippet highlighter grid.

### Accessibility Standards
- Hidden ARIA screen-reader tables (`sr-only` or visually hidden) populated dynamically alongside every chart canvas for WCAG 2.1 compliance.

</decisions>

<code_context>
## Existing Code Insights

- Reference: `d:\Projects\callminer-speech-analytics-dashboard\index.html`, `stats.js`, `charts.js`.
- All references to Dexcom, G7, G6, CLARITY, employee names must be completely sanitized.
</code_context>

<specifics>
## Specific Requirements

- DASH-01: Offline execution with local vendor dependencies.
- DASH-02: Tab 1 Executive Summary Hub with KPI cards and dual-axis chart.
- DASH-03: Tab 2 Ops & QA Command with scatter and nested doughnut charts.
- DASH-04: Tab 3 Compliance & Coaching with adherence gauge and radar chart.
- DASH-05: Tab 4 NLP Query Sandbox with proximity parsing and hit highlight.
- DASH-06: ARIA accessibility tables for all visualizers.
</specifics>

<deferred>
## Deferred Ideas

- None. Strictly 1:1 functional scope.
</deferred>
